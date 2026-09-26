import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { listFeedbackForMission, listFeedbackForQualityReview, submitFeedback } from './feedback';
import { createMission } from './missions';
import { grantPlatformRole } from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'feedback@example.com' });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    title: 'UK Visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { account, missionId: mission.value.id };
}

/** Bootstraps a PLATFORM_OWNER, then has it grant a fresh account QUALITY_ADMIN. */
async function seedQualityAdmin(db: Db) {
  const owner = await provisionAccount(db, { email: 'feedback-bootstrap@example.com' });
  if (!isOk(owner)) throw new Error('provision');
  const ownerAuth = {
    accountId: owner.value.id,
    email: 'feedback-bootstrap@example.com',
    bootstrapEmails: ['feedback-bootstrap@example.com'],
  };
  await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: owner.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'bootstrap',
    stepUpSatisfied: true,
  });
  const admin = await provisionAccount(db, { email: 'feedback-quality-admin@example.com' });
  if (!isOk(admin)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: admin.value.id,
    role: 'QUALITY_ADMIN',
    reason: 'quality team member',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: admin.value.id,
    email: 'feedback-quality-admin@example.com',
    bootstrapEmails: [],
  };
}

describe('TRU-04 (Commercial V1 Part 7 §9): private post-case feedback', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('submits feedback (owner-only)', async () => {
    const { account, missionId } = await seed(db);
    const result = await submitFeedback(db, {
      actorAccountId: account.id,
      missionId,
      comments: 'The process was clear and the case manager was responsive.',
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.missionId).toBe(missionId);
    expect(result.value.submittedByAccountId).toBe(account.id);
    expect(result.value.comments).toBe(
      'The process was clear and the case manager was responsive.',
    );
  });

  it('refuses empty comments', async () => {
    const { account, missionId } = await seed(db);
    const result = await submitFeedback(db, {
      actorAccountId: account.id,
      missionId,
      comments: '   ',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('listFeedbackForMission is owner-scoped, newest first, and refuses a stranger', async () => {
    const { account, missionId } = await seed(db);
    await submitFeedback(db, { actorAccountId: account.id, missionId, comments: 'First.' });
    await submitFeedback(db, { actorAccountId: account.id, missionId, comments: 'Second.' });

    const list = await listFeedbackForMission(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.comments).toBe('Second.');

    const stranger = await provisionAccount(db, { email: 'feedback-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listFeedbackForMission(db, stranger.value.id, missionId);
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  it('refuses listFeedbackForQualityReview without QUALITY_ADMIN permission', async () => {
    const plain = await provisionAccount(db, { email: 'not-quality-feedback@example.com' });
    if (!isOk(plain)) throw new Error('provision');
    const result = await listFeedbackForQualityReview(db, {
      accountId: plain.value.id,
      email: 'not-quality-feedback@example.com',
      bootstrapEmails: [],
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('listFeedbackForQualityReview returns feedback platform-wide for an authorized quality admin', async () => {
    const { account, missionId } = await seed(db);
    await submitFeedback(db, { actorAccountId: account.id, missionId, comments: 'Great service.' });
    const admin = await seedQualityAdmin(db);

    const result = await listFeedbackForQualityReview(db, admin);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.some((f) => f.comments === 'Great service.')).toBe(true);
    }
  });
});
