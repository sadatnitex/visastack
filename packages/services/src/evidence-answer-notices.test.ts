import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { decideEvidenceResponse } from './agency';
import type { Db } from './db';
import { confirmEvidenceAnswers } from './evidence-answer-plan';
import {
  type Agency,
  type StoredDocument,
  type Traveller,
  agency,
  cleanDocument,
  freshDb,
  openRequest,
  ownerProof,
  send,
  share,
  traveller,
} from './evidence-submissions.test-support';
import { addAdmin, auditCount } from './trust-rules/trust-rules.test-support';

/**
 * One confirmation that answers several requests of one agency sends the agency one combined
 * notice per administrator and channel, not one per answer. Every answer is still its own
 * submission, audit entry and review. A single answer keeps its own notice. Everything runs against
 * the real services on a migrated in-memory database.
 */

const TIMEOUT = 90_000;
let counter = 0;
function keyOf(): string {
  counter += 1;
  return `grp-${String(counter).padStart(4, '0')}-abcdefghijklmno`.slice(0, 24);
}

interface World {
  readonly db: Db;
  readonly rahim: Traveller;
  readonly north: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const rahim = await traveller(db, 'test-rahim-synthetic@example.test');
  const north = await agency(db, 'north-admin@example.test', 'TEST Agency North');
  await share(db, rahim, north);
  return { db, rahim, north };
}

interface Ask {
  readonly requestId: string;
  readonly doc: StoredDocument;
}

async function ask(w: World, kind: string, title: string, sha: string): Promise<Ask> {
  const doc = await cleanDocument(w.db, w.rahim, kind, title, sha.repeat(64).slice(0, 64));
  const requestId = await openRequest(w.db, w.north, w.rahim, kind);
  return { requestId, doc };
}

async function confirm(w: World, key: string, asks: readonly Ask[]) {
  const result = await confirmEvidenceAnswers(await ownerProof(w.db, w.rahim), {
    organizationId: w.north.organizationId,
    confirmationKey: key,
    answers: asks.map((a) => ({
      requestId: a.requestId,
      documentId: a.doc.documentId,
      documentVersionId: a.doc.versionId,
    })),
  });
  if (!isOk(result)) throw new Error(`confirm: ${result.error.message}`);
  return result.value;
}

/** Notices about evidence arriving, as rows of the outbox. */
async function arrivals(db: Db) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.eventType, 'EVIDENCE_RESPONSE_RECEIVED'));
}

describe('one confirmation, one notice per administrator and channel', () => {
  it(
    'sends one combined notice for three answers, while keeping three sends, three audit entries and three reviews',
    async () => {
      const w = await world();
      await addAdmin(w.db, w.north, 'north-second-admin@example.test');
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'bank_statement', 'TEST statement.pdf', 'b'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      const done = await confirm(w, keyOf(), asks);
      expect(done.sent).toBe(3);

      // Two administrators, two channels: four rows, not twelve.
      const rows = await arrivals(w.db);
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((r) => r.recipientAccountId)).size).toBe(2);
      expect(rows.filter((r) => r.channel === 'EMAIL')).toHaveLength(2);
      expect(rows.filter((r) => r.channel === 'IN_APP')).toHaveLength(2);

      // The record of what was sent is not merged: one submission and one audit entry per answer.
      const submissions = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(submissions).toHaveLength(3);
      for (const a of asks)
        expect(await auditCount(w.db, 'EVIDENCE_RESPONDED', a.requestId)).toBe(1);

      // Each answer is still reviewed on its own.
      for (const a of asks) {
        const decided = await decideEvidenceResponse(w.db, {
          actorAccountId: w.north.accountId,
          requestId: a.requestId,
          outcome: 'ACCEPTED',
        });
        expect(isOk(decided)).toBe(true);
      }
      expect(await w.db.select().from(schema.evidenceRequestDecisions)).toHaveLength(3);
    },
    TIMEOUT,
  );

  it(
    'keeps the one-answer notice exactly as it was for a confirmation with a single answer',
    async () => {
      const w = await world();
      const one = await ask(w, 'passport', 'TEST passport.pdf', 'a');
      await confirm(w, keyOf(), [one]);
      const rows = await arrivals(w.db);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.resourceId === one.requestId)).toBe(true);
      expect(rows[0]?.payload).toMatchObject({
        summary: 'A traveller sent evidence for one of your requests.',
      });
    },
    TIMEOUT,
  );

  it(
    'keeps answering one request on its own page exactly as it was',
    async () => {
      const w = await world();
      const one = await ask(w, 'passport', 'TEST passport.pdf', 'a');
      const sent = await send(w.db, w.rahim, one.requestId, one.doc.documentId);
      expect(isOk(sent)).toBe(true);
      expect(await arrivals(w.db)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'sends nothing twice when the same confirmation is repeated, even after the agency decided',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      const key = keyOf();
      await confirm(w, key, asks);
      const before = (await arrivals(w.db)).length;
      const again = await confirm(w, key, asks);
      expect(again.sent).toBe(0);
      expect(again.alreadySent).toBe(2);
      expect(await arrivals(w.db)).toHaveLength(before);
      await decideEvidenceResponse(w.db, {
        actorAccountId: w.north.accountId,
        requestId: asks[0]?.requestId ?? '',
        outcome: 'ACCEPTED',
      });
      await confirm(w, key, asks);
      expect(await arrivals(w.db)).toHaveLength(before);
      expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'still sends one combined notice when some answers were not sent because the records changed',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'bank_statement', 'TEST statement.pdf', 'b'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      // One copy is removed between review and send: that answer is not sent.
      await w.db
        .update(schema.documentVersions)
        .set({ safetyStatus: 'QUARANTINED' })
        .where(eq(schema.documentVersions.id, asks[2]?.doc.versionId ?? ''));
      const done = await confirm(w, keyOf(), asks);
      expect(done.sent).toBe(2);
      expect(done.changed).toBe(1);
      expect(await arrivals(w.db)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'tells the agency nothing when nothing was sent',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      for (const a of asks) {
        await w.db
          .update(schema.documentVersions)
          .set({ safetyStatus: 'QUARANTINED' })
          .where(eq(schema.documentVersions.id, a.doc.versionId));
      }
      const done = await confirm(w, keyOf(), asks);
      expect(done.sent).toBe(0);
      expect(await arrivals(w.db)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'sends a new combined notice for a later confirmation (a re-send), once',
    async () => {
      const w = await world();
      const first = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      await confirm(w, keyOf(), first);
      expect(await arrivals(w.db)).toHaveLength(2);
      // The agency sends both back; the traveller answers again in one new confirmation.
      for (const a of first) {
        await decideEvidenceResponse(w.db, {
          actorAccountId: w.north.accountId,
          requestId: a.requestId,
          outcome: 'NEEDS_REPLACEMENT',
          reason: 'unreadable',
        });
      }
      // A clearer copy of each, saved as new documents (a sent-back copy is not offered again).
      const clearer = [
        {
          requestId: first[0]?.requestId ?? '',
          doc: await cleanDocument(
            w.db,
            w.rahim,
            'passport',
            'TEST passport 2.pdf',
            'd'.repeat(64),
          ),
        },
        {
          requestId: first[1]?.requestId ?? '',
          doc: await cleanDocument(w.db, w.rahim, 'photo', 'TEST photo 2.jpg', 'e'.repeat(64)),
        },
      ];
      const second = await confirm(w, keyOf(), clearer);
      expect(second.sent).toBe(2);
      const rows = await arrivals(w.db);
      expect(rows.filter((r) => r.status !== 'CANCELLED')).toHaveLength(2);
      expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toHaveLength(4);
    },
    TIMEOUT,
  );

  it(
    'carries nothing sensitive: no file name, no kind of document, no reason',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST secret passport.pdf', 'a'),
        await ask(w, 'bank_statement', 'TEST secret statement.pdf', 'b'),
      ];
      await confirm(w, keyOf(), asks);
      const rows = await arrivals(w.db);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const text = JSON.stringify(row.payload).toLowerCase();
        expect(text).not.toContain('secret');
        expect(text).not.toContain('passport');
        expect(text).not.toContain('statement');
        expect(row.payload).toMatchObject({ subject: 'New Evidence Received' });
        expect(String((row.payload as { deepLinkPath: string }).deepLinkPath)).toMatch(
          /^\/app\/agency\/[0-9a-f-]+\/clients\?request=[0-9a-f-]+#request-[0-9a-f-]+$/,
        );
      }
    },
    TIMEOUT,
  );

  it(
    'leaves the notice an ordinary queued outbox row, so a failed delivery is retried by the existing worker',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      await confirm(w, keyOf(), asks);
      const queued = await w.db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventType, 'EVIDENCE_RESPONSE_RECEIVED'),
            eq(schema.notifications.status, 'QUEUED'),
          ),
        );
      expect(queued).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'is written by whichever answer commits first, even when the smallest-id request is not sent',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'bank_statement', 'TEST statement.pdf', 'b'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      // The request every notice is keyed on is the one with the smallest id; make it the one that
      // is NOT sent, so the notice must come from a later answer.
      const smallest = [...asks].sort((x, y) => (x.requestId < y.requestId ? -1 : 1))[0];
      await w.db
        .update(schema.documentVersions)
        .set({ safetyStatus: 'QUARANTINED' })
        .where(eq(schema.documentVersions.id, smallest?.doc.versionId ?? ''));
      const done = await confirm(w, keyOf(), asks);
      expect(done.sent).toBe(2);
      const rows = await arrivals(w.db);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.resourceId === smallest?.requestId)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'is cancelled while still queued when the agency decides the request it is keyed on, and only then',
    async () => {
      const w = await world();
      const asks = [
        await ask(w, 'passport', 'TEST passport.pdf', 'a'),
        await ask(w, 'photo', 'TEST photo.jpg', 'c'),
      ];
      await confirm(w, keyOf(), asks);
      const anchor = [...asks].sort((x, y) => (x.requestId < y.requestId ? -1 : 1));
      // Deciding the OTHER request leaves the combined notice queued.
      await decideEvidenceResponse(w.db, {
        actorAccountId: w.north.accountId,
        requestId: anchor[1]?.requestId ?? '',
        outcome: 'ACCEPTED',
      });
      expect((await arrivals(w.db)).filter((r) => r.status === 'QUEUED')).toHaveLength(2);
      // Deciding the request it is keyed on cancels it (the existing rule, keyed on that request).
      await decideEvidenceResponse(w.db, {
        actorAccountId: w.north.accountId,
        requestId: anchor[0]?.requestId ?? '',
        outcome: 'ACCEPTED',
      });
      expect((await arrivals(w.db)).filter((r) => r.status === 'QUEUED')).toHaveLength(0);
    },
    TIMEOUT,
  );
});
