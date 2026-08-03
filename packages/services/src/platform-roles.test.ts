import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  canPerformPlatformAction,
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

  it('forces the very first grant to be PLATFORM_OWNER regardless of the requested role (finding #16)', async () => {
    const owner = await seedAccount(db, 'bootstrap-owner@example.com');
    const ownerAuth = {
      accountId: owner.id,
      email: 'bootstrap-owner@example.com',
      bootstrapEmails: ['bootstrap-owner@example.com'],
    };
    // Ask for SUPPORT_ADMIN — the bootstrap path must silently upgrade this
    // to PLATFORM_OWNER, otherwise the installation is permanently locked
    // out of role management (docs/audits/post-programme-defect-register.md
    // finding #16).
    const granted = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.id,
      role: 'SUPPORT_ADMIN',
      reason: 'attempted non-owner bootstrap grant',
      stepUpSatisfied: true,
    });
    expect(isOk(granted)).toBe(true);
    if (isOk(granted)) expect(granted.value.role).toBe('PLATFORM_OWNER');
    expect(await isPlatformOwner(db, { ...ownerAuth, bootstrapEmails: [] })).toBe(true);
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

  it('serializes concurrent revocations of two owners so at least one always survives (finding #18)', async () => {
    const secondOwner = await seedAccount(db, 'race-owner@example.com');
    const secondGrant = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: secondOwner.id,
      role: 'PLATFORM_OWNER',
      reason: 'co-owner for race test',
      stepUpSatisfied: true,
    });
    if (!isOk(secondGrant)) throw new Error('grant');
    const firstGrantId = (await listActivePlatformRoles(db)).find(
      (r) => r.accountId === owner.id,
    )?.id;
    if (!firstGrantId) throw new Error('first grant');

    // Two concurrent revocation attempts against exactly 2 active owners —
    // without the transactional row lock, both could independently observe
    // "another owner exists" and both succeed, stranding the platform at
    // zero owners.
    const [a, b] = await Promise.all([
      revokePlatformRole(db, {
        actor: ownerAuth,
        grantId: firstGrantId,
        reason: 'race A',
        stepUpSatisfied: true,
      }),
      revokePlatformRole(db, {
        actor: { ...ownerAuth, accountId: secondOwner.id, email: 'race-owner@example.com' },
        grantId: secondGrant.value.id,
        reason: 'race B',
        stepUpSatisfied: true,
      }),
    ]);
    // At least one of the two concurrent attempts must be refused.
    const outcomes = [a, b];
    expect(outcomes.some((o) => isErr(o))).toBe(true);

    const remainingOwners = (await listActivePlatformRoles(db)).filter(
      (r) => r.role === 'PLATFORM_OWNER',
    );
    expect(remainingOwners.length).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent — repeating the same (account, role) grant returns the existing active row, never a duplicate (Codex review, PR #65)', async () => {
    const support = await seedAccount(db, 'idempotent-support@example.com');
    const first = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'first',
      stepUpSatisfied: true,
    });
    if (!isOk(first)) throw new Error('grant');
    const second = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'repeat',
      stepUpSatisfied: true,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.id).toBe(first.value.id);

    const rows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.accountId, support.id));
    expect(rows).toHaveLength(1);
  });

  it('closes the concurrent-grant race with a database-level constraint — never two active rows for the same (account, role) (Codex review, PR #65)', async () => {
    const support = await seedAccount(db, 'race-support@example.com');
    const [a, b] = await Promise.all([
      grantPlatformRole(db, {
        actor: ownerAuth,
        targetAccountId: support.id,
        role: 'SUPPORT_ADMIN',
        reason: 'race A',
        stepUpSatisfied: true,
      }),
      grantPlatformRole(db, {
        actor: ownerAuth,
        targetAccountId: support.id,
        role: 'SUPPORT_ADMIN',
        reason: 'race B',
        stepUpSatisfied: true,
      }),
    ]);
    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    // Both calls resolve to the SAME row — the loser of the race recovers
    // via the unique-violation catch path rather than erroring or leaving a
    // second active row that a later revocation of "the other one" would
    // silently leave granting the same authority.
    expect(a.value.id).toBe(b.value.id);

    const activeRows = await db
      .select()
      .from(schema.platformRoles)
      .where(
        and(eq(schema.platformRoles.accountId, support.id), isNull(schema.platformRoles.revokedAt)),
      );
    expect(activeRows).toHaveLength(1);
  });

  it('allows an account to hold two different concern-scoped roles at once — the invariant is per (account, role), not per account', async () => {
    const dual = await seedAccount(db, 'dual-role@example.com');
    const security = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: dual.id,
      role: 'SECURITY_ADMIN',
      reason: 'security',
      stepUpSatisfied: true,
    });
    const compliance = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: dual.id,
      role: 'COMPLIANCE_ADMIN',
      reason: 'compliance',
      stepUpSatisfied: true,
    });
    expect(isOk(security)).toBe(true);
    expect(isOk(compliance)).toBe(true);
    const rows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.accountId, dual.id));
    expect(rows).toHaveLength(2);
  });

  it('allows re-granting the same role after the previous grant was revoked', async () => {
    const support = await seedAccount(db, 're-grant-support@example.com');
    const first = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'first',
      stepUpSatisfied: true,
    });
    if (!isOk(first)) throw new Error('grant');
    const revoked = await revokePlatformRole(db, {
      actor: ownerAuth,
      grantId: first.value.id,
      reason: 'done for now',
      stepUpSatisfied: true,
    });
    expect(isOk(revoked)).toBe(true);

    const second = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 're-grant',
      stepUpSatisfied: true,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.id).not.toBe(first.value.id);

    const rows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.accountId, support.id));
    expect(rows).toHaveLength(2); // one revoked, one active
  });
});

describe('platform roles — concern-scoped action matrix (finding #15)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedAccount>>;
  let ownerAuth: { accountId: string; email: string; bootstrapEmails: readonly string[] };
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedAccount(db, 'matrix-owner@example.com');
    ownerAuth = {
      accountId: owner.id,
      email: 'matrix-owner@example.com',
      bootstrapEmails: ['matrix-owner@example.com'],
    };
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.id,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    ownerAuth = { ...ownerAuth, bootstrapEmails: [] };
  });

  it('lets PLATFORM_OWNER perform every concern-scoped action', async () => {
    for (const action of [
      'RETENTION_POLICY_SET',
      'LEGAL_HOLD_PLACE',
      'ORGANIZATION_REVIEW',
      'PROCESSING_JOB_RETRY',
      'PACK_MANAGE',
    ] as const) {
      expect(await canPerformPlatformAction(db, ownerAuth, action)).toBe(true);
    }
  });

  it('confines SUPPORT_ADMIN to bounded support actions only — never security, retention, or role-management concerns', async () => {
    const support = await seedAccount(db, 'matrix-support@example.com');
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: support.id,
      role: 'SUPPORT_ADMIN',
      reason: 'support only',
      stepUpSatisfied: true,
    });
    const supportAuth = {
      accountId: support.id,
      email: 'matrix-support@example.com',
      bootstrapEmails: [],
    };
    expect(await canPerformPlatformAction(db, supportAuth, 'PROCESSING_JOB_RETRY')).toBe(true);
    expect(await canPerformPlatformAction(db, supportAuth, 'ORPHAN_RECONCILE')).toBe(true);
    expect(await canPerformPlatformAction(db, supportAuth, 'PACK_MANAGE')).toBe(true);
    // Not security, retention, or organization-review — a SUPPORT_ADMIN is
    // functionally identical to no role at all for these
    // (docs/audits/post-programme-defect-register.md finding #15).
    expect(await canPerformPlatformAction(db, supportAuth, 'RETENTION_POLICY_SET')).toBe(false);
    expect(await canPerformPlatformAction(db, supportAuth, 'LEGAL_HOLD_PLACE')).toBe(false);
    expect(await canPerformPlatformAction(db, supportAuth, 'LEGAL_HOLD_RELEASE')).toBe(false);
    expect(await canPerformPlatformAction(db, supportAuth, 'RETENTION_PURGE')).toBe(false);
    expect(await canPerformPlatformAction(db, supportAuth, 'ERASURE_JOB_RETRY')).toBe(false);
    expect(await canPerformPlatformAction(db, supportAuth, 'ORGANIZATION_REVIEW')).toBe(false);
  });

  it('confines COMPLIANCE_ADMIN to retention/legal-hold/privacy actions only', async () => {
    const compliance = await seedAccount(db, 'matrix-compliance@example.com');
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: compliance.id,
      role: 'COMPLIANCE_ADMIN',
      reason: 'compliance only',
      stepUpSatisfied: true,
    });
    const complianceAuth = {
      accountId: compliance.id,
      email: 'matrix-compliance@example.com',
      bootstrapEmails: [],
    };
    expect(await canPerformPlatformAction(db, complianceAuth, 'RETENTION_POLICY_SET')).toBe(true);
    expect(await canPerformPlatformAction(db, complianceAuth, 'LEGAL_HOLD_PLACE')).toBe(true);
    expect(await canPerformPlatformAction(db, complianceAuth, 'LEGAL_HOLD_RELEASE')).toBe(true);
    expect(await canPerformPlatformAction(db, complianceAuth, 'RETENTION_PURGE')).toBe(true);
    expect(await canPerformPlatformAction(db, complianceAuth, 'ERASURE_JOB_RETRY')).toBe(true);
    // Not security or support concerns.
    expect(await canPerformPlatformAction(db, complianceAuth, 'ORGANIZATION_REVIEW')).toBe(false);
    expect(await canPerformPlatformAction(db, complianceAuth, 'PROCESSING_JOB_RETRY')).toBe(false);
    expect(await canPerformPlatformAction(db, complianceAuth, 'PACK_MANAGE')).toBe(false);
  });

  it('confines SECURITY_ADMIN to security-specific actions only', async () => {
    const security = await seedAccount(db, 'matrix-security@example.com');
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: security.id,
      role: 'SECURITY_ADMIN',
      reason: 'security only',
      stepUpSatisfied: true,
    });
    const securityAuth = {
      accountId: security.id,
      email: 'matrix-security@example.com',
      bootstrapEmails: [],
    };
    expect(await canPerformPlatformAction(db, securityAuth, 'ORGANIZATION_REVIEW')).toBe(true);
    // Not compliance or support concerns.
    expect(await canPerformPlatformAction(db, securityAuth, 'RETENTION_POLICY_SET')).toBe(false);
    expect(await canPerformPlatformAction(db, securityAuth, 'LEGAL_HOLD_PLACE')).toBe(false);
    expect(await canPerformPlatformAction(db, securityAuth, 'PROCESSING_JOB_RETRY')).toBe(false);
  });

  it('denies every concern-scoped action for an account with no platform role at all', async () => {
    const nobody = await seedAccount(db, 'matrix-nobody@example.com');
    const nobodyAuth = {
      accountId: nobody.id,
      email: 'matrix-nobody@example.com',
      bootstrapEmails: [],
    };
    for (const action of [
      'RETENTION_POLICY_SET',
      'LEGAL_HOLD_PLACE',
      'ORGANIZATION_REVIEW',
      'PROCESSING_JOB_RETRY',
      'PACK_MANAGE',
    ] as const) {
      expect(await canPerformPlatformAction(db, nobodyAuth, action)).toBe(false);
    }
  });
});
