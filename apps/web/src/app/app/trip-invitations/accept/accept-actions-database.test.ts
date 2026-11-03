import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type AuthorizedApplicant,
  type Db,
  RATE_LIMITS,
  TRIP_COMPANIONS_SWITCH,
  accountPrincipal,
  addCompanion,
  createApplicant,
  provisionAccount,
  removeCompanion,
  requireAccess,
  setConsent,
  startGroupTrip,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashedSubject } from '../../../../lib/client-address';

/**
 * Answering a trip invitation, against a real database. Pins that joining is a confirmed answer
 * (the page never joins), that only the account whose verified email was invited can answer, that
 * the share level comes from a fixed list and the name stays within its bounds, and that every bad
 * invitation and every "too many tries" answers in one fixed wording, so nothing says which case it
 * was or whether an address has an account. Nothing said back ever holds the link or an address.
 */

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  address: '203.0.113.9',
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': state.address }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));

const { acceptTripInvitationAction, declineTripInvitationAction } = await import('./actions');
const { CONSENT_FIRST, INVITATION_BUSY, INVITATION_UNAVAILABLE } = await import('./words');
const JOINED_PATH = '/app/trip-invitations/accept?done=joined';
const DECLINED_PATH = '/app/trip-invitations/accept?done=declined';

const INITIAL = { ok: true, message: '' };
const FRIEND = 'friend@example.com';
const UNAVAILABLE = { ok: false, message: INVITATION_UNAVAILABLE };
const BUSY = { ok: false, message: INVITATION_BUSY };
const UNKNOWN = 'N'.repeat(43);

let db: Db;
let previousSwitch: string | undefined;
let organiserId: string;
let applicantId: string;
let tripId: string;
let said: unknown[] = [];

const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

async function newAccount(email: string, options: { consent?: boolean } = {}): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('account');
  if (options.consent !== false) {
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
  }
  await db
    .update(schema.accounts)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.accounts.id, made.value.id));
  return made.value.id;
}

async function organiserProof(): Promise<AuthorizedApplicant<'MANAGE'>> {
  const proof = await requireAccess(
    db,
    accountPrincipal(organiserId),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!proof.ok) throw new Error('proof');
  return proof.value as AuthorizedApplicant<'MANAGE'>;
}

async function invite(email = FRIEND, name = 'Nadia Rahman') {
  const added = await addCompanion(await organiserProof(), tripId, { name, email });
  if (!added.ok || !added.value.invitation) throw new Error('invite');
  return { id: added.value.companion.id, token: added.value.invitation.rawToken };
}

const row = async (id: string) =>
  (
    await db.select().from(schema.umpeTripCompanions).where(eq(schema.umpeTripCompanions.id, id))
  )[0];

/** Runs an action; a redirect is returned as its path, anything else as what it answered. */
async function answer(run: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await run();
    said.push(result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
      const to = error.message.replace('NEXT_REDIRECT ', '');
      said.push(to);
      return to;
    }
    throw error;
  }
}

const join = (token: string, extra: readonly (readonly [string, string])[] = []) =>
  answer(() =>
    acceptTripInvitationAction(
      INITIAL,
      form([['token', token], ['intent', 'join'], ['displayName', 'Nadia Rahman'], ...extra]),
    ),
  );
const decline = (token: string) =>
  answer(() =>
    declineTripInvitationAction(
      INITIAL,
      form([
        ['token', token],
        ['intent', 'decline'],
      ]),
    ),
  );

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  said = [];
  state.address = '203.0.113.9';
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  organiserId = await newAccount('organiser@example.com');
  const applicant = await createApplicant(db, {
    actorAccountId: organiserId,
    ownerAccountId: organiserId,
    displayName: 'Rahima Akter',
  });
  if (!applicant.ok) throw new Error('applicant');
  applicantId = applicant.value.id;
  const started = await startGroupTrip(await organiserProof(), {
    destination: 'Japan',
    purpose: 'Tourism',
  });
  if (!started.ok) throw new Error('trip');
  tripId = started.value.tripId;
  state.accountId = await newAccount(FRIEND);
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) Reflect.deleteProperty(process.env, TRIP_COMPANIONS_SWITCH);
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

describe('joining a trip', () => {
  it('joins on a confirmed answer from the invited account, and goes to a page with no link in it', async () => {
    const { id, token } = await invite();
    const to = await join(token, [['shareLevel', 'PLAN_STATUS']]);
    expect(to).toBe(JOINED_PATH);
    expect(JOINED_PATH).not.toContain('token');
    expect(await row(id)).toMatchObject({
      state: 'JOINED',
      joinedAccountId: state.accountId,
      shareLevel: 'PLAN_STATUS',
      tokenHash: null,
      expiresAt: null,
    });
    expect(JSON.stringify(said)).not.toContain(token);
    expect(JSON.stringify(said)).not.toContain(FRIEND);
  });

  it('is not a join unless the join button was pressed: the link, a bare post and a decline press never join', async () => {
    const { id, token } = await invite();
    const noIntent = await answer(() =>
      acceptTripInvitationAction(
        INITIAL,
        form([
          ['token', token],
          ['displayName', 'Nadia Rahman'],
        ]),
      ),
    );
    expect(noIntent).toEqual(UNAVAILABLE);
    const declinePressed = await answer(() =>
      acceptTripInvitationAction(
        INITIAL,
        form([
          ['token', token],
          ['intent', 'decline'],
          ['displayName', 'Nadia Rahman'],
        ]),
      ),
    );
    expect(declinePressed).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
  });

  it('keeps the name the organiser typed unless the person changes it, and says which in the audit', async () => {
    const first = await invite();
    await join(first.token);
    const second = await invite('second.friend@example.com', 'Karim Uddin');
    state.accountId = await newAccount('second.friend@example.com');
    await answer(() =>
      acceptTripInvitationAction(
        INITIAL,
        form([
          ['token', second.token],
          ['intent', 'join'],
          ['displayName', '  Karim   U.  '],
        ]),
      ),
    );
    expect((await row(first.id))?.displayName).toBe('Nadia Rahman');
    expect((await row(second.id))?.displayName).toBe('Karim U.');
    const events = (await db.select().from(schema.auditEvents)).filter(
      (e) => e.eventType === 'UMPE_TRIP_COMPANION_ACCEPTED',
    );
    const renamed = events.map((e) => (e.metadata as { renamed?: boolean }).renamed);
    expect(renamed).toEqual([false, true]);
  });

  it('refuses a name that is empty, too long, hidden-formatted, or the organiser label, and joins nobody', async () => {
    const { id, token } = await invite();
    for (const name of ['', '   ', 'x'.repeat(121), 'Na\u202Edia', 'The organiser']) {
      const result = await answer(() =>
        acceptTripInvitationAction(
          INITIAL,
          form([
            ['token', token],
            ['intent', 'join'],
            ['displayName', name],
          ]),
        ),
      );
      expect(result).toMatchObject({ ok: false, field: 'displayName' });
    }
    expect((await row(id))?.state).toBe('INVITED');
    // The longest name is allowed.
    expect(await join(token, [])).toBe(JOINED_PATH);
    const long = await invite('long.name@example.com');
    state.accountId = await newAccount('long.name@example.com');
    const ok = await answer(() =>
      acceptTripInvitationAction(
        INITIAL,
        form([
          ['token', long.token],
          ['intent', 'join'],
          ['displayName', 'y'.repeat(120)],
        ]),
      ),
    );
    expect(ok).toBe(JOINED_PATH);
  });

  it('shares Name Only when no level is sent, takes the three listed levels, and refuses any other', async () => {
    const levels: [string | null, string][] = [
      [null, 'NAME_ONLY'],
      ['NAME_ONLY', 'NAME_ONLY'],
      ['PLAN_STATUS', 'PLAN_STATUS'],
      ['TRAVEL_BOOKINGS', 'TRAVEL_BOOKINGS'],
    ];
    for (const [sent, stored] of levels) {
      const email = `level.${sent ?? 'none'}@example.com`.toLowerCase();
      const made = await invite(email);
      state.accountId = await newAccount(email);
      const to = await join(made.token, sent === null ? [] : [['shareLevel', sent]]);
      expect(to).toBe(JOINED_PATH);
      expect((await row(made.id))?.shareLevel).toBe(stored);
    }
    const target = await invite('refused.level@example.com');
    state.accountId = await newAccount('refused.level@example.com');
    for (const forged of [
      'ADMIN',
      'plan_status',
      'PLAN_STATUS ',
      '',
      'TRAVEL_BOOKINGS,NAME_ONLY',
    ]) {
      const result = await join(target.token, [['shareLevel', forged]]);
      expect(result).toEqual({
        ok: false,
        message: 'Choose how much you want to share.',
        field: 'shareLevel',
      });
    }
    expect((await row(target.id))?.state).toBe('INVITED');
  });

  it('needs the account consent first, says so in plain words, and joins once it is on', async () => {
    const made = await invite('no.consent@example.com');
    state.accountId = await newAccount('no.consent@example.com', { consent: false });
    expect(await join(made.token)).toEqual({ ok: false, message: CONSENT_FIRST });
    expect((await row(made.id))?.state).toBe('INVITED');
    await setConsent(db, {
      actorAccountId: state.accountId,
      accountId: state.accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    expect(await join(made.token)).toBe(JOINED_PATH);
  });

  it('makes no account and no traveller record for the person', async () => {
    const before = {
      accounts: (await db.select().from(schema.accounts)).length,
      applicants: (await db.select().from(schema.applicants)).length,
    };
    const { token } = await invite();
    await join(token);
    expect((await db.select().from(schema.accounts)).length).toBe(before.accounts);
    expect((await db.select().from(schema.applicants)).length).toBe(before.applicants);
  });
});

describe('every bad invitation answers the same words', () => {
  it('is one refusal for an unknown, malformed, used, declined, removed, lapsed and wrong-address invitation, for both answers', async () => {
    const wrongOwner = await invite('someone.else@example.com');
    const used = await invite('used@example.com');
    const declined = await invite('declined@example.com');
    const removed = await invite('removed@example.com');
    const lapsed = await invite('lapsed@example.com');
    // Used and declined by their own accounts.
    state.accountId = await newAccount('used@example.com');
    expect(await join(used.token)).toBe(JOINED_PATH);
    state.accountId = await newAccount('declined@example.com');
    expect(await decline(declined.token)).toBe(DECLINED_PATH);
    await removeCompanion(await organiserProof(), tripId, removed.id);
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, lapsed.id));
    // Now the friend, whose address none of these was sent to.
    state.accountId = await newAccount('stranger@example.com');
    state.address = '198.51.100.20';
    const tokens = [
      UNKNOWN,
      'short',
      '',
      wrongOwner.token,
      used.token,
      declined.token,
      removed.token,
      lapsed.token,
    ];
    for (const token of tokens) {
      expect(await join(token), `join ${token.slice(0, 6)}`).toEqual(UNAVAILABLE);
      expect(await decline(token), `decline ${token.slice(0, 6)}`).toEqual(UNAVAILABLE);
    }
    expect((await row(wrongOwner.id))?.state).toBe('INVITED');
    expect((await row(lapsed.id))?.state).toBe('INVITED');
  });

  it('refuses the right link for the wrong signed-in account, and leaves the invitation open for the right one', async () => {
    const { id, token } = await invite();
    const right = state.accountId;
    state.accountId = await newAccount('not.invited@example.com');
    expect(await join(token)).toEqual(UNAVAILABLE);
    expect(await decline(token)).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
    state.accountId = right;
    expect(await join(token)).toBe(JOINED_PATH);
  });

  it('refuses an account whose address matches but is not verified', async () => {
    const { id, token } = await invite('unverified@example.com');
    state.accountId = await newAccount('unverified@example.com');
    await db
      .update(schema.accounts)
      .set({ emailVerifiedAt: null })
      .where(eq(schema.accounts.id, state.accountId));
    expect(await join(token)).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
  });

  it('refuses the organiser’s own account and never joins them to their own trip', async () => {
    const { id, token } = await invite();
    state.accountId = organiserId;
    expect(await join(token)).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
  });

  it('is the same refusal a second time for a link that was just used', async () => {
    const { token } = await invite();
    expect(await join(token)).toBe(JOINED_PATH);
    expect(await join(token)).toEqual(UNAVAILABLE);
    expect(await decline(token)).toEqual(UNAVAILABLE);
  });

  it('is the same refusal while the feature is switched off, and changes nothing', async () => {
    const { id, token } = await invite();
    Reflect.deleteProperty(process.env, TRIP_COMPANIONS_SWITCH);
    expect(await join(token)).toEqual(UNAVAILABLE);
    expect(await decline(token)).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
  });
});

describe('declining', () => {
  it('declines on a confirmed answer, goes to a quiet page, and the link stops working', async () => {
    const { id, token } = await invite();
    expect(await decline(token)).toBe(DECLINED_PATH);
    expect(DECLINED_PATH).not.toContain('token');
    expect(await row(id)).toMatchObject({ state: 'DECLINED', tokenHash: null });
    expect(await join(token)).toEqual(UNAVAILABLE);
  });

  it('is not a decline unless the decline button was pressed', async () => {
    const { id, token } = await invite();
    expect(
      await answer(() => declineTripInvitationAction(INITIAL, form([['token', token]]))),
    ).toEqual(UNAVAILABLE);
    expect(
      await answer(() =>
        declineTripInvitationAction(
          INITIAL,
          form([
            ['token', token],
            ['intent', 'join'],
          ]),
        ),
      ),
    ).toEqual(UNAVAILABLE);
    expect((await row(id))?.state).toBe('INVITED');
  });

  it('needs no name and no consent', async () => {
    const made = await invite('no.consent.decline@example.com');
    state.accountId = await newAccount('no.consent.decline@example.com', { consent: false });
    expect(await decline(made.token)).toBe(DECLINED_PATH);
  });
});

describe('too many tries', () => {
  const windowStart = (step: number) => {
    const { windowMs } = RATE_LIMITS.INVITATION_PREVIEW_IP;
    return new Date((Math.floor(Date.now() / windowMs) + step) * windowMs);
  };

  it('answers one fixed wording, for a real link and a made-up one alike, once an address has tried too often', async () => {
    const { id, token } = await invite();
    await db.insert(schema.rateLimitBuckets).values(
      [0, 1].map((step) => ({
        subjectId: hashedSubject('net', state.address),
        action: 'trip_companion.preview_ip',
        windowStart: windowStart(step),
        count: RATE_LIMITS.INVITATION_PREVIEW_IP.limit,
      })),
    );
    expect(await join(token)).toEqual(BUSY);
    expect(await join(UNKNOWN)).toEqual(BUSY);
    expect(await decline(token)).toEqual(BUSY);
    expect(await decline(UNKNOWN)).toEqual(BUSY);
    expect((await row(id))?.state).toBe('INVITED');
    // Another address is not held back.
    state.address = '192.0.2.77';
    expect(await join(token)).toBe(JOINED_PATH);
  });

  it('answers the same words when the signed-in account has tried too often', async () => {
    const { token } = await invite();
    const config = RATE_LIMITS.COMPANION_ACCEPT_ACCOUNT;
    await db.insert(schema.rateLimitBuckets).values(
      [0, 1].map((step) => ({
        subjectId: state.accountId,
        action: 'trip_companion.attempt',
        windowStart: new Date((Math.floor(Date.now() / config.windowMs) + step) * config.windowMs),
        count: config.limit,
      })),
    );
    expect(await join(token)).toEqual(BUSY);
    expect(await join(UNKNOWN)).toEqual(BUSY);
    expect(await decline(UNKNOWN)).toEqual(BUSY);
  });

  it('keeps only a short hash of the visitor address', async () => {
    const { token } = await invite();
    await join(token);
    const rows = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.action, 'trip_companion.preview_ip'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subjectId).toMatch(/^net:[0-9a-f]{32}$/);
    expect(JSON.stringify(rows)).not.toContain(state.address);
  });
});

describe('what the actions say back', () => {
  it('never holds a link, an address or a stored hash, whatever happened', async () => {
    const good = await invite();
    const other = await invite('other@example.com', 'Karim Uddin');
    await join(UNKNOWN);
    await decline(UNKNOWN);
    state.accountId = await newAccount('stranger@example.com');
    await join(good.token);
    await decline(good.token);
    state.accountId = (
      await db.select().from(schema.accounts).where(eq(schema.accounts.email, FRIEND))
    )[0]?.id as string;
    await join(good.token);
    const everything = JSON.stringify(said);
    for (const secret of [
      good.token,
      other.token,
      FRIEND,
      'other@example.com',
      'stranger@example.com',
    ]) {
      expect(everything).not.toContain(secret);
    }
    const hashes = (await db.select().from(schema.umpeTripCompanions)).flatMap((r) =>
      r.tokenHash ? [r.tokenHash] : [],
    );
    for (const hash of hashes) expect(everything).not.toContain(hash);
  });
});
