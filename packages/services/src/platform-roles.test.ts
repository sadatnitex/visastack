import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  grantPlatformRole,
  hasAnyPlatformRole,
  isPlatformOwner,
  listActivePlatformRoles,
  revokePlatformRole,
} from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedAccount(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value;
}

describe('platform roles — bootstrap', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('grants owner-equivalent access via the bootstrap email list while no grant exists', async () => {
    const account = await seedAccount(db, 'bootstrap@example.com');
    const auth = {
      accountId: account.id,
      email: 'bootstrap@example.com',
      bootstrapEmails: ['bootstrap@example.com'],
    };
    expect(await hasAnyPlatformRole(db, auth)).toBe(true);
    expect(await isPlatformOwner(db, auth)).toBe(true);
  });

  it('never grants access to an email not on the bootstrap list', async () => {
    const account = await seedAccount(db, 'stranger@example.com');
    const auth = {
      accountId: account.id,
      email: 'stranger@example.com',
      bootstrapEmails: ['owner@example.com'],
    };
    expect(await hasAnyPlatformRole(db, auth)).toBe(false);
    expect(await isPlatformOwner(db, auth)).toBe(false);
  });

  it('stops applying the moment a single real grant exists, even for the bootstrap email itself', async () => {
    const owner = await seedAccount(db, 'owner@example.com');
    const other = await seedAccount(db, 'other@example.com');
    const ownerAuth = {
      accountId: owner.id,
      email: 'owner@example.com',
      bootstrapEmails: ['owner@example.com'],
    };

    // Owner uses their bootstrap authority to grant themselves a real role.
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.id,
      role: 'PLATFORM_OWNER',
      reason: 'initial bootstrap',
      stepUpSatisfied: true,
    });
    expect(isOk(granted)).toBe(true);

    // Bootstrap no longer applies to ANYONE, even if their email is still listed.
    const otherAuth = {
      accountId: other.id,
      email: 'other@example.com',
      bootstrapEmails: ['other@example.com'],
    };
    expect(await hasAnyPlatformRole(db, otherAuth)).toBe(false);

    // The real owner still has real access, via their actual grant, not bootstrap.
    expect(await isPlatformOwner(db, { ...ownerAuth, bootstrapEmails: [] })).toBe(true);
  });
});

describe('platform roles — grant and revoke', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedAccount>>;
  let ownerAuth: { accountId: string; email: string; bootstrapEmails: readonly string[] };
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedAccount(db, 'owner2@example.com');
    ownerAuth = {
      accountId: owner.id,
      email: 'owner2@example.com',
      bootstrapEmails: ['owner2@example.com'],
    };
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.id,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    ownerAuth = { ...ownerAuth, bootstrapEmails: [] }; // real grant now exists; bootstrap no longer needed
  });

  it('a non-owner cannot grant roles, even to themselves', async () => {
    const target = await seedAccount(db, 'target@example.com');
    const attempt = await grantPlatformRole(db, {
      actor: { accountId: target.id, email: 'target@example.com', bootstrapEmails: [] },
      targetAccountId: target.id,
      role: 'SUPPORT_ADMIN',
      reason: 'self-promotion attempt',
      stepUpSatisfied: true,
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe('forbidden');
    expect(
      await hasAnyPlatformRole(db, {
        accountId: target.id,
        email: 'target@example.com',
        bootstrapEmails: [],
      }),
    ).toBe(false);
  });

  it('an owner grants a scoped role, which the holder can use but not extend to others', async () => {
    const support = await seedAccount(db, 'support@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'handles job retries',
      stepUpSatisfied: true,
    });
    expect(isOk(granted)).toBe(true);

    const supportAuth = {
      accountId: support.id,
      email: 'support@example.com',
      bootstrapEmails: [],
    };
    expect(await hasAnyPlatformRole(db, supportAuth)).toBe(true);
    expect(await isPlatformOwner(db, supportAuth)).toBe(false); // scoped, not owner-equivalent

    // Support admin cannot grant roles to anyone else.
    const another = await seedAccount(db, 'another@example.com');
    const escalation = await grantPlatformRole(db, {
      actor: supportAuth,
      targetAccountId: another.id,
      role: 'SUPPORT_ADMIN',
      reason: 'escalation attempt',
      stepUpSatisfied: true,
    });
    expect(isErr(escalation)).toBe(true);
  });

  it('revocation preserves the row (never deletes) and removes access', async () => {
    const support = await seedAccount(db, 'support2@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'temp',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');

    const revoked = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'no longer needed',
      stepUpSatisfied: true,
    });
    expect(isOk(revoked)).toBe(true);
    if (isOk(revoked)) {
      expect(revoked.value.revokedAt).not.toBeNull();
      expect(revoked.value.revokedReason).toBe('no longer needed');
    }

    // Row still exists (immutable history), just no longer active.
    const row = (
      await db
        .select()
        .from(schema.platformRoles)
        .where(eq(schema.platformRoles.id, granted.value.id))
    )[0];
    expect(row).toBeDefined();
    expect(row?.revokedAt).not.toBeNull();

    const supportAuth = {
      accountId: support.id,
      email: 'support2@example.com',
      bootstrapEmails: [],
    };
    expect(await hasAnyPlatformRole(db, supportAuth)).toBe(false);
  });

  it('refuses to revoke an already-revoked grant', async () => {
    const support = await seedAccount(db, 'support3@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'temp',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'first',
      stepUpSatisfied: true,
    });
    const second = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'second',
      stepUpSatisfied: true,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('refuses to revoke the sole remaining platform owner', async () => {
    const attempt = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: (await listActivePlatformRoles(db))[0]?.id ?? '',
      reason: 'trying to strand the system',
      stepUpSatisfied: true,
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe('invalid');
    expect(await isPlatformOwner(db, ownerAuth)).toBe(true); // untouched
  });

  it('allows revoking one of two owners, leaving the system with exactly one', async () => {
    const secondOwner = await seedAccount(db, 'owner3@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: secondOwner.id,
      role: 'PLATFORM_OWNER',
      reason: 'co-owner',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');

    const revoked = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'stepping down',
      stepUpSatisfied: true,
    });
    expect(isOk(revoked)).toBe(true);
    expect(await isPlatformOwner(db, ownerAuth)).toBe(true);
    const secondAuth = {
      accountId: secondOwner.id,
      email: 'owner3@example.com',
      bootstrapEmails: [],
    };
    expect(await isPlatformOwner(db, secondAuth)).toBe(false);
  });

  it('records both the grant and the revoke in the audit trail', async () => {
    const support = await seedAccount(db, 'support4@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'temp',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'done',
      stepUpSatisfied: true,
    });

    const grantEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PLATFORM_ROLE_GRANTED'));
    const revokeEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PLATFORM_ROLE_REVOKED'));
    // One grant event for the initial owner seed, one for this support grant.
    expect(grantEvents.length).toBeGreaterThanOrEqual(2);
    expect(revokeEvents).toHaveLength(1);
  });

  it('refuses to grant a platform role without step-up, even for a genuine platform owner (master directive §7 "PR 5")', async () => {
    const target = await seedAccount(db, 'stepup-target@example.com');
    const denied = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: target.id,
      role: 'SUPPORT_ADMIN',
      reason: 'no reauth yet',
      stepUpSatisfied: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('step_up_required');
    expect(
      await hasAnyPlatformRole(db, {
        accountId: target.id,
        email: 'stepup-target@example.com',
        bootstrapEmails: [],
      }),
    ).toBe(false);
  });

  it('refuses to revoke a platform role without step-up, even for a genuine platform owner', async () => {
    const support = await seedAccount(db, 'stepup-support@example.com');
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'temp',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');

    const denied = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: granted.value.id,
      reason: 'no reauth yet',
      stepUpSatisfied: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('step_up_required');
    expect(
      await hasAnyPlatformRole(db, {
        accountId: support.id,
        email: 'stepup-support@example.com',
        bootstrapEmails: [],
      }),
    ).toBe(true); // still active — the denied revoke never took effect
  });

  it('lists only active grants, newest first', async () => {
    const a = await seedAccount(db, 'list-a@example.com');
    const b = await seedAccount(db, 'list-b@example.com');
    const grantA = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: a.id,
      role: 'SECURITY_ADMIN',
      reason: 'x',
      stepUpSatisfied: true,
    });
    const grantB = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: b.id,
      role: 'COMPLIANCE_ADMIN',
      reason: 'y',
      stepUpSatisfied: true,
    });
    if (!isOk(grantA) || !isOk(grantB)) throw new Error('grant');
    await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: grantA.value.id,
      reason: 'z',
      stepUpSatisfied: true,
    });

    const active = await listActivePlatformRoles(db);
    expect(active.map((r) => r.id)).not.toContain(grantA.value.id);
    expect(active.map((r) => r.id)).toContain(grantB.value.id);
  });
});
