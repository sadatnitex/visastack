import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import {
  type AiDataMode,
  type AiProviderDataTerms,
  aiProviderTermsFor,
  decideAiProviderUse,
  isAiTermsCheckDue,
  loadAiDataRuleSetting,
  loadAiProviderDataTerms,
  recordAiProviderDataTerms,
  setAiDataRuleSetting,
  unknownAiProviderDataTerms,
  validateAiProviderDataTerms,
} from './ai-data-terms';
import { createDraftAiProviderConfig } from './ai-provider-config';
import type { Db } from './db';
import { grantPlatformRole } from './platform-roles';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedSecurityAdmin(db: Db) {
  const ownerEmail = 'terms-owner@example.com';
  const owner = await provisionAccount(db, { email: ownerEmail });
  if (!isOk(owner)) throw new Error('provision');
  const ownerAuth = { accountId: owner.value.id, email: ownerEmail, bootstrapEmails: [ownerEmail] };
  await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: owner.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'bootstrap',
    stepUpSatisfied: true,
  });
  const admin = await provisionAccount(db, { email: 'terms-admin@example.com' });
  if (!isOk(admin)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: admin.value.id,
    role: 'SECURITY_ADMIN',
    reason: 'AI settings',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return { accountId: admin.value.id, email: 'terms-admin@example.com', bootstrapEmails: [] };
}

type Actor = Awaited<ReturnType<typeof seedSecurityAdmin>>;

async function scope(db: Db, actor: Actor): Promise<StaffScope<'AI_SETTINGS_MANAGE'>> {
  const staff = await staffPrincipal(db, actor, 'AI_SETTINGS_MANAGE');
  if (!staff.ok) throw new Error('staff scope');
  return staff.value;
}

/** What a caller without the role would have to pass: not a genuine scope. */
const NOT_A_SCOPE = {
  kind: 'staff',
  accountId: 'x',
} as unknown as StaffScope<'AI_SETTINGS_MANAGE'>;

async function seedStranger(db: Db) {
  const account = await provisionAccount(db, { email: 'terms-stranger@example.com' });
  if (!isOk(account)) throw new Error('provision');
  return { accountId: account.value.id, email: 'terms-stranger@example.com', bootstrapEmails: [] };
}

async function seedConfig(db: Db, actor: Awaited<ReturnType<typeof seedSecurityAdmin>>) {
  const draft = await createDraftAiProviderConfig(db, {
    actor,
    stepUpSatisfied: true,
    provider: 'gemini',
    model: 'gemini-test',
    apiKey: 'test-key-1234',
    encryption: {
      currentKeyVersion: () => 'v1',
      async generateDataKey() {
        return {
          keyVersion: 'v1',
          plaintextDataKey: Buffer.alloc(32, 1),
          wrappedDataKey: Buffer.alloc(32, 2),
        };
      },
      async unwrapDataKey() {
        return Buffer.alloc(32, 1);
      },
    },
    dataPolicyApproved: true,
    budgetLimitUnits: 1000,
  });
  if (!isOk(draft)) throw new Error('draft');
  return draft.value;
}

function terms(overrides: Partial<AiProviderDataTerms>): AiProviderDataTerms {
  return {
    ...unknownAiProviderDataTerms('config-1'),
    recorded: true,
    tier: 'PAID',
    trainsOnInputs: 'NO',
    termsUrl: 'https://example.com/terms',
    checkedOn: '2026-10-25',
    ...overrides,
  };
}

const MODES: readonly AiDataMode[] = ['synthetic_only', 'real_applicant_data'];

describe('decideAiProviderUse: the one data-terms rule', () => {
  const concerns = [
    ['recorded as training', terms({ trainsOnInputs: 'YES', tier: 'FREE' }), 'trains_on_inputs'],
    ['training not known', terms({ trainsOnInputs: 'UNKNOWN' }), 'training_unknown'],
    ['nothing recorded', unknownAiProviderDataTerms('config-1'), 'terms_unrecorded'],
    ['no terms address', terms({ termsUrl: null }), 'terms_incomplete'],
  ] as const;

  describe('setting off (the default)', () => {
    it.each(concerns)('never blocks when %s, in either mode', (_label, t) => {
      for (const mode of MODES) {
        expect(decideAiProviderUse({ mode, terms: t, requireNoTraining: false }).allowed).toBe(
          true,
        );
      }
    });

    it.each(concerns)('warns only while real applicant data is on, when %s', (_label, t, why) => {
      expect(
        decideAiProviderUse({ mode: 'real_applicant_data', terms: t, requireNoTraining: false }),
      ).toEqual({ allowed: true, warning: why });
      expect(
        decideAiProviderUse({ mode: 'synthetic_only', terms: t, requireNoTraining: false }),
      ).toEqual({ allowed: true, warning: null });
    });

    it('does not warn for a provider recorded as not training, with its terms address', () => {
      expect(
        decideAiProviderUse({
          mode: 'real_applicant_data',
          terms: terms({}),
          requireNoTraining: false,
        }),
      ).toEqual({ allowed: true, warning: null });
    });
  });

  describe('setting on', () => {
    it.each(concerns)('blocks when %s, in either mode', (_label, t, why) => {
      for (const mode of MODES) {
        expect(decideAiProviderUse({ mode, terms: t, requireNoTraining: true })).toEqual({
          allowed: false,
          reason: why,
        });
      }
    });

    it('allows a provider recorded as not training, with its terms address, in either mode', () => {
      for (const mode of MODES) {
        expect(decideAiProviderUse({ mode, terms: terms({}), requireNoTraining: true })).toEqual({
          allowed: true,
          warning: null,
        });
      }
    });
  });

  it('asks for the terms to be read again after 180 days, never before', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    expect(isAiTermsCheckDue(terms({ checkedOn: '2026-10-01' }), now)).toBe(false);
    expect(isAiTermsCheckDue(terms({ checkedOn: '2026-04-01' }), now)).toBe(true);
    expect(isAiTermsCheckDue(unknownAiProviderDataTerms('x'), now)).toBe(true);
  });
});

describe('recording provider data terms per configuration', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records terms for one configuration, newest first, and writes the full answer to the audit chain', async () => {
    const admin = await seedSecurityAdmin(db);
    const config = await seedConfig(db, admin);
    const first = await recordAiProviderDataTerms(db, await scope(db, admin), {
      stepUpSatisfied: true,
      configId: config.id,
      tier: 'FREE',
      trainsOnInputs: 'YES',
      termsUrl: 'https://ai.google.dev/gemini-api/terms',
      checkedOn: '2026-10-24',
    });
    expect(isOk(first)).toBe(true);
    const second = await recordAiProviderDataTerms(db, await scope(db, admin), {
      stepUpSatisfied: true,
      configId: config.id,
      tier: 'PAID',
      trainsOnInputs: 'NO',
      retentionDays: 55,
      region: 'United States',
      termsUrl: 'https://ai.google.dev/gemini-api/terms',
      checkedOn: '2026-10-25',
    });
    expect(isOk(second)).toBe(true);

    const state = await loadAiProviderDataTerms(db, [config.id]);
    expect(state.available).toBe(true);
    const current = aiProviderTermsFor(state, config.id);
    expect(current).toMatchObject({ tier: 'PAID', trainsOnInputs: 'NO', retentionDays: 55 });
    expect(aiProviderTermsFor(state, 'another-config').recorded).toBe(false);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_PROVIDER_TERMS_RECORDED'));
    expect(audit).toHaveLength(2);
    expect(audit.map((e) => e.resourceId)).toEqual([config.id, config.id]);
  });

  it('refuses anyone who is not a security admin, and an admin without a fresh sign-in check', async () => {
    const admin = await seedSecurityAdmin(db);
    const config = await seedConfig(db, admin);
    const stranger = await seedStranger(db);
    const base = {
      configId: config.id,
      tier: 'PAID' as const,
      trainsOnInputs: 'NO' as const,
      termsUrl: 'https://example.com/terms',
      checkedOn: '2026-10-25',
    };
    expect((await staffPrincipal(db, stranger, 'AI_SETTINGS_MANAGE')).ok).toBe(false);
    const forbidden = await recordAiProviderDataTerms(db, NOT_A_SCOPE, {
      ...base,
      stepUpSatisfied: true,
    });
    expect(isErr(forbidden) && forbidden.error.code).toBe('forbidden');
    const noStepUp = await recordAiProviderDataTerms(db, await scope(db, admin), {
      ...base,
      stepUpSatisfied: false,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    expect((await loadAiProviderDataTerms(db, [config.id])).byConfigId.size).toBe(0);
  });

  it('refuses a "does not train" answer without the address of the terms, and a future date', async () => {
    const admin = await seedSecurityAdmin(db);
    const config = await seedConfig(db, admin);
    const noUrl = await recordAiProviderDataTerms(db, await scope(db, admin), {
      stepUpSatisfied: true,
      configId: config.id,
      tier: 'PAID',
      trainsOnInputs: 'NO',
      checkedOn: '2026-10-25',
    });
    expect(isErr(noUrl) && noUrl.error.code).toBe('invalid');
    const future = await recordAiProviderDataTerms(db, await scope(db, admin), {
      stepUpSatisfied: true,
      configId: config.id,
      tier: 'PAID',
      trainsOnInputs: 'UNKNOWN',
      checkedOn: '2026-12-31',
      now: new Date('2026-10-25T00:00:00Z'),
    });
    expect(isErr(future) && future.error.code).toBe('invalid');
  });

  it('refuses a date that does not exist, with a plain message rather than a database error', async () => {
    expect(
      validateAiProviderDataTerms({
        tier: 'FREE',
        trainsOnInputs: 'UNKNOWN',
        checkedOn: '2026-02-30',
      }),
    ).toBe('enter the date the terms were checked');
    expect(
      validateAiProviderDataTerms({
        tier: 'FREE',
        trainsOnInputs: 'UNKNOWN',
        checkedOn: '2026-02-28',
        now: new Date('2026-10-25T00:00:00Z'),
      }),
    ).toBeUndefined();
  });
});

describe('the "Only Use AI Providers That Do Not Train on Inputs" setting', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is off by default, and turning it on or off is audited with the previous value', async () => {
    const admin = await seedSecurityAdmin(db);
    expect(await loadAiDataRuleSetting(db)).toMatchObject({
      requireNoTraining: false,
      source: 'default',
    });
    const on = await setAiDataRuleSetting(db, await scope(db, admin), {
      stepUpSatisfied: true,
      requireNoTraining: true,
      reason: 'Real applicants invited',
    });
    expect(isOk(on)).toBe(true);
    expect((await loadAiDataRuleSetting(db)).requireNoTraining).toBe(true);
    await setAiDataRuleSetting(db, await scope(db, admin), {
      stepUpSatisfied: true,
      requireNoTraining: false,
    });
    expect((await loadAiDataRuleSetting(db)).requireNoTraining).toBe(false);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_DATA_RULE_CHANGED'))
      .orderBy(schema.auditEvents.seq);
    expect(audit.map((e) => e.metadata)).toEqual([
      {
        requireNoTraining: true,
        previousRequireNoTraining: false,
        reason: 'Real applicants invited',
      },
      { requireNoTraining: false, previousRequireNoTraining: true, reason: null },
    ]);
  });

  it('refuses anyone who is not a security admin, and an admin without a fresh sign-in check', async () => {
    const admin = await seedSecurityAdmin(db);
    const stranger = await seedStranger(db);
    expect((await staffPrincipal(db, stranger, 'AI_SETTINGS_MANAGE')).ok).toBe(false);
    const forbidden = await setAiDataRuleSetting(db, NOT_A_SCOPE, {
      stepUpSatisfied: true,
      requireNoTraining: true,
    });
    expect(isErr(forbidden) && forbidden.error.code).toBe('forbidden');
    const noStepUp = await setAiDataRuleSetting(db, await scope(db, admin), {
      stepUpSatisfied: false,
      requireNoTraining: true,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    expect((await loadAiDataRuleSetting(db)).requireNoTraining).toBe(false);
  });

  it('treats an unreadable setting as off, so a passing database error never stops AI for everyone', async () => {
    const failing = {
      transaction: async () => {
        throw new Error('connection reset');
      },
    } as unknown as Db;
    expect(await loadAiDataRuleSetting(failing)).toMatchObject({
      requireNoTraining: false,
      source: 'read_failed',
    });
  });
});

describe('a deploy that lands before the migration', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('reads every configuration as unknown terms and the setting as off, and refuses to save with a plain message', async () => {
    const admin = await seedSecurityAdmin(db);
    const config = await seedConfig(db, admin);
    await db.execute(sql`drop table ai_provider_config_terms`);
    await db.execute(sql`drop table ai_data_rule_settings`);

    const state = await loadAiProviderDataTerms(db, [config.id]);
    expect(state.available).toBe(false);
    expect(aiProviderTermsFor(state, config.id).recorded).toBe(false);
    expect(await loadAiDataRuleSetting(db)).toMatchObject({
      requireNoTraining: false,
      source: 'default',
    });

    const recorded = await recordAiProviderDataTerms(db, await scope(db, admin), {
      stepUpSatisfied: true,
      configId: config.id,
      tier: 'PAID',
      trainsOnInputs: 'UNKNOWN',
      checkedOn: '2026-10-25',
    });
    expect(isErr(recorded) && recorded.error.message).toContain('latest database update');
    const setting = await setAiDataRuleSetting(db, await scope(db, admin), {
      stepUpSatisfied: true,
      requireNoTraining: true,
    });
    expect(isErr(setting) && setting.error.message).toContain('latest database update');

    // Reading inside a caller's transaction does not spoil it.
    await db.transaction(async (tx) => {
      await loadAiProviderDataTerms(tx as unknown as Db, [config.id]);
      await loadAiDataRuleSetting(tx as unknown as Db);
      const still = await tx.select().from(schema.aiProviderConfigs);
      expect(still).toHaveLength(1);
    });
  });
});
