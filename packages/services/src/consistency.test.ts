import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import {
  CONSISTENCY_LABELS,
  CONSISTENCY_REASON_TEXT,
  type ClassifyDeclarationInput,
  classifyDeclarationChange,
  compareFactVersions,
} from './consistency';
import { type Db, schema as dbSchema } from './db';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { createGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
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

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const classify = (input: ClassifyDeclarationInput) => classifyDeclarationChange(input);

describe('consistency vocabulary (PROGRAMME section 8)', () => {
  it('uses exactly the five approved results', () => {
    expect(Object.values(CONSISTENCY_LABELS)).toEqual([
      'Consistent',
      'Legitimate change',
      'Context difference',
      'Needs clarification',
      'Insufficient information',
    ]);
  });

  it('explains every reason in plain words, with no verdict on authenticity or approval', () => {
    for (const text of Object.values(CONSISTENCY_REASON_TEXT)) {
      expect(text).toMatch(/^[A-Z].*\.$/);
      expect(text).not.toMatch(/fraud|fake|verified|approv|reject|suspicious/i);
    }
  });
});

describe('classifyDeclarationChange (v1.2 T10, R05)', () => {
  it('passport renewal: a new number that took effect later is a legitimate change', () => {
    expect(
      classify({
        fieldKey: 'passport_number',
        prior: { value: 'A1234567', effectiveFrom: day('2018-03-01') },
        current: { value: 'B7654321', effectiveFrom: day('2024-02-10') },
      }),
    ).toEqual({ result: 'LEGITIMATE_CHANGE', reason: 'later_effective_date' });
  });

  it('a later salary in the same currency is a legitimate change', () => {
    expect(
      classify({
        fieldKey: 'monthly_salary',
        prior: {
          value: '80000',
          effectiveFrom: day('2023-01-01'),
          currency: 'BDT',
          basis: 'GROSS',
        },
        current: {
          value: '95000',
          effectiveFrom: day('2025-01-01'),
          currency: 'BDT',
          basis: 'GROSS',
        },
      }).result,
    ).toBe('LEGITIMATE_CHANGE');
  });

  it('amounts with no recorded currency or tax basis are insufficient information, never assumed the same', () => {
    expect(
      classify({
        fieldKey: 'monthly_salary',
        prior: { value: '80000', effectiveFrom: day('2023-01-01') },
        current: { value: '1200', effectiveFrom: day('2025-01-01') },
      }),
    ).toEqual({ result: 'INSUFFICIENT_INFORMATION', reason: 'currency_unknown' });
    expect(
      classify({
        fieldKey: 'monthly_salary',
        prior: { value: '80000', effectiveFrom: day('2023-01-01'), currency: 'BDT' },
        current: { value: '95000', effectiveFrom: day('2025-01-01'), currency: 'BDT' },
      }),
    ).toEqual({ result: 'INSUFFICIENT_INFORMATION', reason: 'basis_unknown' });
  });

  it('the same number written differently is consistent, but not across currencies', () => {
    const base = { fieldKey: 'monthly_salary' };
    expect(
      classify({
        ...base,
        prior: { value: '80,000', effectiveFrom: null, currency: 'BDT' },
        current: { value: '80000', effectiveFrom: null, currency: 'BDT' },
      }),
    ).toEqual({ result: 'CONSISTENT', reason: 'same_value_different_formatting' });
    expect(
      classify({
        ...base,
        prior: { value: '1000', effectiveFrom: null, currency: 'USD' },
        current: { value: '1000', effectiveFrom: null, currency: 'BDT' },
      }).reason,
    ).toBe('different_currency');
  });

  it('gross versus net is a context difference, never a contradiction', () => {
    expect(
      classify({
        fieldKey: 'monthly_salary',
        prior: {
          value: '100000',
          effectiveFrom: day('2025-01-01'),
          currency: 'BDT',
          basis: 'GROSS',
        },
        current: {
          value: '82000',
          effectiveFrom: day('2025-01-01'),
          currency: 'BDT',
          basis: 'NET',
        },
      }),
    ).toEqual({ result: 'CONTEXT_DIFFERENCE', reason: 'different_basis' });
  });

  it('an amount whose tax basis is recorded on one side only is insufficient information', () => {
    expect(
      classify({
        fieldKey: 'annual_income',
        prior: {
          value: '1200000',
          effectiveFrom: day('2024-07-01'),
          currency: 'BDT',
          basis: 'GROSS',
        },
        current: { value: '980000', effectiveFrom: day('2024-07-01'), currency: 'BDT' },
      }),
    ).toEqual({ result: 'INSUFFICIENT_INFORMATION', reason: 'basis_unknown' });
  });

  it('different currencies are a context difference; a missing currency is insufficient information', () => {
    expect(
      classify({
        fieldKey: 'annual_income',
        prior: { value: '1200000', effectiveFrom: day('2024-07-01'), currency: 'BDT' },
        current: { value: '14000', effectiveFrom: day('2024-07-01'), currency: 'USD' },
      }).reason,
    ).toBe('different_currency');
    expect(
      classify({
        fieldKey: 'annual_income',
        prior: { value: '1200000', effectiveFrom: day('2024-07-01'), currency: 'BDT' },
        current: { value: '14000', effectiveFrom: day('2024-07-01'), currency: null },
      }),
    ).toEqual({ result: 'INSUFFICIENT_INFORMATION', reason: 'currency_unknown' });
  });

  it('a recorded other name is a context difference', () => {
    expect(
      classify({
        fieldKey: 'family_name',
        prior: { value: 'Rahman', effectiveFrom: day('2015-01-01') },
        current: { value: 'Chowdhury', effectiveFrom: day('2015-01-01') },
        knownAliases: ['rahman'],
      }),
    ).toEqual({ result: 'CONTEXT_DIFFERENCE', reason: 'known_alias' });
  });

  it('an unknown date stays unknown: insufficient information, never a guess', () => {
    for (const [prior, current] of [
      [null, day('2024-01-01')],
      [day('2024-01-01'), null],
      [null, null],
    ] as const) {
      expect(
        classify({
          fieldKey: 'residential_address',
          prior: { value: 'House 1, Dhaka', effectiveFrom: prior },
          current: { value: 'House 9, Dhaka', effectiveFrom: current },
        }),
      ).toEqual({ result: 'INSUFFICIENT_INFORMATION', reason: 'date_unknown' });
    }
  });

  it('a historical correction for the same date needs clarification and keeps the prior value', () => {
    const prior = { value: 'Acme Ltd', effectiveFrom: day('2022-05-01') };
    const result = classify({
      fieldKey: 'employer_name',
      prior,
      current: { value: 'Acme Holdings Ltd', effectiveFrom: day('2022-05-01') },
    });
    expect(result).toEqual({ result: 'NEEDS_CLARIFICATION', reason: 'same_time_different_value' });
    expect(prior.value).toBe('Acme Ltd');
  });

  it('a newer value dated earlier than the old one needs clarification', () => {
    expect(
      classify({
        fieldKey: 'employer_name',
        prior: { value: 'Acme Ltd', effectiveFrom: day('2022-05-01') },
        current: { value: 'Beta Ltd', effectiveFrom: day('2021-01-01') },
      }).reason,
    ).toBe('earlier_effective_date');
  });

  it('a date of birth that differs needs clarification even with later dates', () => {
    expect(
      classify({
        fieldKey: 'date_of_birth',
        prior: { value: '1990-04-02', effectiveFrom: day('2019-01-01') },
        current: { value: '1990-02-04', effectiveFrom: day('2025-01-01') },
      }),
    ).toEqual({ result: 'NEEDS_CLARIFICATION', reason: 'fixed_fact_differs' });
  });

  it('the same value is consistent; letter case and spacing alone do not make a difference', () => {
    const base = { fieldKey: 'given_name', current: { value: 'Ayesha', effectiveFrom: null } };
    expect(classify({ ...base, prior: { value: 'Ayesha', effectiveFrom: null } }).reason).toBe(
      'same_value',
    );
    expect(classify({ ...base, prior: { value: ' AYESHA ', effectiveFrom: null } })).toEqual({
      result: 'CONSISTENT',
      reason: 'same_value_different_formatting',
    });
  });

  it('a missing value is insufficient information', () => {
    expect(
      classify({
        fieldKey: 'employer_name',
        prior: { value: null, effectiveFrom: day('2022-05-01') },
        current: { value: 'Acme Ltd', effectiveFrom: day('2023-05-01') },
      }).result,
    ).toBe('INSUFFICIENT_INFORMATION');
  });
});

describe('compareFactVersions (v1.2 R05, R06)', () => {
  let db: Db;
  const encryption = fakeKeyManagementPort();

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'SENSITIVE',
    });
    await registerFieldDefinition(db, { key: 'monthly_salary', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'monthly_salary_currency', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'family_name', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'name_alternate', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'employer_name', dataType: 'string' });
  });

  async function owner(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
    const account = provisioned.value;
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      const consent = await setConsent(db, {
        actorAccountId: account.id,
        accountId: account.id,
        type,
        granted: true,
      });
      if (!isOk(consent)) throw new Error('consent failed');
    }
    const applicant = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Self',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    return { accountId: account.id, applicantId: applicant.value.id };
  }

  async function save(
    who: { accountId: string; applicantId: string },
    fieldKey: string,
    value: string,
    extra: { effectiveFrom?: Date; reason?: string } = {},
  ) {
    const saved = await editFact(db, {
      actorAccountId: who.accountId,
      applicantId: who.applicantId,
      fieldKey,
      value,
      encryption,
      ...extra,
    });
    if (!isOk(saved)) throw new Error(`save failed: ${JSON.stringify(saved.error)}`);
    return saved.value.version;
  }

  it('compares an exact prior protected version with the current one, values exactly as recorded', async () => {
    const me = await owner('me@example.com');
    const old = await save(me, 'passport_number', 'A1234567', { effectiveFrom: day('2018-03-01') });
    const renewed = await save(me, 'passport_number', 'B7654321', {
      effectiveFrom: day('2024-02-10'),
      reason: 'Renewed at the passport office',
    });

    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: old.id,
      encryption,
    });
    expect(isOk(compared)).toBe(true);
    if (!isOk(compared)) return;
    expect(compared.value).toMatchObject({
      fieldKey: 'passport_number',
      result: 'LEGITIMATE_CHANGE',
      label: 'Legitimate change',
      prior: {
        factVersionId: old.id,
        value: 'A1234567',
        effectiveFrom: '2018-03-01T00:00:00.000Z',
      },
      current: {
        factVersionId: renewed.id,
        value: 'B7654321',
        explanation: 'Renewed at the passport office',
      },
    });

    // The audit trail names ids and the result, never a value.
    const events = await db
      .select()
      .from(dbSchema.auditEvents)
      .where(eq(dbSchema.auditEvents.eventType, 'DECLARATION_COMPARED'));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toMatch(/A1234567|B7654321/);
  }, 30_000);

  it('details saved without a date compare as insufficient information', async () => {
    const me = await owner('me@example.com');
    const first = await save(me, 'employer_name', 'Acme Ltd');
    await save(me, 'employer_name', 'Beta Ltd');
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: first.id,
    });
    expect(isOk(compared) && compared.value.reason).toBe('date_unknown');
    expect(isOk(compared) && compared.value.prior.effectiveFrom).toBeNull();
  }, 30_000);

  it('reads the currency in force for each side before comparing amounts', async () => {
    const me = await owner('me@example.com');
    await save(me, 'monthly_salary_currency', 'BDT');
    const before = await save(me, 'monthly_salary', '80000', { effectiveFrom: day('2023-01-01') });
    await save(me, 'monthly_salary_currency', 'USD');
    await save(me, 'monthly_salary', '1200', { effectiveFrom: day('2025-01-01') });
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: before.id,
    });
    expect(isOk(compared)).toBe(true);
    if (!isOk(compared)) return;
    expect(compared.value.result).toBe('CONTEXT_DIFFERENCE');
    expect(compared.value.prior.currency).toBe('BDT');
    expect(compared.value.current.currency).toBe('USD');
    // A caller with the snapshot time gets the currency in force at that moment instead.
    const atSnapshot = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: before.id,
      priorAsOf: new Date(),
    });
    expect(isOk(atSnapshot) && atSnapshot.value.prior.currency).toBe('USD');
  }, 30_000);

  it('reads the currency for each side as of when it was declared, whatever order the details were saved in', async () => {
    const me = await owner('me@example.com');
    // Amount first, currency on the next save: the order the form invites.
    const before = await save(me, 'monthly_salary', '80000', { effectiveFrom: day('2023-01-01') });
    await save(me, 'monthly_salary_currency', 'BDT');
    await save(me, 'monthly_salary', '95000', { effectiveFrom: day('2025-01-01') });
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: before.id,
    });
    expect(isOk(compared)).toBe(true);
    if (!isOk(compared)) return;
    expect(compared.value.prior.currency).toBe('BDT');
    expect(compared.value.current.currency).toBe('BDT');
    // No tax basis is recorded anywhere yet, so the honest answer is insufficient information.
    expect(compared.value.reason).toBe('basis_unknown');
  }, 30_000);

  it('an amount with no currency recorded at all is insufficient information', async () => {
    const me = await owner('me@example.com');
    const before = await save(me, 'monthly_salary', '80000', { effectiveFrom: day('2023-01-01') });
    await save(me, 'monthly_salary', '1200', { effectiveFrom: day('2025-01-01') });
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: before.id,
    });
    expect(isOk(compared) && compared.value.reason).toBe('currency_unknown');
  }, 30_000);

  it('reads an effective date equal to the save time (the old default) as not known', async () => {
    const me = await owner('me@example.com');
    const old = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: new Date() });
    await save(me, 'employer_name', 'Beta Ltd', { effectiveFrom: day('2030-01-01') });
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: old.id,
    });
    expect(isOk(compared) && compared.value.reason).toBe('date_unknown');
    expect(isOk(compared) && compared.value.prior.effectiveFrom).toBeNull();
  }, 30_000);

  it('refuses a "current" version older than the prior one, and a malformed id, with the usual answer', async () => {
    const me = await owner('me@example.com');
    const older = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: day('2020-01-01') });
    const newer = await save(me, 'employer_name', 'Beta Ltd', { effectiveFrom: day('2022-01-01') });
    for (const attempt of [
      { priorFactVersionId: newer.id, currentFactVersionId: older.id },
      { priorFactVersionId: 'not-a-uuid' },
      { priorFactVersionId: older.id, currentFactVersionId: 'x' },
    ]) {
      const result = await compareFactVersions(db, {
        actorAccountId: me.accountId,
        applicantId: me.applicantId,
        ...attempt,
      });
      expect(isErr(result) && result.error.message).toBe('That version is not available.');
    }
  }, 30_000);

  it('uses recorded other names for a name difference', async () => {
    const me = await owner('me@example.com');
    const maiden = await save(me, 'family_name', 'Rahman', { effectiveFrom: day('2010-01-01') });
    await save(me, 'family_name', 'Chowdhury', { effectiveFrom: day('2010-01-01') });
    await save(me, 'name_alternate', 'Rahman');
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: maiden.id,
    });
    expect(isOk(compared) && compared.value.reason).toBe('known_alias');
  }, 30_000);

  it('a correction leaves the prior version exactly as it was, and an explanation does not clear the difference', async () => {
    const me = await owner('me@example.com');
    const wrong = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: day('2022-05-01') });
    await save(me, 'employer_name', 'Acme Holdings Ltd', {
      effectiveFrom: day('2022-05-01'),
      reason: 'The old name was a typing mistake',
    });
    const compared = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: wrong.id,
    });
    expect(isOk(compared) && compared.value.result).toBe('NEEDS_CLARIFICATION');
    const [row] = await db
      .select()
      .from(dbSchema.factVersions)
      .where(eq(dbSchema.factVersions.id, wrong.id));
    expect(row).toEqual(wrong);
  }, 30_000);

  it('refuses anyone but the owner, including a recipient with an active grant, and audits it', async () => {
    const me = await owner('me@example.com');
    const old = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: day('2022-05-01') });
    await save(me, 'employer_name', 'Beta Ltd', { effectiveFrom: day('2024-05-01') });
    const other = await owner('other@example.com');
    const grant = await createGrant(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      recipientAccountId: other.accountId,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    expect(isOk(grant)).toBe(true);

    const refused = await compareFactVersions(db, {
      actorAccountId: other.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: old.id,
    });
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
    expect(isErr(refused) && refused.error.message).not.toMatch(/Acme|Beta/);
    const denied = await db
      .select()
      .from(dbSchema.auditEvents)
      .where(eq(dbSchema.auditEvents.eventType, 'DECLARATION_COMPARISON_DENIED'));
    expect(denied).toHaveLength(1);
  }, 30_000);

  it('a version id from another person, another detail or nowhere gets the same answer', async () => {
    const me = await owner('me@example.com');
    const mine = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: day('2022-05-01') });
    const myOtherDetail = await save(me, 'family_name', 'Rahman');
    const other = await owner('other@example.com');
    const theirs = await save(other, 'employer_name', 'Secret Co', {
      effectiveFrom: day('2022-05-01'),
    });

    const attempts = [
      { priorFactVersionId: theirs.id },
      { priorFactVersionId: randomUUID() },
      { priorFactVersionId: mine.id, currentFactVersionId: myOtherDetail.id },
      { priorFactVersionId: mine.id, currentFactVersionId: theirs.id },
    ];
    for (const attempt of attempts) {
      const result = await compareFactVersions(db, {
        actorAccountId: me.accountId,
        applicantId: me.applicantId,
        ...attempt,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('not_found');
        expect(result.error.message).toBe('That version is not available.');
      }
    }
  }, 30_000);

  it('never shows a protected value without the encryption service', async () => {
    const me = await owner('me@example.com');
    const old = await save(me, 'passport_number', 'A1234567', { effectiveFrom: day('2018-03-01') });
    const result = await compareFactVersions(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      priorFactVersionId: old.id,
    });
    expect(isErr(result) && result.error.code).toBe('encryption_unavailable');
  }, 30_000);
});
