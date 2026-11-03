/**
 * UMPE UX6, package 1: travelling with someone else (companions and invitations).
 *
 * Synthetic data only. Pins:
 * 1. Add by name only and by email; at most 20 per trip; no duplicate or own email.
 * 2. The organiser never sees an email, a token or anything about an account, and nothing in the
 *    organiser's path looks an account up by an email: the same answers for an address with an
 *    account and one without.
 * 3. Accepting is a single-use claim that needs the signed-in account's own verified email and its
 *    consent; every other case (unknown, malformed, used, expired, declined, removed, wrong email)
 *    is the same refusal; nothing is created for the companion.
 * 4. A joined companion reads only title, destination, purpose and names who chose to appear; the
 *    organiser's own people are never named; a removed, left, declined or expired companion looks
 *    like a missing trip.
 * 5. Only the joined companion sets what the organiser sees; changes take effect on the next read.
 * 6. A missing table or a switch that is off: readers answer nothing, writers refuse plainly.
 */
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { count, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthorizedApplicant, accountPrincipal, requireAccess } from './access';
import {
  TripCompanionAccess,
  invitedCompanionAccess,
  joinedCompanionAccess,
  myCompanionAccesses,
} from './access/trip-companion-access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { createMission } from './missions';
import { RATE_LIMITS } from './rate-limit';
import {
  COMPANION_INVITATION_DAYS,
  TRIP_MAX_COMPANIONS,
  acceptCompanionInvitation,
  addCompanion,
  companionPlanStatusPhrase,
  declineCompanionInvitation,
  getCompanionTrip,
  leaveTrip,
  listCompanions,
  listMyCompanionTrips,
  openCompanionInvitation,
  previewCompanionInvitation,
  removeCompanion,
  resendInvitation,
  setCompanionShareLevel,
} from './umpe-trip-companions';
import { TRIP_COMPANIONS_SWITCH } from './umpe-trip-companions-switch';
import { startGroupTrip } from './umpe-trip-service';

const TEST_TIMEOUT_MS = 90_000;
const TRIP = { destination: 'Japan', purpose: 'Tourism' } as const;
const SWITCH = TRIP_COMPANIONS_SWITCH;

interface LoggedQuery {
  readonly query: string;
  readonly params: readonly unknown[];
}

async function freshDb(log?: LoggedQuery[]): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, {
    schema,
    ...(log
      ? {
          logger: {
            logQuery(query: string, params: unknown[]) {
              log.push({ query, params });
            },
          },
        }
      : {}),
  }) as unknown as Db;
}

async function account(db: Db, email: string, options: { verified?: boolean } = {}) {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: created.value.id,
    accountId: created.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  if (options.verified !== false) {
    await db
      .update(schema.accounts)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.accounts.id, created.value.id));
  }
  return created.value.id;
}

async function traveller(
  db: Db,
  owner: string,
  displayName: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' = 'SELF',
): Promise<string> {
  const created = await createApplicant(db, {
    actorAccountId: owner,
    ownerAccountId: owner,
    displayName,
    relationship,
    authorityConfirmed: relationship !== 'SELF',
  });
  if (!isOk(created)) throw new Error(`applicant: ${created.error.message}`);
  return created.value.id;
}

async function proofFor<A extends 'MANAGE' | 'VIEW_METADATA'>(
  db: Db,
  actor: string,
  applicantId: string,
  action: A,
): Promise<AuthorizedApplicant<A>> {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    action,
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value as AuthorizedApplicant<A>;
}

interface Organiser {
  readonly accountId: string;
  readonly applicantId: string;
  readonly tripId: string;
}

async function organiser(db: Db, email = 'organiser@example.com'): Promise<Organiser> {
  const accountId = await account(db, email);
  const applicantId = await traveller(db, accountId, 'Synthetic Organiser');
  const started = await startGroupTrip(await proofFor(db, accountId, applicantId, 'MANAGE'), TRIP);
  if (!isOk(started)) throw new Error(`trip: ${started.error.message}`);
  return { accountId, applicantId, tripId: started.value.tripId };
}

async function add(db: Db, org: Organiser, name: string, email?: string) {
  return addCompanion(await proofFor(db, org.accountId, org.applicantId, 'MANAGE'), org.tripId, {
    name,
    email,
  });
}

async function list(db: Db, org: Organiser) {
  const listed = await listCompanions(
    await proofFor(db, org.accountId, org.applicantId, 'VIEW_METADATA'),
    org.tripId,
  );
  if (!isOk(listed)) throw new Error(`list: ${listed.error.message}`);
  return listed.value;
}

async function invite(db: Db, org: Organiser, name: string, email: string) {
  const added = await add(db, org, name, email);
  if (!isOk(added) || !added.value.invitation) throw new Error('invite');
  return { companionId: added.value.companion.id, token: added.value.invitation.rawToken };
}

/** Accept as `accountId`, the way the accept page does: open the link, then accept. */
async function accept(
  db: Db,
  accountId: string,
  token: string,
  extra: { displayName?: string; shareLevel?: string } = {},
) {
  const opened = await openCompanionInvitation(db, { accountId, rawToken: token });
  if (!opened.ok) return opened;
  return acceptCompanionInvitation(db, opened.value, { rawToken: token, ...extra });
}

async function joined(db: Db, org: Organiser, name: string, email: string, level = 'NAME_ONLY') {
  const { companionId, token } = await invite(db, org, name, email);
  const guest = await account(db, email);
  const accepted = await accept(db, guest, token, { shareLevel: level });
  if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
  const access = await joinedCompanionAccess(db, guest, org.tripId);
  if (!access) throw new Error('no access');
  return { companionId, guest, access };
}

function words<T>(result: { ok: boolean; error?: { code: string; message: string } } & T) {
  return result.ok ? null : { code: result.error?.code, message: result.error?.message };
}

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[SWITCH];
  process.env[SWITCH] = 'true';
});
afterEach(() => {
  if (previous === undefined) delete process.env[SWITCH];
  else process.env[SWITCH] = previous;
});

describe('UMPE UX6 companions: the organiser adds people', () => {
  let db: Db;
  let org: Organiser;
  beforeEach(async () => {
    db = await freshDb();
    org = await organiser(db);
  }, TEST_TIMEOUT_MS);

  it('adds by name only: listed as not on VisaStack yet, no link', async () => {
    const added = await add(db, org, '  Synthetic   Friend ');
    expect(isOk(added) && added.value.invitation).toBeNull();
    expect(isOk(added) && added.value.companion).toMatchObject({
      name: 'Synthetic Friend',
      status: 'NAME_ONLY',
    });
    const rows = await db.select().from(schema.umpeTripCompanions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'NAME_ONLY', tokenHash: null, email: null });
  });

  it('adds by email: invited, 7 days, the raw token returned once and only its hash stored', async () => {
    const before = Date.now();
    const added = await add(db, org, 'Synthetic Guest', ' Guest@Example.COM ');
    if (!isOk(added) || !added.value.invitation) throw new Error('no invitation');
    const { rawToken, expiresAt, recipientEmail } = added.value.invitation;
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(recipientEmail).toBe('guest@example.com');
    const life = new Date(expiresAt).getTime() - before;
    expect(life).toBeGreaterThan((COMPANION_INVITATION_DAYS * 24 - 1) * 3600_000);
    expect(life).toBeLessThanOrEqual(COMPANION_INVITATION_DAYS * 24 * 3600_000 + 5_000);
    const [row] = await db.select().from(schema.umpeTripCompanions);
    expect(row?.state).toBe('INVITED');
    expect(row?.email).toBe('guest@example.com');
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });

  it('refuses a 21st live person, and a removal makes room', async () => {
    for (let i = 1; i <= TRIP_MAX_COMPANIONS; i += 1) {
      expect(isOk(await add(db, org, `Synthetic Person ${i}`))).toBe(true);
    }
    const over = await add(db, org, 'Synthetic Person 21');
    expect(isErr(over) && over.error.message).toMatch(/up to 20 people/);
    const rows = await list(db, org);
    const removed = await removeCompanion(
      await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
      org.tripId,
      rows[0]?.id ?? '',
    );
    expect(isOk(removed)).toBe(true);
    expect(isOk(await add(db, org, 'Synthetic Person 21'))).toBe(true);
  });

  it('refuses the same email twice on one trip (any letter case), and the organiser own email', async () => {
    expect(isOk(await add(db, org, 'One', 'twice@example.com'))).toBe(true);
    const again = await add(db, org, 'Two', 'TWICE@example.com');
    expect(isErr(again) && again.error.message).toMatch(/already added/);
    const own = await add(db, org, 'Me', 'Organiser@Example.com');
    expect(isErr(own) && own.error.message).toMatch(/your own email/);
    expect(await list(db, org)).toHaveLength(1);
    const bad = await add(db, org, 'Bad', 'not-an-email');
    expect(isErr(bad) && bad.error.code).toBe('invalid');
    const noName = await add(db, org, '   ');
    expect(isErr(noName) && noName.error.code).toBe('invalid');
  });

  it('shows the organiser a name and a status only: never an email, a token or an account', async () => {
    await invite(db, org, 'Synthetic Guest', 'secret-address@example.com');
    await add(db, org, 'Synthetic Named');
    const rows = await list(db, org);
    expect(rows.map((r) => r.status)).toEqual(['INVITED', 'NAME_ONLY']);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'name', 'planStatus', 'shareLevel', 'status']);
    }
    const text = JSON.stringify(rows);
    expect(text).not.toContain('secret-address');
    expect(text).not.toMatch(/token|hash/i);
  });

  it("another account's trip looks exactly like a missing one", async () => {
    const stranger = await account(db, 'stranger@example.com');
    const strangerSelf = await traveller(db, stranger, 'Synthetic Stranger');
    const proof = await proofFor(db, stranger, strangerSelf, 'MANAGE');
    const theirs = await addCompanion(proof, org.tripId, { name: 'Intruder' });
    const missing = await addCompanion(proof, '00000000-0000-4000-8000-000000000000', {
      name: 'Intruder',
    });
    expect(words(theirs)).toEqual(words(missing));
    expect(isErr(theirs) && theirs.error.code).toBe('not_found');
    expect(await db.select().from(schema.umpeTripCompanions)).toHaveLength(0);
  });

  it('answers the same words and shape whether or not the address has an account, and never looks accounts up by it', async () => {
    const log: LoggedQuery[] = [];
    const logged = await freshDb(log);
    const lead = await organiser(logged);
    await account(logged, 'has-account@example.com');
    log.length = 0;
    const known = await add(logged, lead, 'Known', 'has-account@example.com');
    const unknown = await add(logged, lead, 'Unknown', 'no-account@example.com');
    if (!isOk(known) || !isOk(unknown)) throw new Error('add');
    const strip = (outcome: typeof known.value) => ({
      companion: { ...outcome.companion, id: 'id', name: 'name' },
      invitation: outcome.invitation && {
        keys: Object.keys(outcome.invitation).sort(),
        tokenLength: outcome.invitation.rawToken.length,
      },
    });
    expect(strip(known.value)).toEqual(strip(unknown.value));
    // Nothing read the accounts table with either invitee address.
    const touching = log.filter((q) => /"accounts"/.test(q.query));
    for (const q of touching) {
      expect(q.params.map(String).join(' ')).not.toMatch(/has-account|no-account/);
    }
    // The duplicate and own-address refusals read the same for both kinds of address.
    const dupKnown = await add(logged, lead, 'Known 2', 'has-account@example.com');
    const dupUnknown = await add(logged, lead, 'Unknown 2', 'no-account@example.com');
    expect(words(dupKnown)).toEqual(words(dupUnknown));
    // Listing and resending read the same too.
    const rows = await list(logged, lead);
    expect(rows.map((r) => r.status)).toEqual(['INVITED', 'INVITED']);
    const resendKnown = await resendInvitation(
      await proofFor(logged, lead.accountId, lead.applicantId, 'MANAGE'),
      lead.tripId,
      known.value.companion.id,
    );
    const resendUnknown = await resendInvitation(
      await proofFor(logged, lead.accountId, lead.applicantId, 'MANAGE'),
      lead.tripId,
      unknown.value.companion.id,
    );
    expect(isOk(resendKnown) && Object.keys(resendKnown.value.invitation ?? {}).sort()).toEqual(
      isOk(resendUnknown) ? Object.keys(resendUnknown.value.invitation ?? {}).sort() : [],
    );
  });

  it('makes no account, applicant or case for a companion, invited or joined', async () => {
    const tables = async () => ({
      accounts: Number((await db.select({ n: count() }).from(schema.accounts))[0]?.n),
      applicants: Number((await db.select({ n: count() }).from(schema.applicants))[0]?.n),
      missions: Number((await db.select({ n: count() }).from(schema.missions))[0]?.n),
    });
    const start = await tables();
    const { token } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    expect(await tables()).toEqual(start);
    const guest = await account(db, 'guest@example.com');
    const afterAccount = await tables();
    expect(afterAccount.accounts).toBe(start.accounts + 1);
    expect(isOk(await accept(db, guest, token))).toBe(true);
    expect(await tables()).toEqual(afterAccount);
  });

  it('limits invitations per organiser and per address, with the same words for every address', async () => {
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const results = [];
    for (let i = 0; i <= RATE_LIMITS.COMPANION_INVITE_EMAIL_DAY.limit; i += 1) {
      const trip = await startGroupTrip(proof, TRIP);
      if (!isOk(trip)) throw new Error('trip');
      results.push(
        await addCompanion(proof, trip.value.tripId, { name: 'Same', email: 'x@example.com' }),
      );
    }
    const last = results[results.length - 1] as (typeof results)[number];
    expect(isErr(last) && last.error.code).toBe('rate_limited');
    // An address with an account is limited in the very same words.
    await account(db, 'y@example.com');
    const other = [];
    for (let i = 0; i <= RATE_LIMITS.COMPANION_INVITE_EMAIL_DAY.limit; i += 1) {
      const trip = await startGroupTrip(proof, TRIP);
      if (!isOk(trip)) throw new Error('trip');
      other.push(
        await addCompanion(proof, trip.value.tripId, { name: 'Same', email: 'y@example.com' }),
      );
    }
    expect(words(other[other.length - 1] as never)).toEqual(words(last as never));
  });
});

describe('UMPE UX6 companions: the invitation', () => {
  let db: Db;
  let org: Organiser;
  beforeEach(async () => {
    db = await freshDb();
    org = await organiser(db);
  }, TEST_TIMEOUT_MS);

  it('previews the trip basics for the invited, verified account, then accepts once', async () => {
    const { token, companionId } = await invite(db, org, 'Synthetic Typed', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    const preview = await previewCompanionInvitation(db, { accountId: guest, rawToken: token });
    expect(isOk(preview) && Object.keys(preview.value).sort()).toEqual([
      'destination',
      'displayName',
      'expiresAt',
      'purpose',
      'title',
    ]);
    expect(isOk(preview) && preview.value.displayName).toBe('Synthetic Typed');
    const accepted = await accept(db, guest, token, {
      displayName: 'Synthetic Confirmed',
      shareLevel: 'PLAN_STATUS',
    });
    expect(isOk(accepted) && accepted.value).toEqual({
      tripId: org.tripId,
      shareLevel: 'PLAN_STATUS',
    });
    const [row] = await db.select().from(schema.umpeTripCompanions);
    expect(row).toMatchObject({
      id: companionId,
      state: 'JOINED',
      displayName: 'Synthetic Confirmed',
      shareLevel: 'PLAN_STATUS',
      joinedAccountId: guest,
      tokenHash: null,
      expiresAt: null,
    });
  });

  it('defaults to Name Only, and a second use fails exactly like an unknown link', async () => {
    const { token } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    const first = await accept(db, guest, token);
    expect(isOk(first) && first.value.shareLevel).toBe('NAME_ONLY');
    const second = await accept(db, guest, token);
    const unknown = await accept(db, guest, 'A'.repeat(43));
    expect(isErr(second)).toBe(true);
    expect(words(second)).toEqual(words(unknown));
    // A stale proof made before the first accept cannot claim it again either.
    const { token: token2 } = await invite(db, org, 'Another', 'other@example.com');
    const other = await account(db, 'other@example.com');
    const stale = await openCompanionInvitation(db, { accountId: other, rawToken: token2 });
    if (!stale.ok) throw new Error('open');
    expect(isOk(await acceptCompanionInvitation(db, stale.value, { rawToken: token2 }))).toBe(true);
    const replay = await acceptCompanionInvitation(db, stale.value, { rawToken: token2 });
    expect(words(replay)).toEqual(words(unknown));
    expect(await db.select().from(schema.umpeTripCompanions)).toHaveLength(2);
  });

  it('gives one refusal for unknown, malformed, expired, declined, removed, wrong-email and unverified', async () => {
    const guest = await account(db, 'guest@example.com');
    const expected = words(await accept(db, guest, 'B'.repeat(43)));
    expect(expected?.code).toBe('not_found');
    const seen: unknown[] = [];

    seen.push(words(await accept(db, guest, 'short')));
    seen.push(words(await accept(db, guest, '')));

    const stranger = await invite(db, org, 'Stranger Link', 'someone-else@example.com');
    seen.push(words(await accept(db, guest, stranger.token))); // wrong email

    const expired = await invite(db, org, 'Expired', 'guest@example.com');
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, expired.companionId));
    seen.push(words(await accept(db, guest, expired.token)));
    seen.push(
      words(await previewCompanionInvitation(db, { accountId: guest, rawToken: expired.token })),
    );

    const unverified = await account(db, 'unverified@example.com', { verified: false });
    const link = await invite(db, org, 'Unverified', 'unverified@example.com');
    seen.push(words(await accept(db, unverified, link.token)));

    const declined = await invite(db, org, 'Declined', 'decliner@example.com');
    const decliner = await account(db, 'decliner@example.com');
    const opened = await openCompanionInvitation(db, {
      accountId: decliner,
      rawToken: declined.token,
    });
    if (!opened.ok) throw new Error('open');
    expect(
      isOk(await declineCompanionInvitation(db, opened.value, { rawToken: declined.token })),
    ).toBe(true);
    seen.push(words(await accept(db, decliner, declined.token)));

    const removed = await invite(db, org, 'Removed', 'removed@example.com');
    const remover = await account(db, 'removed@example.com');
    await removeCompanion(
      await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
      org.tripId,
      removed.companionId,
    );
    seen.push(words(await accept(db, remover, removed.token)));

    const own = await invite(db, org, 'Own', 'own-link@example.com');
    seen.push(words(await accept(db, org.accountId, own.token)));

    for (const outcome of seen) expect(outcome).toEqual(expected);
    expect(seen).toHaveLength(9);
  });

  it('needs the account consent, and leaves the invitation open when it is missing', async () => {
    const { token } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    await setConsent(db, {
      actorAccountId: guest,
      accountId: guest,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    const refused = await accept(db, guest, token);
    expect(isErr(refused) && refused.error.code).toBe('consent_required');
    const [row] = await db.select().from(schema.umpeTripCompanions);
    expect(row?.state).toBe('INVITED');
  });

  it('refuses an unknown share level or a name that is too long, without using the link', async () => {
    const { token } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    expect(isErr(await accept(db, guest, token, { shareLevel: 'EVERYTHING' }))).toBe(true);
    expect(isErr(await accept(db, guest, token, { displayName: 'x'.repeat(121) }))).toBe(true);
    expect(isOk(await accept(db, guest, token))).toBe(true);
  });

  it('declining is quiet: the organiser still sees an invitation, then an expired one', async () => {
    const { token, companionId } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    const opened = await openCompanionInvitation(db, { accountId: guest, rawToken: token });
    if (!opened.ok) throw new Error('open');
    await declineCompanionInvitation(db, opened.value, { rawToken: token });
    expect((await list(db, org)).map((r) => r.status)).toEqual(['INVITED']);
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, companionId));
    expect((await list(db, org)).map((r) => r.status)).toEqual(['EXPIRED']);
  });

  it('resend replaces the link: the old one stops, the new one works, new 7 days', async () => {
    const { token, companionId } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    const again = await resendInvitation(
      await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
      org.tripId,
      companionId,
    );
    if (!isOk(again) || !again.value.invitation) throw new Error('resend');
    expect(again.value.invitation.rawToken).not.toBe(token);
    expect(again.value.invitation.recipientEmail).toBe('guest@example.com');
    const old = await accept(db, guest, token);
    expect(isErr(old) && old.error.code).toBe('not_found');
    expect(isOk(await accept(db, guest, again.value.invitation.rawToken))).toBe(true);
  });

  it('resend after an expiry works, is limited per trip, and refuses a name with no email', async () => {
    const { companionId } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, companionId));
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const fresh = await resendInvitation(proof, org.tripId, companionId);
    expect(isOk(fresh) && fresh.value.invitation?.expiresAt).toBeTruthy();
    expect((await list(db, org)).map((r) => r.status)).toEqual(['INVITED']);
    const named = await add(db, org, 'No Email');
    const namedId = isOk(named) ? named.value.companion.id : '';
    const noEmail = await resendInvitation(proof, org.tripId, namedId);
    expect(isErr(noEmail) && noEmail.error.message).toMatch(/no email address/);
    let limited = false;
    for (let i = 0; i < RATE_LIMITS.COMPANION_RESEND_TRIP.limit + 2 && !limited; i += 1) {
      const r = await resendInvitation(proof, org.tripId, companionId);
      limited = isErr(r) && r.error.code === 'rate_limited';
    }
    expect(limited).toBe(true);
  });

  it('a declined person is not written to again, yet the answer to the organiser is the same', async () => {
    const { token, companionId } = await invite(db, org, 'Synthetic Guest', 'guest@example.com');
    const guest = await account(db, 'guest@example.com');
    const opened = await openCompanionInvitation(db, { accountId: guest, rawToken: token });
    if (!opened.ok) throw new Error('open');
    await declineCompanionInvitation(db, opened.value, { rawToken: token });
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const resent = await resendInvitation(proof, org.tripId, companionId);
    expect(isOk(resent) && resent.value.invitation).toBeNull();
    const again = await add(db, org, 'Same Person', 'guest@example.com');
    expect(isErr(again) && again.error.message).toMatch(/already added/);
  });

  it('lists a person their own joined trips and unexpired invitations, without any link', async () => {
    const first = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    const second = await organiser(db, 'second-organiser@example.com');
    await invite(db, second, 'Typed', 'guest@example.com');
    const mine = await listMyCompanionTrips(db, first.guest);
    expect(mine.map((m) => m.standing).sort()).toEqual(['INVITED', 'JOINED']);
    expect(JSON.stringify(mine)).not.toMatch(/token|hash/i);
    expect(await listMyCompanionTrips(db, org.accountId)).toEqual([]);
    expect(await myCompanionAccesses(db, '00000000-0000-4000-8000-000000000000')).toEqual([]);
  });
});

describe('UMPE UX6 companions: what a joined companion reads', () => {
  let db: Db;
  let org: Organiser;
  beforeEach(async () => {
    db = await freshDb();
    org = await organiser(db);
  }, TEST_TIMEOUT_MS);

  it('returns exactly the allowed keys, names no managed family member and no itinerary reference', async () => {
    const family = await traveller(db, org.accountId, 'Synthetic Minor Name', 'FAMILY_MEMBER');
    const { addTravellerToTrip } = await import('./umpe-trip-service');
    const added = await addTravellerToTrip(
      await proofFor(db, org.accountId, family, 'MANAGE'),
      org.tripId,
    );
    expect(isOk(added)).toBe(true);
    const first = await joined(db, org, 'Typed One', 'one@example.com');
    await joined(db, org, 'Typed Two', 'two@example.com');
    await add(db, org, 'Not Joined Name');
    const view = await getCompanionTrip(db, first.access);
    if (!isOk(view)) throw new Error('view');
    expect(Object.keys(view.value).sort()).toEqual([
      'destination',
      'moreTravelling',
      'people',
      'purpose',
      'title',
    ]);
    expect(view.value).toMatchObject({
      destination: 'Japan',
      purpose: 'Tourism',
      moreTravelling: 1,
    });
    expect(view.value.people).toEqual(['The organiser', 'Typed Two']);
    const text = JSON.stringify(view.value);
    expect(text).not.toContain('Synthetic Minor Name');
    expect(text).not.toContain('Synthetic Organiser');
    expect(text).not.toContain('Not Joined Name');
    expect(text).not.toContain(org.applicantId);
    expect(text).not.toContain(org.tripId);
    const [trip] = await db.select().from(schema.umpeTrips);
    expect(text).not.toContain(trip?.itineraryRef ?? 'missing');
    expect(text).not.toMatch(/@example\.com/);
  });

  it('shows another trip of the same organiser as missing', async () => {
    const mine = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    const other = await startGroupTrip(
      await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
      { destination: 'Peru', purpose: 'Tourism' },
    );
    if (!isOk(other)) throw new Error('trip');
    expect(await joinedCompanionAccess(db, mine.guest, other.value.tripId)).toBeNull();
  });

  it('a removed, left, declined or expired companion reads as a missing trip', async () => {
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const removed = await joined(db, org, 'Removed', 'removed@example.com');
    const left = await joined(db, org, 'Left', 'left@example.com');
    const kept = await joined(db, org, 'Kept', 'kept@example.com');
    expect(isOk(await getCompanionTrip(db, removed.access))).toBe(true);

    await removeCompanion(proof, org.tripId, removed.companionId);
    const afterRemoval = await getCompanionTrip(db, removed.access);
    expect(isErr(afterRemoval) && afterRemoval.error.code).toBe('not_found');
    expect(await joinedCompanionAccess(db, removed.guest, org.tripId)).toBeNull();

    expect(isOk(await leaveTrip(db, left.access))).toBe(true);
    const afterLeaving = await getCompanionTrip(db, left.access);
    expect(words(afterLeaving)).toEqual(words(afterRemoval));
    expect(await joinedCompanionAccess(db, left.guest, org.tripId)).toBeNull();
    expect((await list(db, org)).map((r) => r.name)).toEqual(['Kept']);

    // An invitation that lapsed or was declined never yields access.
    const lapsed = await invite(db, org, 'Lapsed', 'lapsed@example.com');
    const lapser = await account(db, 'lapsed@example.com');
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, lapsed.companionId));
    expect(await invitedCompanionAccess(db, lapser, lapsed.token)).toBeNull();
    expect(await myCompanionAccesses(db, lapser)).toEqual([]);
    expect(isOk(await getCompanionTrip(db, kept.access))).toBe(true);
  });

  it('refuses a copied or forged proof', async () => {
    const real = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    const forged = { ...real.access } as unknown as TripCompanionAccess;
    expect(TripCompanionAccess.isGenuine(forged)).toBe(false);
    const view = await getCompanionTrip(db, forged);
    expect(isErr(view) && view.error.code).toBe('not_found');
    const level = await setCompanionShareLevel(db, forged, 'PLAN_STATUS');
    expect(isErr(level)).toBe(true);
    // An invited standing cannot read as joined.
    const { token } = await invite(db, org, 'Other', 'other@example.com');
    const other = await account(db, 'other@example.com');
    const invited = await invitedCompanionAccess(db, other, token);
    if (!invited) throw new Error('invited');
    expect(isErr(await getCompanionTrip(db, invited))).toBe(true);
    expect(isErr(await leaveTrip(db, invited))).toBe(true);
  });
});

describe('UMPE UX6 companions: what the organiser sees by sharing level', () => {
  let db: Db;
  let org: Organiser;
  beforeEach(async () => {
    db = await freshDb();
    org = await organiser(db);
  }, TEST_TIMEOUT_MS);

  async function ownCase(guest: string, companionId: string, state = 'IN_PROGRESS') {
    const applicantId = await traveller(db, guest, 'Synthetic Guest Self');
    const mission = await createMission(db, {
      actorAccountId: guest,
      applicantId,
      title: 'Synthetic guest case',
      destination: 'Japan',
      purpose: 'Tourism',
    });
    if (!isOk(mission)) throw new Error('mission');
    await db.execute(sql`update missions set state = ${state} where id = ${mission.value.id}`);
    await db
      .update(schema.umpeTripCompanions)
      .set({ ownMissionId: mission.value.id })
      .where(eq(schema.umpeTripCompanions.id, companionId));
    return mission.value.id;
  }

  it('Name Only shows a name and Joined; Plan Status adds one phrase; lowering removes it on the next read', async () => {
    const guest = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    // No case yet: no phrase at any level.
    expect(isOk(await setCompanionShareLevel(db, guest.access, 'PLAN_STATUS'))).toBe(true);
    expect((await list(db, org))[0]).toMatchObject({ status: 'JOINED', planStatus: null });
    await ownCase(guest.guest, guest.companionId);
    expect((await list(db, org))[0]).toEqual({
      id: guest.companionId,
      name: 'Synthetic Guest',
      status: 'JOINED',
      shareLevel: 'PLAN_STATUS',
      planStatus: 'Getting Ready',
    });
    expect(isOk(await setCompanionShareLevel(db, guest.access, 'NAME_ONLY'))).toBe(true);
    expect((await list(db, org))[0]).toMatchObject({ shareLevel: 'NAME_ONLY', planStatus: null });
    // Travel Bookings is stored and read back, and adds nothing yet.
    expect(isOk(await setCompanionShareLevel(db, guest.access, 'TRAVEL_BOOKINGS'))).toBe(true);
    const row = (await list(db, org))[0];
    expect(row?.shareLevel).toBe('TRAVEL_BOOKINGS');
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'id',
      'name',
      'planStatus',
      'shareLevel',
      'status',
    ]);
    expect(isErr(await setCompanionShareLevel(db, guest.access, 'EVERYTHING'))).toBe(true);
  });

  it('reads only a case that belongs to the companion account, and only a phrase', async () => {
    const guest = await joined(db, org, 'Synthetic Guest', 'guest@example.com', 'PLAN_STATUS');
    // Point the companion row at the organiser own case: nothing is shown.
    const [organiserCase] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.applicantId, org.applicantId));
    await db
      .update(schema.umpeTripCompanions)
      .set({ ownMissionId: organiserCase?.id ?? null })
      .where(eq(schema.umpeTripCompanions.id, guest.companionId));
    expect((await list(db, org))[0]?.planStatus).toBeNull();
    await ownCase(guest.guest, guest.companionId, 'SUBMISSION_READY');
    expect((await list(db, org))[0]?.planStatus).toBe('Ready to Share');
    expect(companionPlanStatusPhrase('CLOSED')).toBe('Case Closed');
    expect(companionPlanStatusPhrase('DRAFT')).toBe('Getting Ready');
  });

  it('the organiser can never set or raise a level, and cannot hold a companion proof', async () => {
    const guest = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    // The organiser account has no companion access to its own trip.
    expect(await joinedCompanionAccess(db, org.accountId, org.tripId)).toBeNull();
    // A level smuggled into the add call is ignored: the row starts at the smallest.
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const smuggled = await addCompanion(proof, org.tripId, {
      name: 'Smuggler',
      shareLevel: 'TRAVEL_BOOKINGS',
    } as never);
    expect(isOk(smuggled)).toBe(true);
    const rows = await db.select().from(schema.umpeTripCompanions);
    expect(rows.every((r) => r.shareLevel === 'NAME_ONLY')).toBe(true);
    // A row carrying the organiser's own email and a live link still gives the organiser nothing.
    const sneakyToken = generateInvitationToken();
    const sneaky = await db
      .insert(schema.umpeTripCompanions)
      .values({
        tripId: org.tripId,
        displayName: 'Sneaky',
        email: 'organiser@example.com',
        state: 'INVITED',
        tokenHash: hashInvitationToken(sneakyToken),
        expiresAt: new Date(Date.now() + 3600_000),
        invitedByAccountId: org.accountId,
      })
      .returning({ id: schema.umpeTripCompanions.id });
    expect(sneaky).toHaveLength(1);
    expect(await myCompanionAccesses(db, org.accountId)).toEqual([]);
    expect(await invitedCompanionAccess(db, org.accountId, sneakyToken)).toBeNull();
    // A different joined companion cannot change this companion's level either.
    const other = await joined(db, org, 'Other', 'other@example.com');
    await setCompanionShareLevel(db, other.access, 'PLAN_STATUS');
    const [mine] = await db
      .select()
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, guest.companionId));
    expect(mine?.shareLevel).toBe('NAME_ONLY');
  });

  it('audits every level change with ids and the level only', async () => {
    const guest = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    await setCompanionShareLevel(db, guest.access, 'PLAN_STATUS');
    await setCompanionShareLevel(db, guest.access, 'PLAN_STATUS');
    await setCompanionShareLevel(db, guest.access, 'NAME_ONLY');
    const events = (await db.select().from(schema.auditEvents)).filter(
      (e) => e.eventType === 'UMPE_TRIP_COMPANION_SHARE_LEVEL_CHANGED',
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.metadata)).toEqual([
      { tripId: org.tripId, from: 'NAME_ONLY', to: 'PLAN_STATUS' },
      { tripId: org.tripId, from: 'PLAN_STATUS', to: 'NAME_ONLY' },
    ]);
  });
});

describe('UMPE UX6 companions: audit', () => {
  it('records each step with ids, counts and kinds only, never an email or a token', async () => {
    const db = await freshDb();
    const org = await organiser(db);
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const kept = await invite(db, org, 'Kept', 'kept@example.com');
    const guest = await account(db, 'kept@example.com');
    await accept(db, guest, kept.token, { displayName: 'Renamed' });
    const decl = await invite(db, org, 'Decl', 'decl@example.com');
    const decliner = await account(db, 'decl@example.com');
    const opened = await openCompanionInvitation(db, { accountId: decliner, rawToken: decl.token });
    if (!opened.ok) throw new Error('open');
    await declineCompanionInvitation(db, opened.value, { rawToken: decl.token });
    await resendInvitation(proof, org.tripId, decl.companionId);
    const left = await joined(db, org, 'Left', 'left@example.com');
    await leaveTrip(db, left.access);
    const gone = await invite(db, org, 'Gone', 'gone@example.com');
    await removeCompanion(proof, org.tripId, gone.companionId);
    const events = (await db.select().from(schema.auditEvents)).filter((e) =>
      e.eventType.startsWith('UMPE_TRIP_COMPANION'),
    );
    expect(new Set(events.map((e) => e.eventType))).toEqual(
      new Set([
        'UMPE_TRIP_COMPANION_ADDED',
        'UMPE_TRIP_COMPANION_ACCEPTED',
        'UMPE_TRIP_COMPANION_DECLINED',
        'UMPE_TRIP_COMPANION_LEFT',
        'UMPE_TRIP_COMPANION_REMOVED',
      ]),
    );
    const text = JSON.stringify(events);
    for (const secret of [
      kept.token,
      decl.token,
      gone.token,
      'kept@',
      'decl@',
      'gone@',
      'Renamed',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('UMPE UX6 companions: switch and missing table', () => {
  it('readers answer nothing and writers refuse plainly while the table is missing', async () => {
    const db = await freshDb();
    const org = await organiser(db);
    const guest = await account(db, 'guest@example.com');
    await db.execute(sql`drop table umpe_trip_companions`);
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const added = await addCompanion(proof, org.tripId, {
      name: 'Late',
      email: 'late@example.com',
    });
    expect(isErr(added) && added.error.message).toMatch(/not switched on/);
    expect(await list(db, org)).toEqual([]);
    expect(
      isErr(await removeCompanion(proof, org.tripId, '00000000-0000-4000-8000-000000000000')),
    ).toBe(true);
    expect(
      isErr(await previewCompanionInvitation(db, { accountId: guest, rawToken: 'C'.repeat(43) })),
    ).toBe(true);
    expect(await joinedCompanionAccess(db, guest, org.tripId)).toBeNull();
    expect(await myCompanionAccesses(db, guest)).toEqual([]);
    expect(await listMyCompanionTrips(db, guest)).toEqual([]);
  });

  it('with the switch off nothing is read or written, and a live proof stops working at once', async () => {
    const db = await freshDb();
    const org = await organiser(db);
    const guest = await joined(db, org, 'Synthetic Guest', 'guest@example.com');
    expect(isOk(await getCompanionTrip(db, guest.access))).toBe(true);
    delete process.env[SWITCH];
    const proof = await proofFor(db, org.accountId, org.applicantId, 'MANAGE');
    const added = await addCompanion(proof, org.tripId, { name: 'Late' });
    expect(isErr(added) && added.error.message).toMatch(/not switched on/);
    expect(await list(db, org)).toEqual([]);
    expect(isErr(await getCompanionTrip(db, guest.access))).toBe(true);
    expect(await joinedCompanionAccess(db, guest.guest, org.tripId)).toBeNull();
    expect(await listMyCompanionTrips(db, guest.guest)).toEqual([]);
    process.env[SWITCH] = ' true ';
    expect(
      isOk(
        await getCompanionTrip(
          db,
          (await joinedCompanionAccess(db, guest.guest, org.tripId)) as TripCompanionAccess,
        ),
      ),
    ).toBe(true);
    process.env[SWITCH] = 'yes';
    expect(await joinedCompanionAccess(db, guest.guest, org.tripId)).toBeNull();
  });
});

describe('UMPE UX6 companions: review fixes', () => {
  let db: Db;
  let org: Organiser;
  beforeEach(async () => {
    db = await freshDb();
    org = await organiser(db);
  }, TEST_TIMEOUT_MS);

  it(
    'removes the row of a companion who deletes their account (no ghost with an email and a name)',
    async () => {
      const { guest } = await joined(db, org, 'Leaving Person', 'leaving@example.com');
      await db.delete(schema.accounts).where(eq(schema.accounts.id, guest));
      expect(await db.select().from(schema.umpeTripCompanions)).toHaveLength(0);
      expect(await list(db, org)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'asks for the organiser core processing consent before storing a person or sending again',
    async () => {
      const { companionId } = await invite(db, org, 'Before Withdrawal', 'before@example.com');
      // The latest record wins by time, so the withdrawal must be later than the grant.
      await new Promise((resolve) => setTimeout(resolve, 25));
      await setConsent(db, {
        actorAccountId: org.accountId,
        accountId: org.accountId,
        type: 'CORE_PROCESSING',
        granted: false,
      });
      const added = await add(db, org, 'After Withdrawal', 'after@example.com');
      expect(words(added)?.code).toBe('consent_required');
      const resent = await resendInvitation(
        await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
        org.tripId,
        companionId,
      );
      expect(words(resent)?.code).toBe('consent_required');
      expect(await db.select().from(schema.umpeTripCompanions)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'charges the invitation budget only when an email is given',
    async () => {
      for (let i = 0; i < 5; i += 1) expect(isOk(await add(db, org, `Name Only ${i}`))).toBe(true);
      const spent = async () =>
        (await db.select().from(schema.rateLimitBuckets)).filter(
          (bucket) => bucket.action === 'trip_companion.invite',
        );
      expect(await spent()).toHaveLength(0);
      expect(isOk(await add(db, org, 'With Email', 'with-email@example.com'))).toBe(true);
      expect(await spent()).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses the reserved organiser label and invisible formatting characters as a name',
    async () => {
      for (const bad of ['The organiser', 'THE ORGANISER', '\u202EEvil', 'Zero\u200BWidth']) {
        const added = await add(db, org, bad);
        expect(words(added)?.code, bad).toBe('invalid');
      }
      expect(await db.select().from(schema.umpeTripCompanions)).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'counts a declined invitation toward the 20 people until the organiser removes it',
    async () => {
      const { token } = await invite(db, org, 'Will Decline', 'decline@example.com');
      const guest = await account(db, 'decline@example.com');
      const opened = await openCompanionInvitation(db, { accountId: guest, rawToken: token });
      if (!opened.ok) throw new Error('open');
      expect(isOk(await declineCompanionInvitation(db, opened.value, { rawToken: token }))).toBe(
        true,
      );
      for (let i = 0; i < TRIP_MAX_COMPANIONS - 1; i += 1) {
        expect(isOk(await add(db, org, `Filler ${i}`)), `filler ${i}`).toBe(true);
      }
      expect(words(await add(db, org, 'One Too Many'))?.code).toBe('invalid');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'answers a missing or forged access with the one refusal, not an error',
    async () => {
      for (const bad of [null, undefined, {}, { standing: 'JOINED' }]) {
        const read = await getCompanionTrip(db, bad as never);
        expect(words(read)).toEqual({
          code: 'not_found',
          message: 'This invitation is not available.',
        });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
