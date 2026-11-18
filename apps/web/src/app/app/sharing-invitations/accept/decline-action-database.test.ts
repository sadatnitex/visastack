import { randomBytes } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  createApplicant,
  createSharingInvitation,
  provisionAccount,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** DECL1: the Decline post for a sharing invitation, against a real database. */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));

const { declineSharingInvitationAction } = await import('./actions');

const key = randomBytes(32);
const encryption: KeyManagementPort = {
  currentKeyVersion: () => 'fixture-v1',
  generateDataKey: async () => ({
    keyVersion: 'fixture-v1',
    plaintextDataKey: key,
    wrappedDataKey: new Uint8Array([1]),
  }),
  unwrapDataKey: async () => key,
};
const INITIAL = { ok: true, message: '' };
const form = (token: string) => {
  const data = new FormData();
  data.set('token', token);
  return data;
};

async function account(db: Db, email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('fixture');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const)
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type,
      granted: true,
    });
  return made.value.id;
}

describe('declineSharingInvitationAction (DECL1)', () => {
  let db: Db;
  let token = '';
  let invitationId = '';

  beforeEach(async () => {
    vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    state.db = db;
    const owner = await account(db, 'owner@example.test');
    const applicant = await createApplicant(db, {
      actorAccountId: owner,
      ownerAccountId: owner,
      displayName: 'Synthetic Traveller',
    });
    if (!applicant.ok) throw new Error('fixture');
    const made = await createSharingInvitation(db, {
      actorAccountId: owner,
      applicantId: applicant.value.id,
      email: 'friend@example.test',
      actions: ['VIEW_METADATA'],
      purpose: 'Synthetic review',
      encryption,
    });
    if (!made.ok) throw new Error('fixture');
    token = made.value.rawToken;
    invitationId = made.value.invitation.id;
  }, 60_000);

  const status = async () =>
    (
      await db
        .select({ status: schema.sharingInvitations.status })
        .from(schema.sharingInvitations)
        .where(eq(schema.sharingInvitations.id, invitationId))
    )[0]?.status;

  it('ends the invitation and lands on the one Invitation Declined page', async () => {
    state.accountId = await account(db, 'friend@example.test');
    await expect(declineSharingInvitationAction(INITIAL, form(token))).rejects.toThrow(
      'NEXT_REDIRECT /app/invitations/declined',
    );
    expect(await status()).toBe('DECLINED');
  });

  it('answers someone else, and a second try, with the same plain words, and never the link', async () => {
    state.accountId = await account(db, 'stranger@example.test');
    const stranger = await declineSharingInvitationAction(INITIAL, form(token));
    expect(stranger).toEqual({ ok: false, message: 'Invitation unavailable.' });
    expect(await status()).toBe('PENDING');

    state.accountId = await account(db, 'friend@example.test');
    await expect(declineSharingInvitationAction(INITIAL, form(token))).rejects.toThrow();
    const again = await declineSharingInvitationAction(INITIAL, form(token));
    expect(again).toEqual(stranger);
    expect(JSON.stringify(again)).not.toContain(token);
  });

  it('does nothing while sharing invitations are switched off', async () => {
    vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'false');
    state.accountId = await account(db, 'friend@example.test');
    expect((await declineSharingInvitationAction(INITIAL, form(token))).ok).toBe(false);
    expect(await status()).toBe('PENDING');
  });
});
