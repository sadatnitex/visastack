import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

import { schema } from '@visastack/db';
import {
  type AuthorizedApplicant,
  type Db,
  TRIP_COMPANIONS_SWITCH,
  acceptCompanionInvitation,
  accountPrincipal,
  addCompanion,
  chooseTripPaper,
  declineCompanionInvitation,
  joinedCompanionAccess,
  leaveTrip,
  openCompanionInvitation,
  planMyOwnCase,
  removeCompanion,
  requireAccess,
  setCompanionShareLevel,
} from '@visastack/services';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPANION_NAME,
  FAMILY_NAME,
  FRIEND,
  type JoinedWorld,
  addPaper,
  addPerson,
  joinedWorld,
  newAccount,
} from './joined-world.test-support';

/**
 * The page of a trip a person joined, read from a real database and rendered. It shows only the
 * trip basics (what the service returns), never a managed family member's name, never a reference,
 * case, applicant, document, email or token, and every bad request is the same 404.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('./actions', () => ({
  setShareLevelAction: async () => ({ ok: true, message: '' }),
  leaveTripAction: async () => ({ ok: true, message: '' }),
  planOwnCaseAction: async () => ({ ok: true, message: '' }),
  choosePaperAction: async () => ({ ok: true, message: '' }),
  removePaperAction: async () => ({ ok: true, message: '' }),
}));

const { default: JoinedTripPage } = await import('./page');

const LONG_DASH = String.fromCharCode(0x2014);
const NO_SUCH = '00000000-0000-4000-8000-000000000000';
let w: JoinedWorld;
let previousSwitch: string | undefined;

const page = (id: string = w.tripId) =>
  renderServer(JoinedTripPage({ params: Promise.resolve({ id }) }));

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  w = await joinedWorld();
  state.db = w.db;
  state.accountId = w.guestId;
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) delete process.env[TRIP_COMPANIONS_SWITCH];
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

async function documentProofOf(accountId: string, documentId: string) {
  const proof = await requireAccess(
    w.db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { documentId },
    { purpose: 'owner_trip' },
  );
  if (!proof.ok) throw new Error('proof');
  return proof.value as AuthorizedApplicant<'VIEW_METADATA'>;
}

describe('the joined trip page', () => {
  it('shows the basics, the organiser as The organiser, and how many more are travelling', async () => {
    const html = await page();
    const words = textOf(html);
    expect(words).toContain('Japan - Tourism');
    // The flag of the country is drawn in front of its name.
    expect(words).toMatch(/Where \S+ Japan/);
    expect(words).toContain('Why Tourism');
    expect(words).toContain('Travelling The organiser');
    // The organiser's family member is counted, never named.
    expect(words).toContain('1 more travelling with the organiser');
  });

  it('names the other people who joined by the names they confirmed, and not the person themself', async () => {
    const second = await addCompanion(await w.organiserProof(), w.tripId, {
      name: 'Omar Khan',
      email: 'omar@example.com',
    });
    if (!second.ok || !second.value.invitation) throw new Error('invite');
    const omar = await newAccount(w.db, 'omar@example.com');
    const opened = await openCompanionInvitation(w.db, {
      accountId: omar,
      rawToken: second.value.invitation.rawToken,
    });
    if (!opened.ok) throw new Error('open');
    await acceptCompanionInvitation(w.db, opened.value, {
      rawToken: second.value.invitation.rawToken,
      displayName: 'Omar the Confirmed',
    });
    const words = textOf(await page());
    expect(words).toContain('The organiser Omar the Confirmed');
    // Their own name is not repeated as another person.
    expect(words.match(new RegExp(COMPANION_NAME, 'g'))).toBeNull();
  });

  it('never names a managed family member, and shows no reference, id, case, document, email or token', async () => {
    const self = await addPerson(w.db, w.guestId, COMPANION_NAME);
    const paper = await addPaper(w.db, w.guestId, self, 'hotel_booking', 'Tokyo hotel.pdf');
    const planned = await planMyOwnCase(
      w.db,
      (await joinedCompanionAccess(w.db, w.guestId, w.tripId)) ?? (undefined as never),
    );
    if (!planned.ok || planned.value.status === 'needs_own_record') throw new Error('plan');
    const html = await page();
    expect(html).not.toContain(FAMILY_NAME);
    expect(html).not.toContain('Zubair');
    expect(html).not.toContain('Rahima');
    for (const secret of [
      FRIEND,
      'organiser@example.com',
      w.organiserId,
      w.organiserApplicantId,
      w.familyApplicantId,
      w.companionId,
      w.guestId,
      paper,
      self,
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(html).not.toMatch(/itineraryRef|reference|token|hash|mailto:|@/i);
    expect(html).not.toMatch(/[0-9a-f]{64}/);
    // The trip's own id is in the address and the forms; no other id of the trip is there.
    expect(html).not.toMatch(/relationship|SELF|FAMILY_MEMBER|MINOR_GUARDIAN/);
  });

  it('offers one filled button, Plan My Own Case for This Trip, until a case exists, then Open My Case', async () => {
    const before = await page();
    expect(before.match(/btn btn-primary/g)).toHaveLength(2);
    // Two filled buttons in two regions: their own case, and Save for what they share.
    expect(textOf(before)).toContain('Plan My Own Case for This Trip');
    expect(textOf(before)).not.toContain('Open My Case');
    const self = await addPerson(w.db, w.guestId, COMPANION_NAME);
    expect(self).toBeTruthy();
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    const planned = await planMyOwnCase(w.db, access);
    if (!planned.ok || planned.value.status === 'needs_own_record') throw new Error('plan');
    const after = await page();
    expect(textOf(after)).toContain('Open My Case');
    expect(textOf(after)).not.toContain('Plan My Own Case for This Trip');
    expect(after).toContain(`href="/app/mission/${planned.value.missionId}"`);
  });

  it('lets the companion choose what they share, three lines, the current one chosen', async () => {
    const html = await page();
    const words = textOf(html);
    expect(words).toContain('What You Share with the Organiser');
    for (const line of [
      'Name Only Your name and that you joined.',
      'Plan Status Also one plain phrase about your own case for this trip.',
      'Travel Bookings Also the names of booking and itinerary papers you choose.',
    ]) {
      expect(words).toContain(line);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/value="NAME_ONLY"[^>]*checked=""|checked=""[^>]*value="NAME_ONLY"/);
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'PLAN_STATUS');
    const again = await page();
    expect(again).toMatch(/value="PLAN_STATUS"[^>]*checked=""|checked=""[^>]*value="PLAN_STATUS"/);
  });

  it('has a quiet Leave This Trip, and no filled button for it', async () => {
    const html = await page();
    expect(html).toMatch(/btn btn-secondary[^>]*>Leave This Trip</);
    expect(html).not.toMatch(/btn-primary[^>]*>Leave/);
  });

  it('shows papers only at Travel Bookings: the chosen ones with Remove, and the rest to choose from', async () => {
    const self = await addPerson(w.db, w.guestId, COMPANION_NAME);
    const hotel = await addPaper(w.db, w.guestId, self, 'hotel_booking', 'Tokyo hotel.pdf');
    await addPaper(w.db, w.guestId, self, 'FLIGHT_TICKET', 'Flight to Tokyo.pdf');
    await addPaper(w.db, w.guestId, self, 'passport', 'Passport scan.pdf');
    expect(textOf(await page())).not.toContain('Papers You Show');
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'TRAVEL_BOOKINGS');
    await chooseTripPaper(w.db, access, await documentProofOf(w.guestId, hotel));
    const html = await page();
    const words = textOf(html);
    expect(words).toContain('Papers You Show (1)');
    expect(words).toContain('Tokyo hotel.pdf Hotel or Stay Booking');
    expect(html).toContain('aria-label="Remove: Tokyo hotel.pdf"');
    // The other travel paper can be added; the passport is never offered.
    expect(html).toContain('Flight to Tokyo.pdf (Flight Ticket)');
    expect(html).not.toContain('Passport scan');
    // A paper's id appears only as a form value, never as text.
    expect(words).not.toContain(hotel);
  });

  it('has no papers section when the papers table is missing (Travel Bookings behaves as before)', async () => {
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'TRAVEL_BOOKINGS');
    await w.db.execute(sql`drop table umpe_trip_companion_papers`);
    state.db = drizzle(w.client, { schema }) as unknown as Db;
    const html = await page();
    expect(textOf(html)).toContain('What You Share with the Organiser');
    expect(textOf(html)).not.toContain('Papers You Show');
  });

  it('is plain: Title Case, no inline style, no long dash, never the word mission in text', async () => {
    const html = await page();
    expect(html).not.toContain('style=');
    expect(html).not.toContain(LONG_DASH);
    expect(textOf(html)).not.toMatch(/mission/i);
    expect(html).toMatch(/<h1[^>]*>Japan - Tourism</);
  });
});

describe('every bad request is the same 404', () => {
  const notFound = (id?: string) => expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');

  it('an unknown trip, a made-up or malformed id', async () => {
    await notFound(NO_SUCH);
    await notFound('not-an-id');
    await notFound('');
  });

  it("someone else's account, and the organiser's own account", async () => {
    state.accountId = await newAccount(w.db, 'stranger@example.com');
    await notFound();
    state.accountId = w.organiserId;
    await notFound();
  });

  it('a person who left, was removed, or never joined (invited, declined, expired)', async () => {
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await leaveTrip(w.db, access);
    await notFound();

    const other = await joinedWorld();
    state.db = other.db;
    state.accountId = other.guestId;
    await removeCompanion(await other.organiserProof(), other.tripId, other.companionId);
    await expect(
      renderServer(JoinedTripPage({ params: Promise.resolve({ id: other.tripId }) })),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    // Invited but not joined: the page is for people who joined.
    const invited = await joinedWorld();
    state.db = invited.db;
    const second = await addCompanion(await invited.organiserProof(), invited.tripId, {
      name: 'Waiting Person',
      email: 'waiting@example.com',
    });
    if (!second.ok || !second.value.invitation) throw new Error('invite');
    state.accountId = await newAccount(invited.db, 'waiting@example.com');
    const render = () =>
      renderServer(JoinedTripPage({ params: Promise.resolve({ id: invited.tripId }) }));
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    // Declined: the same.
    const opened = await openCompanionInvitation(invited.db, {
      accountId: state.accountId,
      rawToken: second.value.invitation.rawToken,
    });
    if (!opened.ok) throw new Error('open');
    await declineCompanionInvitation(invited.db, opened.value, {
      rawToken: second.value.invitation.rawToken,
    });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    // Expired: the same.
    const third = await addCompanion(await invited.organiserProof(), invited.tripId, {
      name: 'Late Person',
      email: 'late@example.com',
    });
    if (!third.ok) throw new Error('add');
    await invited.db
      .update(schema.umpeTripCompanions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.umpeTripCompanions.id, third.value.companion.id));
    state.accountId = await newAccount(invited.db, 'late@example.com');
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  }, 90_000);

  it('the feature switched off, and the companions table missing', async () => {
    delete process.env[TRIP_COMPANIONS_SWITCH];
    await notFound();
    process.env[TRIP_COMPANIONS_SWITCH] = 'true';
    await w.db.execute(sql`drop table umpe_trip_companion_papers, umpe_trip_companions`);
    state.db = drizzle(w.client, { schema }) as unknown as Db;
    await notFound();
  });

  it('all of them render the same thing to the person (compared as the error they raise)', async () => {
    const outcomes = new Set<string>();
    for (const id of [NO_SUCH, 'not-an-id']) {
      try {
        await page(id);
      } catch (error) {
        outcomes.add(String((error as Error).message));
      }
    }
    state.accountId = await newAccount(w.db, 'stranger2@example.com');
    try {
      await page();
    } catch (error) {
      outcomes.add(String((error as Error).message));
    }
    expect([...outcomes]).toEqual(['NEXT_NOT_FOUND']);
  });
});
