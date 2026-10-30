import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { provisionAccount } from './accounts';
import {
  aiEntitlementFor,
  getAiFeatureState,
  listAiFeatureSettings,
  updateAiFeatureSetting,
} from './ai-feature-settings';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function ownerProof() {
  const account = await provisionAccount(db, { email: 'person@example.com' });
  if (!isOk(account)) throw new Error('account');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const proof = await requireAccess(
    db,
    accountPrincipal(account.value.id),
    'VIEW_METADATA',
    { applicantId: applicant.value.id },
    { purpose: 'ai_features' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value;
}

async function owner() {
  const actor = await seedStaffAccount(db, 'PLATFORM_OWNER', 'owner@platform.example.com');
  return staffScopeFor(db, actor, 'AI_FEATURES_MANAGE');
}

describe('AI feature state', () => {
  it('is off for AI App Suggestions until the platform owner turns it on, then 15 a day', async () => {
    const proof = await ownerProof();
    expect(await getAiFeatureState(db, 'ai_app_suggestions', { proof })).toEqual({
      feature: 'ai_app_suggestions',
      available: false,
      reason: 'turned_off',
      dailyLimit: 15,
    });
    const staff = await owner();
    const saved = await updateAiFeatureSetting(db, staff, {
      feature: 'ai_app_suggestions',
      enabled: true,
      dailyLimit: null,
      stepUpSatisfied: true,
    });
    expect(saved).toEqual({ ok: true, value: { changed: true } });
    expect(await getAiFeatureState(db, 'ai_app_suggestions', { proof })).toMatchObject({
      available: true,
      reason: null,
      dailyLimit: 15,
    });
    // The smaller of the plan's and the admin's limit.
    await updateAiFeatureSetting(db, staff, {
      feature: 'ai_app_suggestions',
      enabled: true,
      dailyLimit: 4,
      stepUpSatisfied: true,
    });
    expect((await getAiFeatureState(db, 'ai_app_suggestions', { proof })).dailyLimit).toBe(4);
    await updateAiFeatureSetting(db, staff, {
      feature: 'ai_app_suggestions',
      enabled: true,
      dailyLimit: 900,
      stepUpSatisfied: true,
    });
    expect((await getAiFeatureState(db, 'ai_app_suggestions', { proof })).dailyLimit).toBe(15);
  });

  it('says not available yet while the migration has not run, and off for a forged context', async () => {
    const proof = await ownerProof();
    await db.execute(sql`drop table platform_ai_feature_settings`);
    expect(await getAiFeatureState(db, 'ai_app_suggestions', { proof })).toMatchObject({
      available: false,
      reason: 'not_available_yet',
    });
    expect(
      await getAiFeatureState(db, 'ai_app_suggestions', { proof: { ...proof } as never }),
    ).toMatchObject({ available: false, reason: 'turned_off' });
  });

  it('gives everyone the FREE tier today', () => {
    expect(aiEntitlementFor({ accountId: null }).tier).toBe('FREE');
    expect(aiEntitlementFor({ accountId: 'any' }).features.ai_app_suggestions).toEqual({
      included: true,
      dailyLimit: 15,
    });
  });
});

describe('changing an AI feature', () => {
  it('is for the platform owner only, after a fresh sign-in check, within the limits, and audited', async () => {
    const security = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@platform.example.com');
    const other = await staffScopeFor(db, security, 'AI_SETTINGS_MANAGE');
    expect(
      (await listAiFeatureSettings(db, other as never)).ok,
      'another role cannot read it',
    ).toBe(false);
    const staff = await owner();
    const change = (enabled: boolean, dailyLimit: number | null, stepUpSatisfied = true) =>
      updateAiFeatureSetting(db, staff, {
        feature: 'ai_app_suggestions',
        enabled,
        dailyLimit,
        stepUpSatisfied,
      });
    expect((await change(true, null, false)).ok).toBe(false);
    for (const limit of [0, 1001, 2.5]) expect((await change(true, limit)).ok).toBe(false);
    expect(
      (
        await updateAiFeatureSetting(db, staff, {
          feature: 'automatic_reading' as never,
          enabled: true,
          dailyLimit: null,
          stepUpSatisfied: true,
        })
      ).ok,
    ).toBe(false);
    expect(await db.select().from(schema.platformAiFeatureSettings)).toEqual([]);

    expect(await change(true, 10)).toEqual({ ok: true, value: { changed: true } });
    expect(await change(true, 10)).toEqual({ ok: true, value: { changed: false } });
    expect(await change(false, 10)).toEqual({ ok: true, value: { changed: true } });
    const list = await listAiFeatureSettings(db, staff);
    expect(list.ok && list.value.features).toEqual([
      expect.objectContaining({
        feature: 'ai_app_suggestions',
        name: 'AI App Suggestions',
        enabled: false,
        adminDailyLimit: 10,
        planDailyLimit: 15,
        ready: true,
      }),
    ]);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_FEATURE_SETTING_UPDATED'));
    expect(audit.map((row) => row.metadata)).toEqual([
      { before: { enabled: false, dailyLimit: null }, after: { enabled: true, dailyLimit: 10 } },
      { before: { enabled: true, dailyLimit: 10 }, after: { enabled: false, dailyLimit: 10 } },
    ]);
  });
});
