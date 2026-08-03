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
  attributeInvitation,
  checkPilotAccess,
  claimInvitation,
  createInvitation,
  listInvitations,
  releaseInvitationClaim,
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
    expect(decision).toEqual({ allowed: false, invitationId: null, mustClaimInvitation: false });
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
    expect(decision).toEqual({
      allowed: true,
      invitationId: invited.value.id,
      mustClaimInvitation: true,
    });
  });

  it('allows the bootstrap/ops allowlist', async () => {
    const decision = await checkPilotAccess(db, {
      email: 'ops@example.com',
      workosUserId: 'workos-ops',
      allowlistEmails: ['ops@example.com'],
      bypass: false,
    });
    expect(decision).toEqual({ allowed: true, invitationId: null, mustClaimInvitation: false });
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
    expect(decision).toEqual({ allowed: true, invitationId: null, mustClaimInvitation: false });
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
    expect(decision).toEqual({ allowed: true, invitationId: null, mustClaimInvitation: false });
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
    expect(decision).toEqual({ allowed: false, invitationId: null, mustClaimInvitation: false });
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
    // Claim BEFORE provisioning, matching withSession's real order (Codex
    // review, PR #65, finding #45) — by the time createAccount runs, its
    // own dangling-invitation consumption (finding #53) finds nothing left
    // to do, since this call already claimed it.
    let claimedInvitationId: string | null = null;
    if (firstDecision.invitationId) {
      const claimed = await claimInvitation(db, firstDecision.invitationId);
      expect(claimed).toBe(true);
      claimedInvitationId = firstDecision.invitationId;
    }
    const provisioned = await provisionAccount(db, {
      email: 'already-admitted@example.com',
      workosUserId: 'workos-admitted',
    });
    if (!isOk(provisioned)) throw new Error('provision');
    if (claimedInvitationId) {
      await attributeInvitation(db, {
        invitationId: claimedInvitationId,
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
    expect(secondDecision).toEqual({
      allowed: true,
      invitationId: null,
      mustClaimInvitation: false,
    });
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
      await claimInvitation(db, legitDecision.invitationId);
      await attributeInvitation(db, {
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
    expect(decision).toEqual({ allowed: true, invitationId: null, mustClaimInvitation: false });
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
    await claimInvitation(db, invited.value.id);
    await attributeInvitation(db, {
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
    expect(replayDecision).toEqual({
      allowed: false,
      invitationId: null,
      mustClaimInvitation: false,
    });
  });

  it("a dangling pending invitation for an already-provisioned account is surfaced for consumption on the next check — defense in depth beyond createAccount's own atomic consumption (Codex review, PR #65; see also finding #53)", async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-dangling@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'crash-before-consume@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // Since finding #53, `createAccount` itself already consumes any
    // invitation still active for its own email atomically, in the same
    // transaction as the insert — so calling `provisionAccount` here can no
    // longer reproduce a genuinely dangling row; that specific path is now
    // closed at the source instead of merely recoverable afterward. This
    // check remains defense-in-depth for any OTHER way an account might
    // come to exist without going through that consumption — simulated
    // here with a raw insert standing in for such a row (a legacy account,
    // one created by a future/alternate code path, direct DB intervention),
    // not a claim about how this specific case arises today.
    const accountRows = await db
      .insert(schema.accounts)
      .values({ email: 'crash-before-consume@example.com', workosUserId: 'workos-crash-recovery' })
      .returning();
    const account = accountRows[0];
    if (!account) throw new Error('account insert');

    // A later sign-in retry must surface the dangling invitation for
    // consumption, even though it takes the "account already exists" path —
    // silently returning `invitationId: null` here would leave the row
    // permanently pending: a standing credential able to admit a different
    // identity once this account is later deleted. `mustClaimInvitation` is
    // false here — access never depended on this invitation, it already
    // exists independently via the account.
    const recovery = await checkPilotAccess(db, {
      email: 'crash-before-consume@example.com',
      workosUserId: 'workos-crash-recovery',
      allowlistEmails: [],
      bypass: false,
    });
    expect(recovery).toEqual({
      allowed: true,
      invitationId: invited.value.id,
      mustClaimInvitation: false,
    });

    // The caller (`withSession`) now consumes it exactly as it would for a
    // fresh invitation.
    if (recovery.invitationId) {
      const claimed = await claimInvitation(db, recovery.invitationId);
      expect(claimed).toBe(true);
      await attributeInvitation(db, {
        invitationId: recovery.invitationId,
        accountId: account.id,
      });
    }

    // Once properly consumed, it can never be replayed — even after this
    // account is later deleted.
    await db.delete(schema.accounts).where(eq(schema.accounts.id, account.id));
    const replay = await checkPilotAccess(db, {
      email: 'crash-before-consume@example.com',
      workosUserId: 'workos-a-different-identity',
      allowlistEmails: [],
      bypass: false,
    });
    expect(replay).toEqual({ allowed: false, invitationId: null, mustClaimInvitation: false });
  });

  it('a concurrent revocation wins the race against a provisioning already in flight (Codex review, PR #65)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-race-revoke@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'race-revoke-vs-provision@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // `checkPilotAccess` reads the invitation as active and says this
    // sign-in must claim it.
    const decision = await checkPilotAccess(db, {
      email: 'race-revoke-vs-provision@example.com',
      workosUserId: 'workos-race-revoke',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision).toEqual({
      allowed: true,
      invitationId: invited.value.id,
      mustClaimInvitation: true,
    });

    // An admin revokes it in the instant before the claim runs — simulating
    // exactly the window between `checkPilotAccess` returning and
    // `claimInvitation` executing in `withSession`.
    const revoked = await revokeInvitation(db, {
      actorAccountId: inviter.value.id,
      invitationId: invited.value.id,
      reason: 'realized this was the wrong email',
    });
    expect(isOk(revoked)).toBe(true);

    // The claim must now fail — the admin's revoke wins, and since this
    // decision's `mustClaimInvitation` was true, the caller (`withSession`)
    // must deny the sign-in rather than provision an account anyway.
    const claimed = await claimInvitation(db, invited.value.id);
    expect(claimed).toBe(false);
  });

  it('serializes two concurrent claims of the same invitation — exactly one wins', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-race-claim@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'race-claim@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    const [a, b] = await Promise.all([
      claimInvitation(db, invited.value.id),
      claimInvitation(db, invited.value.id),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('a failed claim on a merely-dangling (non-gating) invitation never blocks access', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-dangling-race@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'dangling-race@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // Simulate the crash-before-consumption state again: the account exists,
    // but the invitation was never claimed.
    const account = await provisionAccount(db, {
      email: 'dangling-race@example.com',
      workosUserId: 'workos-dangling-race',
    });
    if (!isOk(account)) throw new Error('provision');

    const recovery = await checkPilotAccess(db, {
      email: 'dangling-race@example.com',
      workosUserId: 'workos-dangling-race',
      allowlistEmails: [],
      bypass: false,
    });
    expect(recovery.mustClaimInvitation).toBe(false);

    // An admin revokes the dangling invitation between the check and the
    // claim attempt — same window as the gating race above, but here it
    // must NOT matter: access was already granted by the existing account,
    // independent of this invitation.
    if (recovery.invitationId) {
      await revokeInvitation(db, {
        actorAccountId: inviter.value.id,
        invitationId: recovery.invitationId,
        reason: 'cleanup, irrelevant to already-granted access',
      });
      const claimed = await claimInvitation(db, recovery.invitationId);
      expect(claimed).toBe(false);
    }
    // `withSession`'s actual logic: since `mustClaimInvitation` is false,
    // a failed claim here is harmless — access remains granted via the
    // existing account.
    expect(recovery.allowed).toBe(true);
  });

  it('releases a claim when provisioning then fails, so the invitation can still be retried (Codex review, PR #65)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-release@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'release-on-failure@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    const decision = await checkPilotAccess(db, {
      email: 'release-on-failure@example.com',
      workosUserId: 'workos-release-on-failure',
      allowlistEmails: [],
      bypass: false,
    });
    expect(decision.mustClaimInvitation).toBe(true);
    const claimed = await claimInvitation(db, invited.value.id);
    expect(claimed).toBe(true);

    // Simulate the exact failure this finding describes: `provisionAccount`
    // fails (an identity conflict, a transient DB/audit error) AFTER the
    // claim already committed `acceptedAt` — `withSession` releases the
    // claim rather than leaving it permanently burned.
    await releaseInvitationClaim(db, invited.value.id);

    // The invitation is findable and claimable again — a legitimate retry
    // is not locked out until an admin re-invites them.
    const retry = await checkPilotAccess(db, {
      email: 'release-on-failure@example.com',
      workosUserId: 'workos-release-on-failure',
      allowlistEmails: [],
      bypass: false,
    });
    expect(retry).toEqual({
      allowed: true,
      invitationId: invited.value.id,
      mustClaimInvitation: true,
    });
    const reclaimed = await claimInvitation(db, invited.value.id);
    expect(reclaimed).toBe(true);
  });

  it('never releases a claim that was already attributed to a real account', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-no-undo@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'no-undo@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');
    const claimed = await claimInvitation(db, invited.value.id);
    expect(claimed).toBe(true);
    const account = await provisionAccount(db, {
      email: 'no-undo@example.com',
      workosUserId: 'workos-no-undo',
    });
    if (!isOk(account)) throw new Error('provision');
    await attributeInvitation(db, { invitationId: invited.value.id, accountId: account.value.id });

    // A stray/late release call (e.g. a bug, or a retry racing the success
    // path) must never undo a genuinely completed acceptance.
    await releaseInvitationClaim(db, invited.value.id);

    const afterRelease = (await listInvitations(db)).find((i) => i.id === invited.value.id);
    expect(afterRelease?.acceptedAt).not.toBeNull();
    expect(afterRelease?.acceptedAccountId).toBe(account.value.id);
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

  it('refuses to invite an email that already has a provisioned account (Codex review, PR #65)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-existing@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    await provisionAccount(db, { email: 'already-has-account@example.com' });

    const attempt = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'Already-Has-Account@Example.com', // mixed case — must normalize before checking
    });
    expect(isOk(attempt)).toBe(false);

    const rows = await db
      .select()
      .from(schema.pilotInvitations)
      .where(eq(schema.pilotInvitations.email, 'already-has-account@example.com'));
    expect(rows).toHaveLength(0);
  });

  it('never leaves a permanently-unrecoverable invitation when creation races account provisioning for the same email (Codex review, PR #65, rounds 7-8)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-race-provision@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const email = 'race-invite-vs-provision@example.com';

    // Races createInvitation against the REAL provisionAccount (not a raw
    // insert) — both now take the same per-email advisory lock
    // (`lockOnEmail`), so a plain read positioned "later" in a transaction
    // can never see a concurrent transaction's not-yet-committed write —
    // nothing short of a shared lock closes this cross-table race (Codex
    // review, PR #65, round 8 — round 7's in-transaction recheck alone
    // wasn't enough). True mutual exclusion makes exactly two outcomes
    // possible, never a third "broken" one:
    //
    // Caveat (docs/audits/post-programme-defect-register.md D-T3): PGlite
    // itself fully serializes concurrent transactions regardless of
    // advisory-lock contention, so this test's PASS does not by itself
    // distinguish "the lock enforces this" from "PGlite happened to run
    // one transaction to completion before starting the other" — a
    // regression that silently dropped `lockOnEmail` from `createAccount`
    // would NOT reliably fail this test in this harness. The outcome
    // asserted below (never a third, unrecoverable state) is still the
    // right contract to test and holds unconditionally; the *mechanism*
    // claim rests on code review of `db.ts`'s `lockOnEmail` and Postgres's
    // documented advisory-lock semantics, not on this test.
    const [invited, provisioned] = await Promise.all([
      createInvitation(db, { actorAccountId: inviter.value.id, email }),
      provisionAccount(db, { email, workosUserId: 'workos-race-invite-vs-provision' }),
    ]);
    expect(isOk(provisioned)).toBe(true);
    if (!isOk(provisioned)) return;

    if (isOk(invited)) {
      // createInvitation won the lock entirely before provisioning even
      // began — but provisioning's own `createAccount` consumes any
      // invitation still active for this email the instant after it
      // acquires the lock (Codex review, PR #65, finding #53: the lock
      // alone only serializes timing, it doesn't make createAccount aware
      // of what createInvitation just committed — `consumeAnyActiveInvitation`
      // closes that). So this is never left dangling for a later sign-in
      // to clean up — it's consumed atomically, in the same transaction
      // that created the account:
      const rows = await db
        .select()
        .from(schema.pilotInvitations)
        .where(eq(schema.pilotInvitations.id, invited.value.id));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error('invitation row');
      expect(row.acceptedAt).not.toBeNull();
      expect(row.acceptedAccountId).toBe(provisioned.value.id);
    } else {
      // Provisioning won the lock first (or createInvitation's authoritative
      // in-lock recheck otherwise saw the account) — createInvitation
      // correctly refused, leaving no row active at all.
      const rows = await db
        .select()
        .from(schema.pilotInvitations)
        .where(eq(schema.pilotInvitations.email, email));
      expect(rows.filter((r) => r.revokedAt === null && r.acceptedAt === null)).toHaveLength(0);
    }
  });

  it('creating a fresh account consumes a dangling invitation instead of leaving it active alongside it (Codex review, PR #65, finding #53)', async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-consume-create@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const email = 'consume-on-create@example.com';

    // An invitation already exists for this email — e.g. an admin invited
    // it, independent of (and unaware of) an allowlisted identity that is
    // about to sign in on its own — by the time the account for that same
    // email is created.
    const invited = await createInvitation(db, { actorAccountId: inviter.value.id, email });
    if (!isOk(invited)) throw new Error('invite');

    const provisioned = await provisionAccount(db, {
      email,
      workosUserId: 'workos-consume-on-create',
    });
    expect(isOk(provisioned)).toBe(true);
    if (!isOk(provisioned)) return;

    const rows = await db
      .select()
      .from(schema.pilotInvitations)
      .where(eq(schema.pilotInvitations.id, invited.value.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('invitation row');
    // Consumed atomically with account creation — never left active/dangling
    // for a later sign-in to have to clean up.
    expect(row.acceptedAt).not.toBeNull();
    expect(row.acceptedAccountId).toBe(provisioned.value.id);
  });

  it("refreshing an existing account's email consumes a dangling invitation for the NEW email instead of leaving it active (Codex review, PR #65, finding #53)", async () => {
    const inviter = await provisionAccount(db, { email: 'inviter-consume-refresh@example.com' });
    if (!isOk(inviter)) throw new Error('provision');

    // An existing WorkOS-bound account, about to have WorkOS report a new
    // email for it on a later sign-in (provisionAccount's `refreshEmail` path).
    const existing = await provisionAccount(db, {
      email: 'old-email-consume-refresh@example.com',
      workosUserId: 'workos-consume-refresh',
    });
    if (!isOk(existing)) throw new Error('provision existing');

    const newEmail = 'new-email-consume-refresh@example.com';
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: newEmail,
    });
    if (!isOk(invited)) throw new Error('invite');

    // Same identity signs in again; WorkOS now reports the new email. This
    // is the by-id → `refreshEmail` path, entirely unrelated to any
    // invitation-claiming flow — `checkPilotAccess` isn't even in this call
    // chain here, matching how `provisionAccount` is invoked directly
    // elsewhere in this same file.
    const refreshed = await provisionAccount(db, {
      email: newEmail,
      workosUserId: 'workos-consume-refresh',
    });
    expect(isOk(refreshed)).toBe(true);
    if (!isOk(refreshed)) return;
    expect(refreshed.value.email).toBe(newEmail);

    const rows = await db
      .select()
      .from(schema.pilotInvitations)
      .where(eq(schema.pilotInvitations.id, invited.value.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('invitation row');
    expect(row.acceptedAt).not.toBeNull();
    expect(row.acceptedAccountId).toBe(refreshed.value.id);
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

  it('claims an invitation exactly once, and attributes it to the provisioned account', async () => {
    const inviter = await provisionAccount(db, { email: 'accept-inviter@example.com' });
    if (!isOk(inviter)) throw new Error('provision');
    const invited = await createInvitation(db, {
      actorAccountId: inviter.value.id,
      email: 'accept-me@example.com',
    });
    if (!isOk(invited)) throw new Error('invite');

    // Claim BEFORE provisioning, matching withSession's real order (Codex
    // review, PR #65, finding #45) — so createAccount's own
    // dangling-invitation consumption (finding #53) finds nothing left to
    // do, and this test can exercise `claimInvitation`'s own exactly-once
    // semantics directly, unaffected by that side effect.
    const firstClaim = await claimInvitation(db, invited.value.id);
    expect(firstClaim).toBe(true);

    const account = await provisionAccount(db, {
      email: 'accept-me@example.com',
      workosUserId: 'workos-accept-me',
    });
    if (!isOk(account)) throw new Error('provision');

    await attributeInvitation(db, {
      invitationId: invited.value.id,
      accountId: account.value.id,
    });
    const afterFirst = (await listInvitations(db)).find((i) => i.id === invited.value.id);
    const firstAcceptedAt = afterFirst?.acceptedAt;
    expect(firstAcceptedAt).not.toBeNull();
    expect(afterFirst?.acceptedAccountId).toBe(account.value.id);

    // A repeated claim attempt must fail — it was already consumed by the
    // first call — and must not overwrite the original acceptance timestamp.
    const secondClaim = await claimInvitation(db, invited.value.id);
    expect(secondClaim).toBe(false);
    const afterSecond = (await listInvitations(db)).find((i) => i.id === invited.value.id);
    expect(afterSecond?.acceptedAt?.getTime()).toBe(firstAcceptedAt?.getTime());
  });
});
