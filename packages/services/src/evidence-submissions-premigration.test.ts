import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { migrationsFolder } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { decideEvidenceResponse, listEvidenceRequestsForApplicant } from './agency';
import type { Db } from './db';
import {
  LEGACY_SEND_LABEL,
  downloadEvidenceSubmissionFile,
  evidenceSubmissionsPresent,
  listEvidenceSubmissions,
} from './evidence-submissions';
import {
  ACCESS_TOKEN_SECRET,
  FakeStorage,
  agency,
  agencyProof,
  cleanDocument,
  openRequest,
  send,
  share,
  stepUpFor,
  traveller,
} from './evidence-submissions.test-support';

/**
 * Lane D: production runs the new code for a while before migration 0132. This proves, on a
 * database exactly as production has it today (through 0131): requests, sends and decisions work
 * as before, nothing claims an exact copy, no file can be opened, and the list says plainly that
 * exact copies are not on yet; then that the migration turns on exactly the new behaviour for
 * sends made after it, while a send made before it stays labelled as older.
 */

// The journal tag is named on purpose (it says which database this test builds): if the lead
// renumbers this migration in merge order, this one line changes with it.
const MIGRATION = '0132_evidence_request_submissions';
const TIMEOUT = 240_000;

function folderBefore(file: string): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === file);
  if (at === -1) throw new Error(`${file} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-lane-d-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function runFile(client: PGlite, file: string) {
  const text = readFileSync(join(migrationsFolder, `${file}.sql`), 'utf8');
  for (const statement of text.split('--> statement-breakpoint')) await client.exec(statement);
}

describe('before and after migration 0132 (Lane D)', () => {
  it(
    'keeps requests, sends and decisions working before the migration, then turns on exact copies',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore(MIGRATION) });
      const db = drizzle(client, { schema }) as unknown as Db;

      const alice = await traveller(db, 'alice-pre@example.com');
      const harbor = await agency(db, 'harbor-pre@example.com', 'Harbor Visas');
      await share(db, alice, harbor);
      expect(await evidenceSubmissionsPresent(db)).toBe(false);

      // The older flow, exactly as before: request, send, list, decide.
      const first = await cleanDocument(db, alice, 'bank_statement', 'before.pdf');
      const earlyRequest = await openRequest(db, harbor, alice);
      const early = await send(db, alice, earlyRequest, first.documentId);
      expect(isOk(early)).toBe(true);
      if (isOk(early)) {
        expect(early.value.status).toBe('RECEIVED');
        expect(early.value.submissionId).toBeNull();
      }
      const listedRequests = await listEvidenceRequestsForApplicant(
        db,
        alice.accountId,
        alice.applicantId,
      );
      expect(isOk(listedRequests) && listedRequests.value.map((r) => r.status)).toEqual([
        'RECEIVED',
      ]);

      // Exact copies are reported as not available, and the older send is labelled as such.
      const before = await listEvidenceSubmissions(
        await agencyProof(db, harbor, alice.applicantId),
        {
          requestId: earlyRequest,
        },
      );
      expect(isOk(before)).toBe(true);
      if (isOk(before)) {
        expect(before.value.available).toBe(false);
        expect(before.value.submissions).toEqual([]);
        expect(before.value.legacy.map((l) => l.label)).toEqual([LEGACY_SEND_LABEL]);
      }
      // No file can be opened without an exact copy.
      const refused = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(db, harbor, alice.applicantId),
        {
          submissionId: '00000000-0000-4000-8000-000000000000',
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(harbor.accountId, first.versionId),
        },
      );
      expect(isErr(refused) && refused.error.code).toBe('not_found');

      // A second request is sent but not yet decided when the migration runs.
      const second = await cleanDocument(db, alice, 'bank_statement', 'in-flight.pdf');
      const flightRequest = await openRequest(db, harbor, alice);
      expect(isOk(await send(db, alice, flightRequest, second.documentId))).toBe(true);

      await runFile(client, MIGRATION);
      // Production applies each statement on its own and may start again from the top.
      await runFile(client, MIGRATION);
      expect(await evidenceSubmissionsPresent(db)).toBe(true);

      // The in-flight send stays what it was: labelled older, never described as pinned. A decision
      // on it is recorded as before, without a link to an exact copy.
      const flight = await listEvidenceSubmissions(
        await agencyProof(db, harbor, alice.applicantId),
        {
          requestId: flightRequest,
        },
      );
      expect(isOk(flight)).toBe(true);
      if (isOk(flight)) {
        expect(flight.value.available).toBe(true);
        expect(flight.value.submissions).toEqual([]);
        expect(flight.value.legacy).toHaveLength(1);
      }
      const decided = await decideEvidenceResponse(db, {
        actorAccountId: harbor.accountId,
        requestId: flightRequest,
        outcome: 'NEEDS_REPLACEMENT',
        reason: 'please resend',
      });
      expect(isOk(decided) && decided.value.decidedSubmissionId).toBeNull();

      // A send made after the migration is pinned.
      const resent = await send(db, alice, flightRequest, second.documentId);
      expect(isOk(resent) && resent.value.submissionId).not.toBeNull();
      const after = await listEvidenceSubmissions(
        await agencyProof(db, harbor, alice.applicantId),
        {
          requestId: flightRequest,
        },
      );
      expect(isOk(after)).toBe(true);
      if (isOk(after)) {
        expect(after.value.submissions.map((s) => [s.roundNo, s.state])).toEqual([
          [1, 'AWAITING_DECISION'],
        ]);
        expect(after.value.legacy.map((l) => l.state)).toEqual(['NEEDS_REPLACEMENT']);
      }
      const opened = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(db, harbor, alice.applicantId),
        {
          submissionId: isOk(resent) ? (resent.value.submissionId ?? '') : '',
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(harbor.accountId, second.versionId),
        },
      );
      expect(isOk(opened)).toBe(true);
    },
    TIMEOUT,
  );
});
