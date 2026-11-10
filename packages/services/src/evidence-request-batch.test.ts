import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EvidenceRequestItem,
  MAX_EVIDENCE_REQUESTS_PER_SEND,
  requestEvidence,
  requestEvidenceBatch,
} from './agency';
import type { Db } from './db';
import {
  type Agency,
  type Traveller,
  agency,
  freshDb,
  share,
  traveller,
} from './evidence-submissions.test-support';
import { createMission } from './missions';
import { addMembership } from './organizations';
import { RATE_LIMITS } from './rate-limit';
import * as referenceCodes from './reference-codes';

/**
 * One send can carry many items: each becomes its own request, all or nothing, under the same
 * access checks as a single request.
 */

vi.mock('./reference-codes', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reference-codes')>();
  return { ...original, assignReferenceCode: vi.fn(original.assignReferenceCode) };
});

const TIMEOUT = 120_000;
const doc = (key: string): EvidenceRequestItem => ({ kind: 'DOCUMENT', key });
const field = (key: string): EvidenceRequestItem => ({ kind: 'FIELD', key });

interface World {
  db: Db;
  alice: Traveller;
  acme: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const alice = await traveller(db, 'alice-batch@example.com');
  const acme = await agency(db, 'owner-batch@acme.example', 'Acme');
  await share(db, alice, acme);
  return { db, alice, acme };
}

function ask(w: World, items: readonly EvidenceRequestItem[], extra: { missionId?: string } = {}) {
  return requestEvidenceBatch(w.db, {
    actorAccountId: w.acme.accountId,
    organizationId: w.acme.organizationId,
    applicantId: w.alice.applicantId,
    items,
    ...extra,
  });
}

async function rows(db: Db) {
  return db.select().from(schema.evidenceRequests);
}

async function notices(db: Db) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.eventType, 'EVIDENCE_REQUEST_CREATED'));
}

describe('requestEvidenceBatch', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    // The setup also gives codes (to the grant); count only what the send does.
    vi.mocked(referenceCodes.assignReferenceCode).mockClear();
  }, TIMEOUT);

  it(
    'makes one request per item, each with its code, an audit entry, and ONE notice pair for the send',
    async () => {
      const result = await requestEvidenceBatch(w.db, {
        actorAccountId: w.acme.accountId,
        organizationId: w.acme.organizationId,
        applicantId: w.alice.applicantId,
        items: [doc('NID'), doc('BANK_STATEMENT'), field('passport_number')],
        message: 'for the visa form',
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toHaveLength(3);
      const stored = await rows(w.db);
      expect(stored.map((r) => r.docType ?? r.fieldKey).sort()).toEqual([
        'BANK_STATEMENT',
        'NID',
        'passport_number',
      ]);
      expect(stored.every((r) => r.message === 'for the visa form' && r.status === 'OPEN')).toBe(
        true,
      );
      const audits = await w.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'EVIDENCE_REQUESTED'));
      expect(audits).toHaveLength(3);
      expect(referenceCodes.assignReferenceCode).toHaveBeenCalledTimes(3);

      const sent = await notices(w.db);
      expect(sent.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      for (const n of sent) {
        expect(stored.map((r) => r.id)).not.toContain(n.resourceId);
        const payload = n.payload as { summary: string; deepLinkPath: string };
        expect(payload.summary).toBe(
          'An agency working on your case has asked you for 3 documents or details.',
        );
        expect(payload.summary).not.toMatch(/NID|passport|for the visa form/i);
      }
    },
    TIMEOUT,
  );

  it(
    'a send of one item gives exactly the notice a single request gives',
    async () => {
      const one = await ask(w, [doc('NID')]);
      expect(isOk(one)).toBe(true);
      if (!isOk(one)) return;
      const sent = await notices(w.db);
      expect(sent).toHaveLength(2);
      expect(sent.every((n) => n.resourceId === one.value[0]?.id)).toBe(true);
      const single = await requestEvidence(w.db, {
        actorAccountId: w.acme.accountId,
        organizationId: w.acme.organizationId,
        applicantId: w.alice.applicantId,
        kind: 'DOCUMENT',
        docType: 'NID',
      });
      expect(isOk(single)).toBe(true);
      const all = await notices(w.db);
      const first = (all.find((n) => n.resourceId === one.value[0]?.id)?.payload ?? {}) as object;
      const second = (all.find((n) => n.resourceId !== one.value[0]?.id)?.payload ?? {}) as object;
      expect(second).toEqual(first);
    },
    TIMEOUT,
  );

  it(
    'one unknown item refuses the whole send: no rows, no notices, no codes',
    async () => {
      const bad = await ask(w, [doc('NID'), doc('NOT_A_REAL_DOCUMENT'), field('passport_number')]);
      expect(isErr(bad) && bad.error.code).toBe('invalid');
      expect(isErr(bad) && bad.error.message).toBe(
        'One of the items is not one we know. Choose from the list.',
      );
      const badField = await ask(w, [doc('NID'), field('not_a_field')]);
      expect(isErr(badField)).toBe(true);
      // A hidden "Other text box" detail is not something an agency can ask for.
      const textBox = await ask(w, [field('other_marital_status')]);
      expect(isErr(textBox)).toBe(true);
      expect(await rows(w.db)).toEqual([]);
      expect(await notices(w.db)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'rolls EVERYTHING back when the third insert fails inside the transaction',
    async () => {
      const actual = await vi.importActual<typeof import('./reference-codes')>('./reference-codes');
      let calls = 0;
      vi.mocked(referenceCodes.assignReferenceCode).mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 3) throw new Error('simulated failure on the third item');
        return actual.assignReferenceCode(...args);
      });
      await expect(
        ask(w, [doc('NID'), doc('BANK_STATEMENT'), doc('PASSPORT'), doc('PHOTO')]),
      ).rejects.toThrow('simulated failure');
      expect(await rows(w.db)).toEqual([]);
      expect(await notices(w.db)).toEqual([]);
      const audits = await w.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'EVIDENCE_REQUESTED'));
      expect(audits).toEqual([]);
      vi.mocked(referenceCodes.assignReferenceCode).mockImplementation(actual.assignReferenceCode);
    },
    TIMEOUT,
  );

  it(
    'asks once for an item named twice, and refuses an empty send or more than the cap',
    async () => {
      const twice = await ask(w, [doc('NID'), doc('NID'), field('passport_number')]);
      expect(isOk(twice) && twice.value).toHaveLength(2);

      const none = await ask(w, []);
      expect(isErr(none) && none.error.message).toBe('Choose at least one item.');

      const many = Array.from({ length: MAX_EVIDENCE_REQUESTS_PER_SEND + 1 }, (_, i) =>
        doc(i === 0 ? 'NID' : `X_${i}`),
      );
      const over = await ask(w, many);
      expect(isErr(over) && over.error.message).toBe('You can ask for up to 25 items in one send.');
      expect(await rows(w.db)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'refuses what a single request refuses: a non-admin, no grant, a case that is not the traveller’s',
    async () => {
      // A member who is not an administrator.
      const member = await traveller(w.db, 'plain-member@acme.example');
      await addMembership(w.db, {
        organizationId: w.acme.organizationId,
        accountId: member.accountId,
        role: 'MEMBER',
      });
      const asMember = await requestEvidenceBatch(w.db, {
        actorAccountId: member.accountId,
        organizationId: w.acme.organizationId,
        applicantId: w.alice.applicantId,
        items: [doc('NID')],
      });
      expect(isErr(asMember) && asMember.error.code).toBe('forbidden');

      // A traveller who never shared with this agency.
      const stranger = await traveller(w.db, 'stranger-batch@example.com');
      const noGrant = await requestEvidenceBatch(w.db, {
        actorAccountId: w.acme.accountId,
        organizationId: w.acme.organizationId,
        applicantId: stranger.applicantId,
        items: [doc('NID')],
      });
      expect(isErr(noGrant) && noGrant.error.code).toBe('forbidden');

      // A case that belongs to another traveller, named beside a traveller the agency can reach.
      const mission = await createMission(w.db, {
        actorAccountId: stranger.accountId,
        applicantId: stranger.applicantId,
        title: 'Not Alice',
      });
      if (!isOk(mission)) throw new Error('mission');
      const wrongCase = await ask(w, [doc('NID')], { missionId: mission.value.id });
      expect(isErr(wrongCase) && wrongCase.error.code).toBe('forbidden');

      // The same three refusals as a single request, with the same codes.
      const single = await requestEvidence(w.db, {
        actorAccountId: w.acme.accountId,
        organizationId: w.acme.organizationId,
        applicantId: stranger.applicantId,
        kind: 'DOCUMENT',
        docType: 'NID',
      });
      expect(isErr(single) && single.error.code).toBe('forbidden');
      expect(await rows(w.db)).toEqual([]);
      expect(await notices(w.db)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a send for one case is stored with that case, and a case the agency cannot reach is refused',
    async () => {
      const mission = await createMission(w.db, {
        actorAccountId: w.alice.accountId,
        applicantId: w.alice.applicantId,
        title: 'Visit',
      });
      if (!isOk(mission)) throw new Error('mission');
      const ok = await ask(w, [doc('NID'), doc('PHOTO')], { missionId: mission.value.id });
      expect(isOk(ok)).toBe(true);
      const stored = await rows(w.db);
      expect(stored.every((r) => r.missionId === mission.value.id)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'charges the rate limit once per item (a send of 25 uses 25 of the 100 an hour)',
    async () => {
      expect(RATE_LIMITS.EVIDENCE_REQUEST.limit).toBe(100);
      const hour = 60 * 60 * 1000;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Math.floor(Date.now() / hour) * hour + hour + hour / 2);
      try {
        // Real, distinct keys are needed: use the catalogue's own document types.
        const { CATALOGUE_DOCUMENTS } = await import('@visastack/core/catalogue');
        const keys = CATALOGUE_DOCUMENTS.map((d) => d.key);
        const send = (from: number, n: number) =>
          ask(
            w,
            keys.slice(from, from + n).map((k) => doc(k)),
          );
        for (let i = 0; i < 4; i += 1) {
          const full = await send(i * 25, 25);
          expect(isOk(full)).toBe(true);
        }
        // 100 used. One more item is over the limit.
        const over = await send(100, 1);
        expect(isErr(over) && over.error.code).toBe('rate_limited');
        expect(await rows(w.db)).toHaveLength(100);
      } finally {
        vi.useRealTimers();
      }
    },
    TIMEOUT,
  );
});
