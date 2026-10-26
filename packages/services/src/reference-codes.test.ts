import {
  REFERENCE_ALPHABET,
  type ReferenceKind,
  isOk,
  isValidReferenceCode,
  referenceCheckCharacter,
} from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { requestEvidence } from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import {
  assignReferenceCode,
  assignReferenceCodes,
  findReferenceEntity,
  referenceCodeFor,
  referenceCodesFor,
  referenceCodesTablePresent,
} from './reference-codes';
import { acceptGrant, createGrant } from './sharing';

const HEAVY_TIMEOUT_MS = 60_000;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

/** A byte source that replays fixed payloads (5 values each), then fails loudly. */
function replay(payloads: number[][]) {
  const queue = [...payloads];
  return (length: number) => {
    const next = queue.shift();
    if (!next) throw new Error('replay exhausted');
    return Uint8Array.from(Array.from({ length }, (_, i) => next[i] ?? 7));
  };
}

const valuesOf = (payload: string) => [...payload].map((c) => REFERENCE_ALPHABET.indexOf(c));
const ID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function consentedAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: provisioned.value.id,
      accountId: provisioned.value.id,
      type,
      granted: true,
    });
  }
  return provisioned.value;
}

describe('reference code registry (ADR 0018)', () => {
  it(
    'gives a record one code, keeps it on a second call, and finds it again',
    async () => {
      const db = await freshDb();
      const first = await assignReferenceCode(db, 'C', ID(1));
      expect(first).not.toBeNull();
      expect(isValidReferenceCode('C', first ?? '')).toBe(true);
      expect(await assignReferenceCode(db, 'C', ID(1))).toBe(first);
      expect(await findReferenceEntity(db, 'C', first ?? '')).toBe(ID(1));
      expect(await findReferenceEntity(db, 'D', first ?? '')).toBeNull();
      expect(await referenceCodeFor(db, 'C', ID(1))).toBe(`C-${first}`);
      expect(await referenceCodesFor(db, 'C', [ID(1), ID(2), ID(1)])).toEqual(
        new Map([[ID(1), `C-${first}`]]),
      );
      expect(await referenceCodesFor(db, 'C', [])).toEqual(new Map());
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'retries a clash with a fresh code, lengthens after three clashes, and gives up loudly after eight',
    async () => {
      const db = await freshDb();
      const taken = [7, 19, 2, 23, 9];
      const first = await assignReferenceCode(db, 'C', ID(1), { random: replay([taken]) });
      // The next record is offered the same code first, then a fresh one.
      const second = await assignReferenceCode(db, 'C', ID(2), {
        random: replay([taken, [7, 19, 2, 23, 10]]),
      });
      expect(second).not.toBe(first);
      expect(second).toHaveLength(6);
      // Three clashes in a row: the fourth attempt has 6 random characters.
      const lengthened = await assignReferenceCode(db, 'C', ID(3), {
        random: replay([taken, taken, taken, [7, 19, 2, 23, 11, 12]]),
      });
      expect(lengthened).toHaveLength(7);
      expect(isValidReferenceCode('C', lengthened ?? '')).toBe(true);
      // The same payload under another type is a different code: no clash.
      expect(await assignReferenceCode(db, 'D', ID(4), { random: replay([taken]) })).toBe(
        `7K2Q9${referenceCheckCharacter('D', '7K2Q9')}`,
      );
      // Eight clashes: an error, never a silent record without a code.
      const sixTaken = [...valuesOf((lengthened ?? '').slice(0, 6))];
      await expect(
        assignReferenceCode(db, 'C', ID(5), {
          random: replay([taken, taken, taken, sixTaken, sixTaken, sixTaken, sixTaken, sixTaken]),
        }),
      ).rejects.toThrow(/after 8 attempts/);
      expect(await referenceCodeFor(db, 'C', ID(5))).toBeNull();
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'between a deploy and migration 0091: assigning is skipped, reading is empty, nothing throws',
    async () => {
      const db = await freshDb();
      await db.execute(sql`alter table reference_codes rename to reference_codes_away`);
      expect(await referenceCodesTablePresent(db)).toBe(false);
      expect(await assignReferenceCode(db, 'P', ID(1))).toBeNull();
      expect(await assignReferenceCodes(db, 'P', [ID(1), ID(2)])).toBe(0);
      expect(await referenceCodesFor(db, 'P', [ID(1)])).toEqual(new Map());
      expect(await findReferenceEntity(db, 'P', '7K2Q9M')).toBeNull();
      // A whole create still succeeds, inside its transaction.
      const owner = await consentedAccount(db, 'window@example.test');
      const created = await createApplicant(db, {
        actorAccountId: owner.id,
        ownerAccountId: owner.id,
        displayName: 'Window',
      });
      expect(isOk(created)).toBe(true);
      // Once the table appears, it is used (only "present" is remembered).
      await db.execute(sql`alter table reference_codes_away rename to reference_codes`);
      expect(await assignReferenceCode(db, 'P', ID(1))).not.toBeNull();
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'gives a code to every new person, case, document and request, in the creating transaction',
    async () => {
      const db = await freshDb();
      const owner = await consentedAccount(db, 'owner@example.test');
      const applicant = await createApplicant(db, {
        actorAccountId: owner.id,
        ownerAccountId: owner.id,
        displayName: 'Rahim Uddin',
      });
      if (!isOk(applicant)) throw new Error('applicant');
      const mission = await createMission(db, {
        actorAccountId: owner.id,
        applicantId: applicant.value.id,
        title: 'Japan trip',
      });
      if (!isOk(mission)) throw new Error('mission');
      const document = await registerDocument(db, {
        actorAccountId: owner.id,
        applicantId: applicant.value.id,
        originalName: 'passport.pdf',
      });
      if (!isOk(document)) throw new Error('document');

      const admin = await consentedAccount(db, 'admin@example.test');
      const org = await createOrganization(db, { actorAccountId: admin.id, name: 'Agency A' });
      if (!isOk(org)) throw new Error('org');
      const reviewer = await provisionAccount(db, { email: 'reviewer@example.test' });
      if (!isOk(reviewer)) throw new Error('reviewer');
      await reviewOrganization(db, {
        reviewerAccountId: reviewer.value.id,
        organizationId: org.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const grant = await createGrant(db, {
        actorAccountId: owner.id,
        applicantId: applicant.value.id,
        recipientOrganizationId: org.value.id,
        actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
        purpose: 'collaboration',
      });
      if (!isOk(grant)) throw new Error('grant');
      await acceptGrant(db, { actorAccountId: admin.id, grantId: grant.value.id });
      const request = await requestEvidence(db, {
        actorAccountId: admin.id,
        organizationId: org.value.id,
        applicantId: applicant.value.id,
        missionId: mission.value.id,
        kind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
      });
      if (!isOk(request)) throw new Error(`request: ${request.error.message}`);

      const expectCode = async (kind: ReferenceKind, entityId: string) => {
        const code = await referenceCodeFor(db, kind, entityId);
        expect(code).toMatch(new RegExp(`^${kind}-[0-9A-HJKMNP-TV-Z]{6}$`));
        expect(isValidReferenceCode(kind, code?.slice(2) ?? '')).toBe(true);
      };
      await expectCode('P', applicant.value.id);
      await expectCode('C', mission.value.id);
      await expectCode('D', document.value.id);
      await expectCode('R', request.value.id);
      // The audit trail never carries a code.
      const [row] = await db
        .select({ code: schema.referenceCodes.code })
        .from(schema.referenceCodes)
        .where(
          and(
            eq(schema.referenceCodes.kind, 'C'),
            eq(schema.referenceCodes.entityId, mission.value.id),
          ),
        );
      const [audit] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.auditEvents)
        .where(sql`coalesce(${schema.auditEvents.metadata}::text, '') like ${`%${row?.code}%`}`);
      expect(audit?.n).toBe(0);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'assigns many records in a few set-based rounds, keeping codes already given',
    async () => {
      const db = await freshDb();
      const ids = Array.from({ length: 1200 }, (_, i) => ID(1000 + i));
      const kept = await assignReferenceCode(db, 'D', ids[0] ?? '');
      expect(await assignReferenceCodes(db, 'D', [...ids, ids[1] ?? ''])).toBe(1200);
      const all = await referenceCodesFor(db, 'D', ids);
      expect(all.size).toBe(1200);
      expect(all.get(ids[0] ?? '')).toBe(`D-${kept}`);
      expect(new Set(all.values()).size).toBe(1200);
      expect([...all.values()].every((c) => isValidReferenceCode('D', c.slice(2)))).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a create that rolls back leaves no code behind',
    async () => {
      const db = await freshDb();
      await expect(
        db.transaction(async (tx) => {
          await assignReferenceCode(tx, 'C', ID(9));
          throw new Error('roll back');
        }),
      ).rejects.toThrow('roll back');
      expect(await referenceCodeFor(db, 'C', ID(9))).toBeNull();
    },
    HEAVY_TIMEOUT_MS,
  );
});
