import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import type { KeyManagementPort } from './ports';
import {
  type FactHistoryOptions,
  editFact,
  listApplicantProfile,
  listFactHistory,
  registerFieldDefinition,
} from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';

/** WP-SB1: one person's whole profile history, read a page at a time, owner only. */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

describe('listApplicantProfile history for a whole profile (WP-SB1)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    await registerFieldDefinition(db, { key: 'given_name', dataType: 'string' });
    await registerFieldDefinition(db, {
      key: 'employer_name',
      dataType: 'string',
      packId: 'professional',
    });
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'SENSITIVE',
    });
  });

  async function person(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
    const accountId = provisioned.value.id;
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Self',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    return { accountId, applicantId: applicant.value.id };
  }

  /** The owner's proof for their own record, then one page of its history. */
  async function history(
    who: { accountId: string; applicantId: string },
    options: FactHistoryOptions = {},
  ) {
    const proof = await requireAccess(
      db,
      accountPrincipal(who.accountId),
      'VIEW_METADATA',
      { applicantId: who.applicantId },
      { purpose: 'profile_view' },
    );
    if (!isOk(proof)) throw new Error('gate refused');
    const page = await listApplicantProfile(db, proof.value, { history: options });
    if (!isOk(page)) throw new Error(`history refused: ${JSON.stringify(page.error)}`);
    return page.value;
  }

  async function save(who: { accountId: string; applicantId: string }, key: string, value: string) {
    const saved = await editFact(db, {
      actorAccountId: who.accountId,
      applicantId: who.applicantId,
      fieldKey: key,
      value,
      encryption: fakeKeyManagementPort(),
    });
    if (!isOk(saved)) throw new Error(`save failed: ${JSON.stringify(saved.error)}`);
    return saved.value;
  }

  /** Adds `count` older versions to a fact, several sharing one instant, to test the id tie-break. */
  async function backfill(factId: string, count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      factId,
      value: `old ${i}`,
      // Groups of four share one millisecond.
      createdAt: new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 4) * 1000),
    }));
    await db.insert(schema.factVersions).values(rows);
  }

  it('refuses anything but a genuine owner proof', async () => {
    const ana = await person('ana-forged@example.test');
    await save(ana, 'given_name', 'Ana');
    const forged = { applicant: { id: ana.applicantId }, actor: { kind: 'applicant_owner' } };
    const refused = await listApplicantProfile(db, forged as never, { history: {} });
    expect(isOk(refused)).toBe(false);
  });

  it('keeps the one-fact form unchanged', async () => {
    const ana = await person('ana-hist@example.test');
    const first = await save(ana, 'given_name', 'Ana');
    await save(ana, 'given_name', 'Anna');
    const versions = await listFactHistory(db, first.fact.id);
    expect(versions.map((v) => v.value)).toEqual(['Ana', 'Anna']);
  });

  it('pages newest first through every version, with no gap and no repeat', async () => {
    const ana = await person('ana-pages@example.test');
    const saved = await save(ana, 'given_name', 'Ana');
    await backfill(saved.fact.id, 119);

    const seen: string[] = [];
    let before: string | undefined;
    const sizes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const page = await history(ana, { limit: 50, ...(before ? { before } : {}) });
      expect(page.total).toBe(120);
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      before = page.nextCursor;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);

    const all = await db
      .select({ id: schema.factVersions.id, at: schema.factVersions.createdAt })
      .from(schema.factVersions)
      .where(eq(schema.factVersions.factId, saved.fact.id));
    const expected = [...all]
      .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1))
      .map((row) => row.id);
    expect(seen).toEqual(expected);
  });

  it('marks the current version, never carries a protected value, and says who saved it', async () => {
    const ana = await person('ana-who@example.test');
    const ben = await person('ben-who@example.test');
    await save(ana, 'given_name', 'Ana');
    const second = await save(ana, 'given_name', 'Anna');
    await save(ana, 'passport_number', 'P1234567');
    const unrecorded = await save(ana, 'employer_name', 'Harbor Ltd');
    await db
      .update(schema.factVersions)
      .set({ actorAccountId: ben.accountId })
      .where(eq(schema.factVersions.id, second.version.id));
    await db
      .update(schema.factVersions)
      .set({ actorAccountId: null })
      .where(eq(schema.factVersions.id, unrecorded.version.id));

    const page = await history(ana);
    const byValue = new Map(page.items.map((item) => [item.value ?? 'locked', item]));
    expect(byValue.get('Anna')).toMatchObject({ isCurrent: true, actor: 'someone_else' });
    expect(byValue.get('Ana')).toMatchObject({ isCurrent: false, actor: 'owner' });
    expect(byValue.get('Harbor Ltd')).toMatchObject({
      actor: 'not_recorded',
      packId: 'professional',
    });
    const locked = byValue.get('locked');
    expect(locked).toMatchObject({ isProtected: true, value: null, packId: 'universal' });
    expect(JSON.stringify(page)).not.toContain('P1234567');
    expect(JSON.stringify(page)).not.toContain(ben.accountId);
  });

  it('filters by part of the profile and binds the cursor to the person and the filter', async () => {
    const ana = await person('ana-scope@example.test');
    const ben = await person('ben-scope@example.test');
    const anaFact = await save(ana, 'given_name', 'Ana');
    await backfill(anaFact.fact.id, 5);
    await save(ana, 'employer_name', 'Harbor Ltd');
    await save(ben, 'given_name', 'Ben');

    const professional = await history(ana, { pack: 'professional' });
    expect(professional.items.map((item) => item.value)).toEqual(['Harbor Ltd']);
    expect(professional.total).toBe(1);

    const first = await history(ana, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor ?? '';

    // Ana's cursor on Ben's history, or on another filter, gives that view's first page.
    const benPage = await history(ben, { before: cursor });
    expect(benPage.items.map((item) => item.value)).toEqual(['Ben']);
    const otherFilter = await history(ana, { pack: 'professional', before: cursor });
    expect(otherFilter.items.map((item) => item.value)).toEqual(['Harbor Ltd']);
    // A malformed cursor or filter never errors: first page, every part.
    const junk = await history(ana, {
      before: 'not a cursor',
      pack: "x'; drop table facts; --",
      limit: 2,
    });
    expect(junk.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    expect(junk.total).toBe(7);
  });
});
