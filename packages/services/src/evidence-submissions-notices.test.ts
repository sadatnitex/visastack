import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  assignMember,
  cancelEvidenceRequest,
  decideEvidenceResponse,
  requestEvidence,
} from './agency';
import type { Db } from './db';
import { listEvidenceSubmissions } from './evidence-submissions';
import {
  type Agency,
  type Traveller,
  agency,
  agencyProof,
  cleanDocument,
  freshDb,
  openRequest,
  send,
  share,
  traveller,
} from './evidence-submissions.test-support';
import { createMission } from './missions';
import { runNotificationWorker } from './notifications';
import { addMembership } from './organizations';

/**
 * Lane D service items: the safety status on the list, the agency notice when evidence arrives,
 * and one notice for every send-back on a request.
 */

const TIMEOUT = 120_000;
const NOTE = 'EVIDENCE_RESPONSE_RECEIVED';

interface World {
  db: Db;
  alice: Traveller;
  harbor: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const alice = await traveller(db, 'alice-n@example.com');
  const harbor = await agency(db, 'harbor-n@example.com', 'Harbor Visas');
  await share(db, alice, harbor);
  return { db, alice, harbor };
}

function notices(db: Db, eventType: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.eventType, eventType));
}

describe('Lane D: the list carries the live safety status of the pinned version', () => {
  it(
    'reads it live, never stored, and names no scanner or storage data',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      const proof = await agencyProof(w.db, w.harbor, w.alice.applicantId);
      const before = await listEvidenceSubmissions(proof, { requestId });
      expect(isOk(before) && before.value.submissions[0]?.safetyStatus).toBe('CLEAN');
      await w.db
        .update(schema.documentVersions)
        .set({ safetyStatus: 'QUARANTINED' })
        .where(eq(schema.documentVersions.id, doc.versionId));
      const after = await listEvidenceSubmissions(proof, { requestId });
      expect(isOk(after) && after.value.submissions[0]?.safetyStatus).toBe('QUARANTINED');
      const text = JSON.stringify(isOk(after) ? after.value : null);
      expect(text).not.toContain(doc.objectKey);
      expect(text).not.toContain('clam');
      const stored = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(JSON.stringify(stored)).not.toContain('QUARANTINED');
    },
    TIMEOUT,
  );
});

describe('Lane D: New Evidence Received', () => {
  it(
    'queues one neutral notice in the app and by email for each active owner or admin, and nobody else',
    async () => {
      const w = await world();
      const caseManager = await provisionAccount(w.db, { email: 'cm-n@example.com' });
      const removed = await provisionAccount(w.db, { email: 'removed-n@example.com' });
      const admin = await provisionAccount(w.db, { email: 'admin-n@example.com' });
      if (!isOk(caseManager) || !isOk(removed) || !isOk(admin)) throw new Error('accounts');
      for (const [account, role] of [
        [caseManager.value.id, 'CASE_MANAGER'],
        [removed.value.id, 'ADMIN'],
        [admin.value.id, 'ADMIN'],
      ] as const) {
        const added = await addMembership(w.db, {
          actorAccountId: w.harbor.accountId,
          organizationId: w.harbor.organizationId,
          accountId: account,
          role,
        });
        expect(isOk(added)).toBe(true);
      }
      await w.db
        .update(schema.memberships)
        .set({ active: false })
        .where(eq(schema.memberships.accountId, removed.value.id));

      const doc = await cleanDocument(w.db, w.alice, 'bank_statement', 'private-name.pdf');
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const sent = await send(w.db, w.alice, requestId, doc.documentId);
      expect(isOk(sent)).toBe(true);

      const rows = await notices(w.db, NOTE);
      expect(rows.map((r) => r.recipientAccountId).sort()).toEqual(
        [w.harbor.accountId, w.harbor.accountId, admin.value.id, admin.value.id].sort(),
      );
      expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'EMAIL', 'IN_APP', 'IN_APP']);
      for (const row of rows) {
        expect(row.resourceId).toBe(requestId);
        expect(row.applicantId).toBe(w.alice.applicantId);
        expect(row.organizationId).toBe(w.harbor.organizationId);
        expect(row.idempotencyKey).toMatch(/:submission-[0-9a-f-]{36}$/);
        expect(row.payload).toEqual({
          subject: 'New Evidence Received',
          summary: 'A traveller sent evidence for one of your requests.',
          deepLinkPath: `/app/agency/${w.harbor.organizationId}/clients?request=${requestId}#request-${requestId}`,
        });
        const text = JSON.stringify(row);
        for (const leaked of [
          'private-name',
          'bank_statement',
          'Synthetic Traveller',
          'please send',
        ]) {
          expect(text).not.toContain(leaked);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'notifies again for a corrected send, but not for a retry of the same one',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const key = 'retry-key-0000000010';
      expect(
        isOk(await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key })),
      ).toBe(true);
      expect(
        isOk(await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key })),
      ).toBe(true);
      expect(await notices(w.db, NOTE)).toHaveLength(2);
      expect(
        isOk(
          await decideEvidenceResponse(w.db, {
            actorAccountId: w.harbor.accountId,
            requestId,
            outcome: 'NEEDS_REPLACEMENT',
            reason: 'x',
          }),
        ),
      ).toBe(true);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      const rows = await notices(w.db, NOTE);
      const sends = await w.db.select().from(schema.evidenceRequestSubmissions);
      const expected = sends.flatMap((r) => [`submission-${r.id}`, `submission-${r.id}`]);
      expect(sends).toHaveLength(2);
      expect(rows.map((r) => r.idempotencyKey.split(':').pop()).sort()).toEqual(expected.sort());
    },
    TIMEOUT,
  );

  it(
    'is cancelled with the request while still queued',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      expect(
        isOk(await cancelEvidenceRequest(w.db, { actorAccountId: w.harbor.accountId, requestId })),
      ).toBe(true);
      expect((await notices(w.db, NOTE)).map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
    },
    TIMEOUT,
  );

  it(
    'numbers the notice by time while the exact-copy tables are missing',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      await w.db.execute(
        sql`drop table evidence_request_decision_submissions, evidence_request_submissions`,
      );
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      const rows = await notices(w.db, NOTE);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => /:sent-\d+$/.test(r.idempotencyKey))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'goes only to a member who is still an owner or admin, and only while the agency holds a grant',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      // The owner is demoted to a plain member after the notice was queued.
      await w.db
        .update(schema.memberships)
        .set({ role: 'CASE_MANAGER' })
        .where(eq(schema.memberships.accountId, w.harbor.accountId));
      await runNotificationWorker(
        w.db,
        { send: async () => ({ ok: true, messageId: 'synthetic' }) } as never,
        'https://app.example.test',
      );
      const rows = await notices(w.db, NOTE);
      expect(rows.map((r) => r.status)).toEqual(['FAILED', 'FAILED']);
      expect(rows.every((r) => r.lastError === 'recipient no longer authorized')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'is refused at send time for an assigned member who is not an owner or admin',
    async () => {
      const w = await world();
      const dana = await traveller(w.db, 'dana-n@example.com');
      const mission = await createMission(w.db, {
        actorAccountId: dana.accountId,
        applicantId: dana.applicantId,
        title: 'Case D',
      });
      if (!isOk(mission)) throw new Error('mission');
      await share(w.db, dana, w.harbor, mission.value.id);
      const doc = await cleanDocument(w.db, dana);
      const request = await requestEvidence(w.db, {
        actorAccountId: w.harbor.accountId,
        organizationId: w.harbor.organizationId,
        applicantId: dana.applicantId,
        missionId: mission.value.id,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });
      if (!isOk(request)) throw new Error('request');
      expect(
        isOk(
          await assignMember(w.db, {
            actorAccountId: w.harbor.accountId,
            organizationId: w.harbor.organizationId,
            memberAccountId: w.harbor.accountId,
            missionId: mission.value.id,
          }),
        ),
      ).toBe(true);
      expect(isOk(await send(w.db, dana, request.value.id, doc.documentId))).toBe(true);
      // Now only a plain member (assigned to the case), no longer an owner or admin.
      await w.db
        .update(schema.memberships)
        .set({ role: 'CASE_MANAGER' })
        .where(eq(schema.memberships.accountId, w.harbor.accountId));
      await runNotificationWorker(
        w.db,
        { send: async () => ({ ok: true, messageId: 'synthetic' }) } as never,
        'https://app.example.test',
      );
      const rows = (await notices(w.db, NOTE)).map((r) => r.status);
      expect(rows).toEqual(['FAILED', 'FAILED']);
    },
    TIMEOUT,
  );

  it(
    'is delivered in the app and by email to an owner who still holds the grant',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      const sentEmails: unknown[] = [];
      await runNotificationWorker(
        w.db,
        {
          send: async (message: unknown) => {
            sentEmails.push(message);
            return { ok: true, messageId: 'synthetic' };
          },
        } as never,
        'https://app.example.test',
      );
      const rows = await notices(w.db, NOTE);
      expect(rows.map((r) => r.status).sort()).toEqual(['SENT', 'SENT']);
      // The traveller's own "request created" email goes out in the same run; look at the agency's.
      const agencyEmails = sentEmails.filter((m) =>
        JSON.stringify(m).includes('Evidence arrived for one of your requests'),
      );
      expect(agencyEmails).toHaveLength(1);
      const text = JSON.stringify(agencyEmails[0]);
      expect(text).toContain('Open the Request');
      expect(text).not.toContain('bank_statement');
    },
    TIMEOUT,
  );
});

describe('Lane D: a second send-back on one request notifies again', () => {
  it(
    'queues one replacement notice for each round that is sent back',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const decide = () =>
        decideEvidenceResponse(w.db, {
          actorAccountId: w.harbor.accountId,
          requestId,
          outcome: 'NEEDS_REPLACEMENT',
          reason: 'does not stand',
        });
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      expect(isOk(await decide())).toBe(true);
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
      expect(isOk(await decide())).toBe(true);
      const rows = await w.db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventType, 'EVIDENCE_REPLACEMENT_REQUESTED'),
            eq(schema.notifications.channel, 'IN_APP'),
          ),
        );
      const sends = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(sends).toHaveLength(2);
      expect(rows.map((r) => r.idempotencyKey.split(':').pop()).sort()).toEqual(
        sends.map((r) => `submission-${r.id}`).sort(),
      );
      // Each is still the neutral notice: no reason text.
      expect(JSON.stringify(rows)).not.toContain('does not stand');
    },
    TIMEOUT,
  );

  it(
    'also tells two send-backs of sends with no exact copy apart',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      await w.db.execute(
        sql`drop table evidence_request_decision_submissions, evidence_request_submissions`,
      );
      for (let i = 0; i < 2; i += 1) {
        expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
        expect(
          isOk(
            await decideEvidenceResponse(w.db, {
              actorAccountId: w.harbor.accountId,
              requestId,
              outcome: 'NEEDS_REPLACEMENT',
              reason: 'x',
            }),
          ),
        ).toBe(true);
      }
      const rows = await w.db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventType, 'EVIDENCE_REPLACEMENT_REQUESTED'),
            eq(schema.notifications.channel, 'IN_APP'),
          ),
        );
      expect(rows).toHaveLength(2);
    },
    TIMEOUT,
  );
});

describe('Lane D: a reused round number never swallows a notice', () => {
  it(
    'still notifies the agency and the traveller after the first send was removed with its document',
    async () => {
      const w = await world();
      const first = await cleanDocument(w.db, w.alice, 'bank_statement', 'first.pdf');
      const second = await cleanDocument(w.db, w.alice, 'bank_statement', 'second.pdf');
      const third = await cleanDocument(w.db, w.alice, 'bank_statement', 'third.pdf');
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const sendBack = () =>
        decideEvidenceResponse(w.db, {
          actorAccountId: w.harbor.accountId,
          requestId,
          outcome: 'NEEDS_REPLACEMENT',
          reason: 'x',
        });

      // Round 1 is sent and sent back; then its document is hard-deleted (the send cascades away).
      expect(isOk(await send(w.db, w.alice, requestId, first.documentId))).toBe(true);
      expect(isOk(await sendBack())).toBe(true);
      await w.db.delete(schema.documents).where(eq(schema.documents.id, first.documentId));
      expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toEqual([]);

      // The next send is round 1 again, but it is a different send: its notices are not dropped.
      expect(isOk(await send(w.db, w.alice, requestId, second.documentId))).toBe(true);
      const [reused] = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(reused?.roundNo).toBe(1);
      expect(await notices(w.db, NOTE)).toHaveLength(4);
      expect(isOk(await sendBack())).toBe(true);
      const replacement = await w.db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventType, 'EVIDENCE_REPLACEMENT_REQUESTED'),
            eq(schema.notifications.channel, 'IN_APP'),
          ),
        );
      expect(replacement).toHaveLength(2);

      // And the next send after that carries on, with the default retry key still free.
      expect(isOk(await send(w.db, w.alice, requestId, third.documentId))).toBe(true);
      expect(await notices(w.db, NOTE)).toHaveLength(6);
      const rounds = (await w.db.select().from(schema.evidenceRequestSubmissions))
        .map((r) => r.roundNo)
        .sort();
      expect(rounds).toEqual([1, 2]);
    },
    TIMEOUT,
  );
});
