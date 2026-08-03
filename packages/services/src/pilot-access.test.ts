import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  checkPilotAccess,
  createInvitation,
  listInvitations,
  markInvitationAccepted,
  revokeInvitation,
} from './pilot-access';

/**
 * The controlled-pilot access boundary (docs/audits/post-programme-defect-register.md
 * finding #2): the exact hostile scenarios the programme requires — unknown
 * identities, changed emails, replayed invitations, revoked invitations, and
 * cross-identity collisions.
 */

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

describe('checkPilotAccess', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('denies an unknown, uninvited identity', async () => {
    const decision = await checkPilotAccess(db, {
      email: 'unknown@example.com',
      workosUserId: 'workos-unknown',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: false, invitationId: null });
  });

  it('allows an identity with an active invitation', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'Invited@Example.com', // mixed case — must normalize
    });
    expect(isOk(invited)).toBe(true);
    if (!isOk(invited)) return;

    const decision = await checkPilotAccess(db, {
      email: 'invited@example.com',
      workosUserId: 'workos-invited',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: true, invitationId: invited.value.id });
  });

  it('allows the bootstrap/ops allowlist', async () => {
    const decision = await checkPilotAccess(db, {
      email: 'ops@example.com',
      workosUserId: 'workos-ops',
      allowlistEmails: ['ops@example.com'],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: true, invitationId: null });
  });

  it('always allows an identity already bound to an existing account, invitation or not', async () => {
    const existing = await provisionAccount(db, {
      email: 'existing@example.com',
      workosUserId: 'workos-existing',
    });
    if (!isOk(existing)) throw new Error('provision');

    const decision = await checkPilotAccess(db, {
      email: 'existing@example.com',
      workosUserId: 'workos-existing',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: true, invitationId: null });
  });

  it('a changed email on an already-provisioned identity never re-triggers the invitation check (email is not immutable identity)', async () => {
    const existing = await provisionAccount(db, {
      email: 'old-email@example.com',
      workosUserId: 'workos-changed',
    });
    if (!isOk(existing)) throw new Error('provision');

    // The WorkOS identity now reports a different email, and that email was
    // never invited — the immutable WorkOS-id binding must still win.
    const decision = await checkPilotAccess(db, {
      email: 'new-email-never-invited@example.com',
      workosUserId: 'workos-changed',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: true, invitationId: null });
  });

  it('denies a revoked invitation that was never consumed', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter2@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'revoked-before-use@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');
    const revoked = await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'changed our mind',
    });
    expect(isOk(revoked)).toBe(true);

    const decision = await checkPilotAccess(db, {
      email: 'revoked-before-use@example.com',
      workosUserId: 'workos-revoked',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: false, invitationId: null });
  });

  it('revoking an invitation never locks out an identity it already admitted (provisioning-time boundary, not continuous)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter3@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'already-admitted@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // First sign-in: allowed via the invitation, then actually provisioned.
    const firstDecision = await checkPilotAccess(db, {
      email: 'already-admitted@example.com',
      workosUserId: 'workos-admitted',
      allowlistEmails: [],
      bypass: false,
    });
    expect(firstDecision.allowed).toBe(true);
    const provisioned = await provisionAccount(db, {
      email: 'already-admitted@example.com',
      workosUserId: 'workos-admitted',
    });
    if (!isOk(provisioned)) throw new Error('provision');
    if (firstDecision.invitationId) {
      await markInvitationAccepted(db, {
        invitationId: firstDecision.invitationId,
        accountId: provisioned.value.id,
      });
    }

    // Now revoke the invitation.
    await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'no longer needed',
    });

    // A later sign-in from the SAME already-provisioned identity must still
    // be allowed — the account already exists.
    const secondDecision = await checkPilotAccess(db, {
      email: 'already-admitted@example.com',
      workosUserId: 'workos-admitted',
      allowlistEmails: [],
      bypass: false,
    });
    expect(secondDecision).toEqual({ allowed: true, invitationId: null });
  });

  it('a cross-identity collision on the same invited email is refused by provisionAccount, not silently admitted twice', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter4@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'shared-invite@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // The legitimate invitee is allowed by the pilot-access check, then
    // actually provisions and consumes the invitation.
    const legitDecision = await checkPilotAccess(db, {
      email: 'shared-invite@example.com',
      workosUserId: 'workos-legit',
      allowlistEmails: [],
      bypass: false,
    });
    expect(legitDecision.allowed).toBe(true);
    const legitAccount = await provisionAccount(db, {
      email: 'shared-invite@example.com',
      workosUserId: 'workos-legit',
    });
    if (!isOk(legitAccount)) throw new Error('provision');
    if (legitDecision.invitationId) {
      await markInvitationAccepted(db, {
        invitationId: legitDecision.invitationId,
        accountId: legitAccount.value.id,
      });
    }

    // A different WorkOS identity now claims the SAME email. Because an
    // account already exists for this email, `checkPilotAccess` correctly
    // treats it as "existing" (not a fresh invitation to gate) — but
    // `provisionAccount`'s own takeover guard is what actually refuses the
    // identity mismatch, exactly as it does for any other account-takeover
    // attempt (accounts.test.ts). The pilot-access boundary must never
    // paper over or bypass that guard.
    const collisionDecision = await checkPilotAccess(db, {
      email: 'shared-invite@example.com',
      workosUserId: 'workos-different-identity',
      allowlistEmails: [],
      bypass: false,
    });
    expect(collisionDecision.allowed).toBe(true);
    const provisionResult = await provisionAccount(db, {
      email: 'shared-invite@example.com',
      workosUserId: 'workos-different-identity',
    });
    expect(isOk(provisionResult)).toBe(false);
  });

  it('bypasses the check entirely in development mode', async () => {
    const decision = await checkPilotAccess(db, {
      email: 'anyone@example.com',
      workosUserId: 'workos-anyone',
      allowlistEmails: [],
      bypass: true,
    });
    expect(decision).toEqual({ allowed: true, invitationId: null });
  });

  it('a consumed invitation can never be replayed for a second identity, even after the original account is gone (Codex review, PR #65)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-consumed@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'consume-then-replay@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // The legitimate invitee is admitted and consumes the invitation.
    const legitDecision = await checkPilotAccess(db, {
      email: 'consume-then-replay@example.com',
      workosUserId: 'workos-legit-consumer',
      allowlistEmails: [],
      bypass: false,
    });
    expect(legitDecision.invitationId).toBe(invited.value.id);
    const legitAccount = await provisionAccount(db, {
      email: 'consume-then-replay@example.com',
      workosUserId: 'workos-legit-consumer',
    });
    if (!isOk(legitAccount)) throw new Error('provision');
    await markInvitationAccepted(db, {
      invitationId: invited.value.id,
      accountId: legitAccount.value.id,
    });

    // The account is later deleted entirely (simulated directly — deletion
    // workflow itself is covered elsewhere) — no account now exists for
    // this email.
    await db.delete(schema.accounts).where(eq(schema.accounts.id, legitAccount.value.id));

    // A different identity now controlling the same email address must NOT
    // be able to reuse the already-consumed invitation.
    const replayDecision = await checkPilotAccess(db, {
      email: 'consume-then-replay@example.com',
      workosUserId: 'workos-a-different-person-entirely',
      allowlistEmails: [],
      bypass: false,
    });
    expect(replayDecision).toEqual({ allowed: false, invitationId: null });
  });
});

describe('invitation lifecycle', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is idempotent: re-inviting an already-actively-invited email returns the same row', async () => {
    const inviter = await provisionAccount(db, { email: 'idem-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const first = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'idempotent@example.com',
    });
    const second = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'IDEMPOTENT@example.com',
    });
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (isOk(first) && isOk(second)) expect(second.value.id).toBe(first.value.id);
  });

  it('serializes concurrent invitations of the same email so at most one active row ever exists (Codex review, PR #65)', async () => {
    const inviter = await provisionAccount(db, { email: 'race-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');

    // Two concurrent requests for the SAME email — without the database-
    // level partial unique constraint, both could pass the pre-insert
    // check before either transaction commits, leaving two active rows
    // (so revoking one would not actually block the email).
    const [a, b] = await Promise.all([
      createInvitation(db, {
        actorAccountId: inviter.value.id,
        email: 'race-invitee@example.com',
        reason: 'first caller',
      }),
      createInvitation(db, {
        actorAccountId: inviter.value.id,
        email: 'race-invitee@example.com',
        reason: 'second caller',
      }),
    ]);
    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    // Both calls resolve to the SAME row — one call's insert won, the
    // other's unique-violation was recovered by re-reading the winner.
    expect(a.value.id).toBe(b.value.id);

    const allRows = await db
      .select()
      .from(schema.pilotInvitations)
      .where(eq(schema.pilotInvitations.email, 'race-invitee@example.com'));
    expect(allRows).toHaveLength(1);

    // Revoking the single active row now genuinely blocks the email — the
    // real property this constraint protects.
    await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: a.value.id,
      reason: 'done',
    });
    const decision = await checkPilotAccess(db, {
      email: 'race-invitee@example.com',
      workosUserId: 'workos-race-invitee',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision.allowed).toBe(false);
  });

  it('refuses to revoke an already-revoked invitation, and requires a reason', async () => {
    const inviter = await provisionAccount(db, { email: 'revoke-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'double-revoke@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    const noReason = await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: '   ',
    });
    expect(isOk(noReason)).toBe(false);

    const first = await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'first revoke',
    });
    expect(isOk(first)).toBe(true);
    const second = await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'second revoke',
    });
    expect(isOk(second)).toBe(false);
  });

  it('audits invitation creation and revocation', async () => {
    const inviter = await provisionAccount(db, { email: 'audit-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'audited@example.com',
      reason: 'internal tester',
    });
    if (!isOk(invited)) throw new Error('invite');
    await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'done testing',
    });

    const created = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PILOT_INVITATION_CREATED'));
    const revoked = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PILOT_INVITATION_REVOKED'));
    expect(created).toHaveLength(1);
    expect(revoked).toHaveLength(1);
  });

  it('never deletes an invitation row — revocation preserves history, and never deletes on acceptance', async () => {
    const inviter = await provisionAccount(db, { email: 'history-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'history@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');
    await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'done',
    });

    const all = await listInvitations(db);
    expect(all.map((i) => i.id)).toContain(invited.value.id);
    const row = all.find((i) => i.id === invited.value.id);
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.email).toBe('history@example.com');
  });

  it('marks an invitation accepted exactly once, surviving a repeated call', async () => {
    const inviter = await provisionAccount(db, { email: 'accept-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'accept-me@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');
    const account = await provisionAccount(db, {
      email: 'accept-me@example.com',
      workosUserId: 'workos-accept-me',
    });
    if (!isOk(account)) throw new Error('provision');

    await markInvitationAccepted(db, {
      invitationId: invited.value.id,
      accountId: account.value.id,
    });
    const afterFirst = (await listInvitations(db)).find((i) => i.id === invited.value.id);
    const firstAcceptedAt = afterFirst?.acceptedAt;
    expect(firstAcceptedAt).not.toBeNull();
    expect(afterFirst?.acceptedAccountId).toBe(account.value.id);

    // Calling again must not overwrite the original acceptance timestamp.
    await markInvitationAccepted(db, {
      invitationId: invited.value.id,
      accountId: account.value.id,
    });
    const afterSecond = (await listInvitations(db)).find((i) => i.id === invited.value.id);
    expect(afterSecond?.acceptedAt?.getTime()).toBe(firstAcceptedAt?.getTime());
  });
});
