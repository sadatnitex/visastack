import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS,
  grantCommercialOverride,
  isCommercialOverrideActive,
  listCommercialOverridesForOrganization,
  revokeCommercialOverride,
} from './commercial-override';
import type { Db } from './db';
import { createOrganization, reviewOrganization } from './organizations';
import { grantPlatformRole } from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

async function seedPlatformOwner(db: Db, tag: string) {
  const p = await provisionAccount(db, { email: `owner-${tag}@platform.example.com` });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  const granted = await grantPlatformRole(db, {
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [account.email] },
    targetAccountId: account.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: account.id,
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [] as string[] },
  };
}

async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

describe('commercial override -- grant, revoke, expiry (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'override');
  });

  it('grantCommercialOverride refuses a non-owner and requires step-up', async () => {
    const { organizationId } = await seedOrganization(db, 'auth');
    const stranger = await provisionAccount(db, { email: 'stranger-override@example.com' });
    if (!isOk(stranger)) throw new Error('provision');

    const byStranger = await grantCommercialOverride(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-override@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      organizationId,
      reason: 'test',
      durationDays: 7,
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const noStepUp = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      organizationId,
      reason: 'test',
      durationDays: 7,
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');
  });

  it('requires a non-empty reason, a duration within (0, 30] days, and refuses an unknown organization', async () => {
    const { organizationId } = await seedOrganization(db, 'valid');

    const noReason = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: '   ',
      durationDays: 7,
    });
    expect(isErr(noReason)).toBe(true);
    if (isErr(noReason)) expect(noReason.error.code).toBe('invalid');

    const zeroDuration = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'test',
      durationDays: 0,
    });
    expect(isErr(zeroDuration)).toBe(true);
    if (isErr(zeroDuration)) expect(zeroDuration.error.code).toBe('invalid');

    const tooLong = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'test',
      durationDays: COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS + 1,
    });
    expect(isErr(tooLong)).toBe(true);
    if (isErr(tooLong)) expect(tooLong.error.code).toBe('invalid');

    const badOrg = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      reason: 'test',
      durationDays: 7,
    });
    expect(isErr(badOrg)).toBe(true);
    if (isErr(badOrg)) expect(badOrg.error.code).toBe('not_found');
  });

  it('grants a real override, audited, and isCommercialOverrideActive reads it as active until it expires', async () => {
    const { organizationId } = await seedOrganization(db, 'grant');
    const now = new Date();

    const granted = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'billing dispute -- let them keep working while we sort it out',
      durationDays: 7,
    });
    expect(isOk(granted)).toBe(true);
    if (!isOk(granted)) return;
    expect(granted.value.revokedAt).toBeNull();

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'COMMERCIAL_OVERRIDE_GRANTED'));
    expect(events).toHaveLength(1);

    expect(await isCommercialOverrideActive(db, organizationId, now)).toBe(true);
    // Well past the 7-day expiry.
    const wayLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(await isCommercialOverrideActive(db, organizationId, wayLater)).toBe(false);
  });

  it("a different organization never sees another org's override as active", async () => {
    const { organizationId: orgA } = await seedOrganization(db, 'iso-a');
    const { organizationId: orgB } = await seedOrganization(db, 'iso-b');
    await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: orgA,
      reason: 'test',
      durationDays: 7,
    });
    expect(await isCommercialOverrideActive(db, orgA)).toBe(true);
    expect(await isCommercialOverrideActive(db, orgB)).toBe(false);
  });

  it('revokeCommercialOverride is idempotent, requires owner + step-up, and immediately deactivates the override', async () => {
    const { organizationId } = await seedOrganization(db, 'revoke');
    const granted = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'test',
      durationDays: 7,
    });
    if (!isOk(granted)) throw new Error('grant');

    const stranger = await provisionAccount(db, { email: 'stranger-revoke@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const byStranger = await revokeCommercialOverride(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-revoke@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      overrideId: granted.value.id,
      reason: 'test',
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const noStepUp = await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      overrideId: granted.value.id,
      reason: 'test',
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');

    expect(await isCommercialOverrideActive(db, organizationId)).toBe(true);

    const revoked = await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      overrideId: granted.value.id,
      reason: 'resolved',
    });
    expect(isOk(revoked)).toBe(true);
    if (isOk(revoked)) expect(revoked.value.revokedAt).not.toBeNull();

    expect(await isCommercialOverrideActive(db, organizationId)).toBe(false);

    // Idempotent: revoking again returns the same revoked row, not an error.
    const revokedAgain = await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      overrideId: granted.value.id,
      reason: 'once more',
    });
    expect(isOk(revokedAgain)).toBe(true);
    if (isOk(revokedAgain)) expect(revokedAgain.value.revokedAt).not.toBeNull();

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'COMMERCIAL_OVERRIDE_REVOKED'));
    expect(events).toHaveLength(1);
  });

  it('revokeCommercialOverride returns not_found for an unknown overrideId', async () => {
    const result = await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      overrideId: '00000000-0000-0000-0000-000000000000',
      reason: 'test',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });

  it('multiple independently-granted overrides can coexist for the same organization -- no uniqueness constraint', async () => {
    const { organizationId } = await seedOrganization(db, 'multi');
    const first = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'first reason',
      durationDays: 3,
    });
    const second = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'second, independent reason',
      durationDays: 10,
    });
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);

    const history = await listCommercialOverridesForOrganization(db, organizationId);
    expect(history).toHaveLength(2);

    // Revoking the first leaves the second still active.
    if (!isOk(first)) return;
    await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      overrideId: first.value.id,
      reason: 'done',
    });
    expect(await isCommercialOverrideActive(db, organizationId)).toBe(true);
  });
});
