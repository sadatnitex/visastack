import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAccountByWorkosUserId, provisionAccount, reportUnboundAccounts } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function countIdentityBindings(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, 'ACCOUNT_IDENTITY_BOUND'));
  return rows.length;
}

describe('account identity binding (WorkOS immutable id)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('binds a fresh account to the WorkOS id and is idempotent on repeat sign-in', async () => {
    const first = await provisionAccount(db, {
      email: 'user@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.workosUserId).toBe('user_W1');

    const again = await provisionAccount(db, {
      email: 'user@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(again)).toBe(true);
    if (isOk(again)) expect(again.value.id).toBe(first.value.id);

    const all = await db.select().from(schema.accounts);
    expect(all).toHaveLength(1);
  });

  it('does NOT create a duplicate when the same identity signs in with a changed email', async () => {
    const created = await provisionAccount(db, {
      email: 'old@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    if (!isOk(created)) throw new Error('provision failed');

    // WorkOS keeps the same id; the user changed their email.
    const changed = await provisionAccount(db, {
      email: 'new@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(changed)).toBe(true);
    if (isOk(changed)) {
      expect(changed.value.id).toBe(created.value.id);
      expect(changed.value.email).toBe('new@example.com'); // mutable contact data
    }
    expect(await db.select().from(schema.accounts)).toHaveLength(1);
  });

  it('claims a legacy (unbound) account by verified email, once, and audits it', async () => {
    // Legacy account created before identity binding (no workosUserId).
    const legacy = await provisionAccount(db, { email: 'legacy@example.com' });
    if (!isOk(legacy)) throw new Error('provision failed');
    expect(legacy.value.workosUserId).toBeNull();

    const bound = await provisionAccount(db, {
      email: 'legacy@example.com',
      workosUserId: 'user_W9',
      emailVerified: true,
    });
    expect(isOk(bound)).toBe(true);
    if (isOk(bound)) {
      expect(bound.value.id).toBe(legacy.value.id); // same row, now bound
      expect(bound.value.workosUserId).toBe('user_W9');
    }
    expect(await countIdentityBindings(db)).toBe(1);
  });

  it('refuses to claim a legacy account when the email is NOT verified (fail closed)', async () => {
    await provisionAccount(db, { email: 'legacy2@example.com' });

    const attempt = await provisionAccount(db, {
      email: 'legacy2@example.com',
      workosUserId: 'user_W2',
      emailVerified: false,
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe('forbidden');

    // The legacy account remains unbound.
    const byId = await getAccountByWorkosUserId(db, 'user_W2');
    expect(byId).toBeUndefined();
  });

  it('refuses a different identity signing in with an email already bound (account-takeover guard)', async () => {
    // Victim owns victim@example.com bound to W_VICTIM.
    const victim = await provisionAccount(db, {
      email: 'victim@example.com',
      workosUserId: 'user_VICTIM',
      emailVerified: true,
    });
    if (!isOk(victim)) throw new Error('provision failed');

    // Attacker's WorkOS identity presents the same email address.
    const attack = await provisionAccount(db, {
      email: 'victim@example.com',
      workosUserId: 'user_ATTACKER',
      emailVerified: true,
    });
    expect(isErr(attack)).toBe(true);
    if (isErr(attack)) expect(attack.error.code).toBe('forbidden');

    // The victim account is untouched and still bound to the victim id.
    const stillVictim = await getAccountByWorkosUserId(db, 'user_VICTIM');
    expect(stillVictim?.id).toBe(victim.value.id);
    expect(await getAccountByWorkosUserId(db, 'user_ATTACKER')).toBeUndefined();
  });

  it('two concurrent sign-ins racing on the same email but DIFFERENT identities: exactly one succeeds, never a cross-identity account', async () => {
    const [first, second] = await Promise.all([
      provisionAccount(db, {
        email: 'racer@example.com',
        workosUserId: 'user_R1',
        emailVerified: true,
      }),
      provisionAccount(db, {
        email: 'racer@example.com',
        workosUserId: 'user_R2',
        emailVerified: true,
      }),
    ]);
    const results = [first, second];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);
    const loser = results.find(isErr);
    if (loser) expect(loser.error.code).toBe('forbidden');

    // Exactly one account exists, bound to whichever identity actually won —
    // never a session for one identity handed the other identity's account.
    const rows = await db.select().from(schema.accounts);
    expect(rows).toHaveLength(1);
    const winnerId = rows[0]?.workosUserId;
    expect(['user_R1', 'user_R2']).toContain(winnerId);
    const loserId = winnerId === 'user_R1' ? 'user_R2' : 'user_R1';
    expect(await getAccountByWorkosUserId(db, loserId)).toBeUndefined();

    // The conflict is safely audited (never silently swallowed).
    const conflicts = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ACCOUNT_IDENTITY_CONFLICT'));
    expect(conflicts).toHaveLength(1);

    // The losing identity isn't locked out — its own next sign-in gets a
    // fresh, correctly-bound account of its own, never the winner's.
    const retried = await provisionAccount(db, {
      email: 'racer-retry@example.com',
      workosUserId: loserId,
      emailVerified: true,
    });
    expect(isOk(retried)).toBe(true);
    if (isOk(retried)) expect(retried.value.workosUserId).toBe(loserId);
  });

  it('keeps two distinct identities as two distinct accounts', async () => {
    const a = await provisionAccount(db, {
      email: 'a@example.com',
      workosUserId: 'user_A',
      emailVerified: true,
    });
    const b = await provisionAccount(db, {
      email: 'b@example.com',
      workosUserId: 'user_B',
      emailVerified: true,
    });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (isOk(a) && isOk(b)) expect(a.value.id).not.toBe(b.value.id);
    expect(await db.select().from(schema.accounts)).toHaveLength(2);
  });
});

describe('reportUnboundAccounts — WorkOS ID migration dry run', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists only accounts with no bound WorkOS identity, newest first, with an applicant-count signal', async () => {
    // Bound — never appears in the report.
    await provisionAccount(db, {
      email: 'bound@example.com',
      workosUserId: 'user_BOUND',
      emailVerified: true,
    });

    // Unbound, no data — likely dead weight.
    const emptyLegacy = await provisionAccount(db, { email: 'empty-legacy@example.com' });
    if (!isOk(emptyLegacy)) throw new Error('provision');

    // Unbound, but owns real data — legitimate, awaiting re-bind on next sign-in.
    const activeLegacy = await provisionAccount(db, { email: 'active-legacy@example.com' });
    if (!isOk(activeLegacy)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: activeLegacy.value.id,
      accountId: activeLegacy.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await createApplicant(db, {
      actorAccountId: activeLegacy.value.id,
      ownerAccountId: activeLegacy.value.id,
      displayName: 'Someone',
    });

    const report = await reportUnboundAccounts(db);
    expect(report).toHaveLength(2);
    expect(report.map((r) => r.email).sort()).toEqual([
      'active-legacy@example.com',
      'empty-legacy@example.com',
    ]);

    const active = report.find((r) => r.email === 'active-legacy@example.com');
    const empty = report.find((r) => r.email === 'empty-legacy@example.com');
    expect(active?.applicantCount).toBe(1);
    expect(empty?.applicantCount).toBe(0);
  });

  it('is empty once every account is bound', async () => {
    await provisionAccount(db, {
      email: 'a@example.com',
      workosUserId: 'user_A',
      emailVerified: true,
    });
    expect(await reportUnboundAccounts(db)).toHaveLength(0);
  });
});
