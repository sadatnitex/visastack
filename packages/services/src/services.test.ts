import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema, verifyAuditChain } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAccountByEmail, provisionAccount } from './accounts';
import { addFamilyMember, createApplicant, listAllApplicants, listApplicants } from './applicants';
import { appendAuditEvent } from './audit';
import { getConsents, hasConsent, setConsent } from './consent';
import type { Db } from './db';
import {
  editFact,
  getCurrentFactVersion,
  listApplicantProfile,
  listFactHistory,
  registerFieldDefinition,
} from './profile';

// The db migrations live in the @visastack/db package.
const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Provision an account that has already granted CORE_PROCESSING consent. */
async function seedConsentedAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
  const consent = await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  if (!isOk(consent)) throw new Error('consent failed');
  return account;
}

describe('accounts — provisioning is idempotent and audited', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates an account and normalizes the email', async () => {
    const result = await provisionAccount(db, { email: '  Alice@Example.COM ' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.email).toBe('alice@example.com');

    const found = await getAccountByEmail(db, 'ALICE@example.com');
    expect(found?.id).toBe(result.value.id);
  });

  it('returns the same row on repeated provisioning (no duplicate)', async () => {
    const first = await provisionAccount(db, { email: 'bob@example.com' });
    const second = await provisionAccount(db, { email: 'bob@example.com' });
    expect(isOk(first) && isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value.id).toBe(first.value.id);

    const rows = await db.select().from(schema.accounts);
    expect(rows).toHaveLength(1);
    // Exactly one provisioning audit event was written.
    const events = await db.select().from(schema.auditEvents);
    expect(events.filter((e) => e.eventType === 'ACCOUNT_PROVISIONED')).toHaveLength(1);
  });

  it('rejects an invalid email', async () => {
    const result = await provisionAccount(db, { email: 'not-an-email' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });
});

describe('consent — separated, revocable, audited', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('grants and revokes independently per type', async () => {
    const provisioned = await provisionAccount(db, { email: 'c@example.com' });
    if (!isOk(provisioned)) throw new Error('provision failed');
    const id = provisioned.value.id;

    await setConsent(db, {
      actorAccountId: id,
      accountId: id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: id,
      accountId: id,
      type: 'AI_EXTRACTION',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: id,
      accountId: id,
      type: 'AI_EXTRACTION',
      granted: false,
    });

    const state = await getConsents(db, id);
    expect(state.CORE_PROCESSING).toBe(true);
    expect(state.AI_EXTRACTION).toBe(false);
    expect(state.SHARING).toBe(false);
    expect(state.MARKETING).toBe(false);

    expect(await hasConsent(db, id, 'CORE_PROCESSING')).toBe(true);
    expect(await hasConsent(db, id, 'AI_EXTRACTION')).toBe(false);
  });

  it('refuses to set consent for a different account', async () => {
    const a = await provisionAccount(db, { email: 'a2@example.com' });
    const b = await provisionAccount(db, { email: 'b2@example.com' });
    if (!isOk(a) || !isOk(b)) throw new Error('provision failed');
    const result = await setConsent(db, {
      actorAccountId: a.value.id,
      accountId: b.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});

describe('applicants — consent-gated subject records', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('blocks creation without CORE_PROCESSING consent', async () => {
    const provisioned = await provisionAccount(db, { email: 'noconsent@example.com' });
    if (!isOk(provisioned)) throw new Error('provision failed');
    const result = await createApplicant(db, {
      actorAccountId: provisioned.value.id,
      ownerAccountId: provisioned.value.id,
      displayName: 'Self',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('consent_required');
  });

  it('creates SELF and family-member records once consented', async () => {
    const account = await seedConsentedAccount(db, 'owner@example.com');

    const self = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Nazmus Sadat',
    });
    const child = await addFamilyMember(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Child',
      relationship: 'MINOR_GUARDIAN',
      authorityConfirmed: true,
    });
    expect(isOk(self) && isOk(child)).toBe(true);
    if (!isOk(self) || !isOk(child)) return;
    expect(self.value.relationship).toBe('SELF');
    expect(child.value.relationship).toBe('MINOR_GUARDIAN');
    // SELF needs no separate attestation; a guardian record must record one (IAM-04).
    expect(self.value.authorityConfirmedAt).toBeNull();
    expect(child.value.authorityConfirmedAt).not.toBeNull();

    const all = await listApplicants(db, account.id);
    expect(all).toHaveLength(2);
  });

  it('IAM-04: refuses a non-SELF relationship without an explicit authority attestation', async () => {
    const account = await seedConsentedAccount(db, 'no-authority@example.com');
    const result = await addFamilyMember(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Child',
      relationship: 'MINOR_GUARDIAN',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('authority');
  });

  it('lists every applicant platform-wide, for admin pickers/lookups', async () => {
    const a = await seedConsentedAccount(db, 'admin-list-a@example.com');
    const b = await seedConsentedAccount(db, 'admin-list-b@example.com');
    await createApplicant(db, { actorAccountId: a.id, ownerAccountId: a.id, displayName: 'A' });
    await createApplicant(db, { actorAccountId: b.id, ownerAccountId: b.id, displayName: 'B' });

    const all = await listAllApplicants(db);
    expect(all.map((applicant) => applicant.displayName).sort()).toEqual(['A', 'B']);
  });

  it('refuses to create a record for another account', async () => {
    const owner = await seedConsentedAccount(db, 'owner2@example.com');
    const other = await provisionAccount(db, { email: 'other@example.com' });
    if (!isOk(other)) throw new Error('provision failed');
    const result = await createApplicant(db, {
      actorAccountId: other.value.id,
      ownerAccountId: owner.id,
      displayName: 'Intruder',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});

describe('master profile — manual edit is versioned, atomic, authorized', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function seedApplicant(email: string) {
    const account = await seedConsentedAccount(db, email);
    const created = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Owner',
    });
    if (!isOk(created)) throw new Error('applicant failed');
    return { account, applicant: created.value };
  }

  it('rejects an edit to an unknown (unregistered) field', async () => {
    const { account, applicant } = await seedApplicant('p1@example.com');
    const result = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A1234567',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('unknown_field');
  });

  it('sets a fact, then re-edits it preserving immutable history', async () => {
    const { account, applicant } = await seedApplicant('p2@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });

    const first = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A1234567',
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.version.status).toBe('APPLICANT_CONFIRMED');
    expect(first.value.fact.currentVersionId).toBe(first.value.version.id);

    const second = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'B7654321',
      reason: 'renewed passport',
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;

    // Same fact, new current version pointer.
    expect(second.value.fact.id).toBe(first.value.fact.id);
    expect(second.value.fact.currentVersionId).toBe(second.value.version.id);
    expect(second.value.fact.currentVersionId).not.toBe(first.value.version.id);

    // History preserves both versions; nothing was overwritten.
    const history = await listFactHistory(db, first.value.fact.id);
    expect(history).toHaveLength(2);
    expect(history.map((v) => v.value)).toEqual(['A1234567', 'B7654321']);

    const current = await getCurrentFactVersion(db, first.value.fact.id);
    expect(current?.value).toBe('B7654321');
  });

  it('denies (and audits) an edit by a non-owner account', async () => {
    const { applicant } = await seedApplicant('p3@example.com');
    await registerFieldDefinition(db, { key: 'name.full', dataType: 'string' });
    const intruder = await provisionAccount(db, { email: 'intruder@example.com' });
    if (!isOk(intruder)) throw new Error('provision failed');

    const result = await editFact(db, {
      actorAccountId: intruder.value.id,
      applicantId: applicant.id,
      fieldKey: 'name.full',
      value: 'Mallory',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');

    const denials = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'FACT_EDIT_DENIED'));
    expect(denials).toHaveLength(1);
    expect(denials[0]?.result).toBe('DENIED');
  });

  it('supports repeating records keyed distinctly', async () => {
    const { account, applicant } = await seedApplicant('p4@example.com');
    await registerFieldDefinition(db, {
      key: 'address.line',
      dataType: 'string',
      repeating: true,
    });

    const home = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'address.line',
      value: '1 Home St',
      repeatingRecordKey: 'home',
    });
    const work = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'address.line',
      value: '2 Work Ave',
      repeatingRecordKey: 'work',
    });
    expect(isOk(home) && isOk(work)).toBe(true);
    if (!isOk(home) || !isOk(work)) return;
    // Distinct repeating records → distinct facts.
    expect(home.value.fact.id).not.toBe(work.value.fact.id);
  });

  it('projects each fact to its current value via listApplicantProfile', async () => {
    const { account, applicant } = await seedApplicant('p5@example.com');
    await registerFieldDefinition(db, { key: 'given_name', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'family_name', dataType: 'string' });

    await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'given_name',
      value: 'Ada',
    });
    // Re-edit family name so the projection must return the LATEST version.
    await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'family_name',
      value: 'Byron',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'family_name',
      value: 'Lovelace',
    });

    const profile = await listApplicantProfile(db, applicant.id);
    // Ordered by field key: family_name before given_name.
    expect(profile.map((p) => p.fieldKey)).toEqual(['family_name', 'given_name']);
    const byKey = new Map(profile.map((p) => [p.fieldKey, p]));
    expect(byKey.get('family_name')?.value).toBe('Lovelace');
    expect(byKey.get('given_name')?.value).toBe('Ada');
    expect(byKey.get('given_name')?.status).toBe('APPLICANT_CONFIRMED');
  });

  it('rejects a record key on a non-repeating field', async () => {
    const { account, applicant } = await seedApplicant('p5@example.com');
    await registerFieldDefinition(db, { key: 'name.full', dataType: 'string' });
    const result = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'name.full',
      value: 'X',
      repeatingRecordKey: 'oops',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('defaults effectiveFrom to now, but honors an explicit backdated value (master directive §7 "PR 8")', async () => {
    const { account, applicant } = await seedApplicant('p6@example.com');
    await registerFieldDefinition(db, { key: 'address.line', dataType: 'string' });

    const before = new Date();
    const undated = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'address.line',
      value: 'Current address',
    });
    expect(isOk(undated)).toBe(true);
    if (!isOk(undated)) return;
    expect(undated.value.version.effectiveFrom?.getTime()).toBeGreaterThanOrEqual(before.getTime());

    const backdated = new Date('2020-01-15T00:00:00Z');
    const dated = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'address.line',
      value: 'Old address, recorded late',
      effectiveFrom: backdated,
    });
    expect(isOk(dated)).toBe(true);
    if (!isOk(dated)) return;
    expect(dated.value.version.effectiveFrom?.toISOString()).toBe(backdated.toISOString());
    // effectiveFrom is when it became true, not when it was recorded — the
    // two are allowed to diverge.
    expect(dated.value.version.createdAt.getTime()).toBeGreaterThan(backdated.getTime());
  });

  it('rolls back an already-committed nested edit when the caller\'s outer transaction later fails (master directive §7 "PR 8" — atomic proposal approval)', async () => {
    const { account, applicant } = await seedApplicant('p7@example.com');
    await registerFieldDefinition(db, { key: 'given_name', dataType: 'string' });

    // Mirrors approveProposal's shape: editFact is called with an
    // already-open outer transaction (a nested savepoint), and something
    // AFTER it throws — exactly the failure mode that used to leave a fact
    // changed with no record of why. A real Postgres/PGlite rollback, not a
    // mocked one.
    await expect(
      db.transaction(async (tx) => {
        const edit = await editFact(tx, {
          actorAccountId: account.id,
          applicantId: applicant.id,
          fieldKey: 'given_name',
          value: 'Ada',
        });
        expect(isOk(edit)).toBe(true);
        throw new Error('simulated failure after the nested write, before the outer commit');
      }),
    ).rejects.toThrow('simulated failure');

    // Nothing committed: no fact row at all (not even an unpointed one), no
    // version, no audit event — the nested savepoint's work rolled back with
    // the outer transaction.
    const facts = await db
      .select()
      .from(schema.facts)
      .where(eq(schema.facts.applicantId, applicant.id));
    expect(facts).toHaveLength(0);
    const approvals = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'FACT_APPROVED'));
    expect(approvals).toHaveLength(0);
  });
});

describe('audit sink — hash chain across mixed events verifies', () => {
  it('links every event written by the services into one valid chain', async () => {
    const db = await freshDb();
    const account = await seedConsentedAccount(db, 'chain@example.com');
    const created = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Owner',
    });
    if (!isOk(created)) throw new Error('applicant failed');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId: created.value.id,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    const rows = await db.select().from(schema.auditEvents).orderBy(schema.auditEvents.seq);
    expect(rows.length).toBeGreaterThanOrEqual(3);

    // Rebuild the {fields, prevHash, hash} view and verify it chains.
    const chain = rows.map((r) => ({
      prevHash: r.prevHash,
      hash: r.hash,
      fields: {
        eventType: r.eventType,
        actorAccountId: r.actorAccountId,
        actorRole: r.actorRole,
        action: r.action,
        result: r.result,
        method: r.method,
        applicantId: r.applicantId,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        missionId: r.missionId,
        grantId: r.grantId,
        reason: r.reason,
        metadata:
          r.metadata === null ? null : stableStringify(r.metadata as Record<string, unknown>),
      },
    }));
    expect(verifyAuditChain(chain)).toBe(true);
  });
});

// Mirror of the sink's internal canonicalization, for chain verification.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(object[k])}`).join(',')}}`;
}

describe('appendAuditEvent — direct use requires a transaction context', () => {
  it('writes a standalone event with a computed hash', async () => {
    const db = await freshDb();
    const row = await db.transaction(async (tx) =>
      appendAuditEvent(tx, { eventType: 'SYSTEM_CHECK', method: 'SYSTEM', result: 'ALLOWED' }),
    );
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.prevHash).toBeNull();
  });
});
