import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

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
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashedSubject } from '../../../../lib/client-address';

/**
 * The page an invitation link opens, read from a real database and rendered. Opening it only shows
 * the trip basics to the person invited; it never joins. Every bad invitation renders the same
 * page, and with the feature off the page is a 404.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));
vi.mock('../../actions', () => ({ setConsentAction: async () => ({ ok: true, message: '' }) }));
vi.mock('./actions', () => ({
  acceptTripInvitationAction: async () => ({ ok: true, message: '' }),
  declineTripInvitationAction: async () => ({ ok: true, message: '' }),
}));

const { default: TripInvitationPage } = await import('./page');

const FRIEND = 'friend@example.com';
const LONG_DASH = String.fromCharCode(0x2014);
const UNKNOWN = 'N'.repeat(43);
let db: Db;
let client: Awaited<ReturnType<typeof createMigratedPglite>>;
let previousSwitch: string | undefined;
let organiserId: string;
let applicantId: string;
let tripId: string;

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

const page = (search: { token?: string; done?: string }) =>
  renderServer(TripInvitationPage({ searchParams: Promise.resolve(search) }));

/** The page with the link's own token written as TOKEN, so two different links can be compared. */
const shape = (html: string, token: string) => (token ? html.replaceAll(token, 'TOKEN') : html);

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
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

describe('the invitation page for the person invited', () => {
  it('shows the trip basics, the one plain promise, Name Only chosen and the rest behind Share More', async () => {
    const { token } = await invite();
    const html = await page({ token });
    const words = textOf(html);
    expect(words).toContain('Join a Trip');
    expect(words).toContain('Opening this page joins nothing.');
    for (const basic of ['Japan', 'Tourism']) expect(words).toContain(basic);
    // Said once, plainly.
    const promise =
      "Joining shows your name to others on this trip. Nobody gets access to anyone's documents.";
    expect(words.split(promise)).toHaveLength(2);
    // The name the organiser typed, to be confirmed or changed.
    expect(html).toMatch(
      /name="displayName"[^>]*value="Nadia Rahman"|value="Nadia Rahman"[^>]*name="displayName"/,
    );
    expect(html).toContain('maxLength="120"');
    expect(words).toContain('Your Name');
    // Name Only is chosen already; the other two sit inside the one quiet Share More choice.
    const nameOnly = /<input[^>]*value="NAME_ONLY"[^>]*>/.exec(html)?.[0] ?? '';
    expect(nameOnly).toContain('checked');
    const more = /<details[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? '';
    expect(more).toContain('Share More');
    expect(more).toContain('value="PLAN_STATUS"');
    expect(more).toContain('value="TRAVEL_BOOKINGS"');
    expect(more).not.toContain('value="NAME_ONLY"');
    expect(html).not.toMatch(/value="(PLAN_STATUS|TRAVEL_BOOKINGS)"[^>]*checked/);
    for (const label of ['Name Only', 'Plan Status', 'Travel Bookings'])
      expect(words).toContain(label);
    // One join button and one decline button, each its own answer.
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(
      buttons.filter((b) => b.includes('name="intent"') && b.includes('value="join"')),
    ).toHaveLength(1);
    expect(words).toContain('Join the Trip');
    expect(
      buttons.filter((b) => b.includes('name="intent"') && b.includes('value="decline"')),
    ).toHaveLength(1);
    expect(words).toContain('Decline');
  });

  it('shows nothing about the organiser, anyone else, or any address', async () => {
    const { token } = await invite();
    await invite('karim@example.com', 'Karim Uddin');
    const html = await page({ token });
    for (const hidden of [
      'Rahima',
      'organiser@example.com',
      'Karim',
      'karim@example.com',
      FRIEND,
      tripId,
      applicantId,
      organiserId,
    ]) {
      expect(html, hidden).not.toContain(hidden);
    }
  });

  it('never joins by being opened, however often', async () => {
    const { id, token } = await invite();
    await page({ token });
    await page({ token });
    const [row] = await db
      .select()
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, id));
    expect(row).toMatchObject({ state: 'INVITED', joinedAccountId: null });
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('asks for the one consent first, without the join form, and still offers Decline', async () => {
    const made = await invite('no.consent@example.com');
    state.accountId = await newAccount('no.consent@example.com', { consent: false });
    const html = await page({ token: made.token });
    const words = textOf(html);
    expect(words).toContain('Let VisaStack Process My Details');
    expect(words).toContain('Turn On');
    expect(words).toContain('Turn on the consent above to continue.');
    expect(html).not.toContain('value="join"');
    expect(html).toMatch(/value="decline"/);
  });

  it('carries no inline style, no long dash, and no "mission"', async () => {
    const { token } = await invite();
    const html = await page({ token });
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain(LONG_DASH);
    expect(textOf(html)).not.toMatch(/\bmission\b/i);
  });
});

describe('every bad invitation renders the same page', () => {
  it('is one page for unknown, malformed, used, declined, removed, lapsed and wrong-address links', async () => {
    const wrongOwner = await invite('someone.else@example.com');
    const used = await invite('used@example.com');
    const declined = await invite('declined@example.com');
    const removed = await invite('removed@example.com');
    const lapsed = await invite('lapsed@example.com');
    await db
      .update(schema.umpeTripCompanions)
      .set({ state: 'JOINED', tokenHash: null, expiresAt: null, joinedAccountId: organiserId })
      .where(eq(schema.umpeTripCompanions.id, used.id));
    await db
      .update(schema.umpeTripCompanions)
      .set({ state: 'DECLINED', tokenHash: null, expiresAt: null })
      .where(eq(schema.umpeTripCompanions.id, declined.id));
    await removeCompanion(await organiserProof(), tripId, removed.id);
    await db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.umpeTripCompanions.id, lapsed.id));
    const cases = [
      wrongOwner.token,
      used.token,
      declined.token,
      removed.token,
      lapsed.token,
      UNKNOWN,
    ];
    const pages = [];
    for (const token of cases) pages.push(shape(await page({ token }), token));
    for (const html of pages) expect(html).toBe(pages[0]);
    const words = textOf(pages[0] ?? '');
    expect(words).toContain('Invitation Unavailable');
    expect(words).toContain('This invitation is not available.');
    expect(words).toContain('Sign In with the Invited Email');
    // A link that is not shaped like one, or no link at all, reads the same, without echoing it.
    for (const token of ['short', '', "<script>alert('x')</script>"]) {
      const html = await page({ token });
      expect(textOf(html)).toBe(words);
      expect(html).not.toContain('<script>');
      expect(html).toContain('href="/auth/sign-in"');
    }
    // The way back keeps the link only for a well-formed one.
    expect(await page({ token: UNKNOWN })).toContain(
      `href="/auth/sign-in?next=${encodeURIComponent(`/app/trip-invitations/accept?token=${UNKNOWN}`)}"`,
    );
  });

  it('is that same page for the right link opened by the wrong signed-in account', async () => {
    const { token } = await invite();
    const right = await page({ token });
    expect(textOf(right)).toContain('Join a Trip');
    state.accountId = await newAccount('not.invited@example.com');
    const wrong = await page({ token });
    const unknown = await page({ token: UNKNOWN });
    expect(shape(wrong, token)).toBe(shape(unknown, UNKNOWN));
    expect(textOf(wrong)).toBe(textOf(unknown));
    for (const hidden of ['Japan', 'Tourism', 'Nadia']) expect(wrong).not.toContain(hidden);
  });

  it('says one fixed "too many tries" wording for a real link and a made-up one alike', async () => {
    const { token } = await invite();
    const config = RATE_LIMITS.INVITATION_PREVIEW_IP;
    await db.insert(schema.rateLimitBuckets).values(
      [0, 1].map((step) => ({
        subjectId: hashedSubject('net', '203.0.113.9'),
        action: 'trip_companion.preview_ip',
        windowStart: new Date((Math.floor(Date.now() / config.windowMs) + step) * config.windowMs),
        count: config.limit,
      })),
    );
    const real = textOf(await page({ token }));
    const made = textOf(await page({ token: UNKNOWN }));
    expect(real).toBe(made);
    expect(real).toContain('Too many tries in a short time. Please try again later.');
    expect(real).not.toContain('Japan');
  });
});

describe('with the feature off', () => {
  it('is a 404 for every link, good or not, and for the answered pages', async () => {
    const { token } = await invite();
    Reflect.deleteProperty(process.env, TRIP_COMPANIONS_SWITCH);
    for (const search of [
      { token },
      { token: UNKNOWN },
      {},
      { done: 'joined' },
      { done: 'declined' },
    ]) {
      await expect(page(search)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('says "not available" rather than failing when the table is missing', async () => {
    const { token } = await invite();
    await db.execute(sql`drop table umpe_trip_companions`);
    // A table seen once is remembered per database handle, so the page reads through a fresh one.
    state.db = drizzle(client, { schema }) as unknown as Db;
    const html = await page({ token });
    expect(textOf(html)).toContain('Invitation Unavailable');
  });
});

describe('after answering', () => {
  it('thanks a person who joined, links to My Trips, and holds no link or address', async () => {
    const { id } = await invite();
    await db
      .update(schema.umpeTripCompanions)
      .set({ state: 'JOINED', tokenHash: null, expiresAt: null, joinedAccountId: state.accountId })
      .where(eq(schema.umpeTripCompanions.id, id));
    const html = await page({ done: 'joined' });
    const words = textOf(html);
    expect(words).toContain('You Joined the Trip');
    expect(words).toContain("Nobody gets access to anyone's documents.");
    expect(html).toContain('href="/app/trips"');
    expect(words).toContain('My Trips');
    expect(html).not.toContain('token');
    expect(html).not.toContain(FRIEND);
  });

  it('does not claim a join that did not happen', async () => {
    const html = await page({ done: 'joined' });
    expect(textOf(html)).toContain('Invitation Unavailable');
    expect(textOf(html)).not.toContain('You Joined the Trip');
  });

  it('confirms a decline quietly, with nothing about the trip', async () => {
    const words = textOf(await page({ done: 'declined' }));
    expect(words).toContain('Invitation Declined');
    expect(words).toContain('You did not join the trip. Nothing was shared.');
    expect(words).not.toContain('Japan');
  });
});
