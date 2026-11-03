import { schema } from '@visastack/db';
import {
  TRIP_COMPANIONS_SWITCH,
  accountPrincipal,
  chooseTripPaper,
  joinedCompanionAccess,
  listCompanions,
  requireAccess,
  setCompanionShareLevel,
  setConsent,
} from '@visastack/services';
import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type JoinedWorld,
  addPaper,
  addPerson,
  joinedWorld,
  newAccount,
} from './joined-world.test-support';

/**
 * What a joined companion does on their trip page, against a real database. Every action finds the
 * trip from the form AND the signed-in account, and every bad request is the one fixed answer.
 * Only fixed words come back: never an address, a paper's details or an id.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));

const {
  choosePaperAction,
  leaveTripAction,
  planOwnCaseAction,
  removePaperAction,
  setShareLevelAction,
} = await import('./actions');

const INITIAL = { ok: true, message: '' };
const UNAVAILABLE = 'This trip is not available.';
const NO_SUCH = '00000000-0000-4000-8000-000000000000';
let w: JoinedWorld;
let previousSwitch: string | undefined;
/** Everything an action said back, to check no address, id or detail is in any of it. */
let said: unknown[] = [];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function run<T>(call: Promise<T>): Promise<T | { redirect: string }> {
  try {
    const result = await call;
    said.push(result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT ')) {
      const to = error.message.slice('NEXT_REDIRECT '.length);
      said.push(to);
      return { redirect: to };
    }
    throw error;
  }
}

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  said = [];
  w = await joinedWorld();
  state.db = w.db;
  state.accountId = w.guestId;
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) delete process.env[TRIP_COMPANIONS_SWITCH];
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

const level = async () => {
  const view = await requireAccess(
    w.db,
    accountPrincipal(w.organiserId),
    'VIEW_METADATA',
    { applicantId: w.organiserApplicantId },
    { purpose: 'owner_trip' },
  );
  if (!view.ok) throw new Error('proof');
  const listed = await listCompanions(view.value, w.tripId);
  if (!listed.ok) throw new Error('list');
  return listed.value.find((p) => p.id === w.companionId);
};

describe('What You Share with the Organiser', () => {
  it('changes the level, and the organiser sees it on the next read', async () => {
    expect((await level())?.shareLevel).toBe('NAME_ONLY');
    const saved = await run(
      setShareLevelAction(INITIAL, form({ tripId: w.tripId, shareLevel: 'PLAN_STATUS' })),
    );
    expect(saved).toEqual({ ok: true, message: 'Saved.' });
    expect((await level())?.shareLevel).toBe('PLAN_STATUS');
    await run(setShareLevelAction(INITIAL, form({ tripId: w.tripId, shareLevel: 'NAME_ONLY' })));
    expect((await level())?.shareLevel).toBe('NAME_ONLY');
  });

  it('refuses a level that is not one of the three, and changes nothing', async () => {
    for (const bad of ['EVERYTHING', '', 'name_only']) {
      const refused = await run(
        setShareLevelAction(INITIAL, form({ tripId: w.tripId, shareLevel: bad })),
      );
      expect(refused).toMatchObject({ ok: false, field: 'shareLevel' });
    }
    expect((await level())?.shareLevel).toBe('NAME_ONLY');
  });

  it('is the companion alone: the organiser, a stranger, a garbage id and an unknown trip get the one answer', async () => {
    const attempt = (tripId: string) =>
      run(setShareLevelAction(INITIAL, form({ tripId, shareLevel: 'TRAVEL_BOOKINGS' })));
    state.accountId = w.organiserId;
    expect(await attempt(w.tripId)).toEqual({ ok: false, message: UNAVAILABLE });
    state.accountId = await newAccount(w.db, 'stranger@example.com');
    expect(await attempt(w.tripId)).toEqual({ ok: false, message: UNAVAILABLE });
    state.accountId = w.guestId;
    expect(await attempt('not-an-id')).toEqual({ ok: false, message: UNAVAILABLE });
    expect(await attempt(NO_SUCH)).toEqual({ ok: false, message: UNAVAILABLE });
    expect((await level())?.shareLevel).toBe('NAME_ONLY');
  });

  it('is refused with the switch off', async () => {
    delete process.env[TRIP_COMPANIONS_SWITCH];
    const refused = await run(
      setShareLevelAction(INITIAL, form({ tripId: w.tripId, shareLevel: 'PLAN_STATUS' })),
    );
    expect(refused).toEqual({ ok: false, message: UNAVAILABLE });
  });
});

describe('Leave This Trip', () => {
  it('leaves, goes to My Trips, and the organiser no longer lists them', async () => {
    const left = await run(leaveTripAction(INITIAL, form({ tripId: w.tripId })));
    expect(left).toEqual({ redirect: '/app/trips' });
    expect(await level()).toBeUndefined();
    const rows = await w.db
      .select({ state: schema.umpeTripCompanions.state, email: schema.umpeTripCompanions.email })
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, w.companionId));
    expect(rows).toEqual([{ state: 'LEFT', email: null }]);
    // The trip is gone for them: a second try is the one fixed answer.
    expect(await run(leaveTripAction(INITIAL, form({ tripId: w.tripId })))).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
  });

  it('cannot be done by anyone else', async () => {
    state.accountId = await newAccount(w.db, 'stranger@example.com');
    expect(await run(leaveTripAction(INITIAL, form({ tripId: w.tripId })))).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    expect((await level())?.status).toBe('JOINED');
  });
});

describe('Plan My Own Case for This Trip', () => {
  const missionsOf = async (accountId: string) =>
    w.db
      .select({ id: schema.missions.id, destination: schema.missions.destination })
      .from(schema.missions)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
      .where(eq(schema.applicants.ownerAccountId, accountId));

  it('with no record at all, goes to the first-run steps and back to this trip, and makes nothing', async () => {
    const result = await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    expect(result).toEqual({
      redirect: `/app?next=${encodeURIComponent(`/app/trip-invitations/${w.tripId}`)}`,
    });
    expect(await missionsOf(w.guestId)).toEqual([]);
  });

  it('with only a family record, goes to All Travellers to add their own, and makes nothing', async () => {
    await addPerson(w.db, w.guestId, 'A Family Member', 'FAMILY_MEMBER');
    const result = await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    expect(result).toEqual({ redirect: '/app/applicants' });
    expect(await missionsOf(w.guestId)).toEqual([]);
  });

  it('starts their own case, goes straight to it, and a second try goes to the same one', async () => {
    await addPerson(w.db, w.guestId, 'Nadia Rahman');
    const organiserBefore = (await missionsOf(w.organiserId)).length;
    const first = await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    const mine = await missionsOf(w.guestId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.destination).toBe('Japan');
    expect(first).toEqual({ redirect: `/app/mission/${mine[0]?.id}` });
    const second = await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    expect(second).toEqual(first);
    expect(await missionsOf(w.guestId)).toHaveLength(1);
    // Nothing was made on the organiser's account.
    expect(await missionsOf(w.organiserId)).toHaveLength(organiserBefore);
  });

  it('needs the account consent first, in plain words', async () => {
    await addPerson(w.db, w.guestId, 'Nadia Rahman');
    await setConsent(w.db, {
      actorAccountId: w.guestId,
      accountId: w.guestId,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    const refused = await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    expect(refused).toEqual({
      ok: false,
      message: 'Turn on Let VisaStack Process My Details on Home, then try again.',
    });
    expect(await missionsOf(w.guestId)).toEqual([]);
  });

  it('is the companion alone', async () => {
    await addPerson(w.db, w.organiserId, 'Second Organiser Record');
    state.accountId = w.organiserId;
    expect(await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })))).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    state.accountId = await newAccount(w.db, 'stranger@example.com');
    await addPerson(w.db, state.accountId, 'Stranger');
    expect(await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })))).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
  });
});

describe('papers to show the organiser', () => {
  let own: string;
  let hotel: string;
  beforeEach(async () => {
    own = await addPerson(w.db, w.guestId, 'Nadia Rahman');
    hotel = await addPaper(w.db, w.guestId, own, 'hotel_booking', 'Tokyo hotel.pdf');
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'TRAVEL_BOOKINGS');
  });

  const papersSeen = async () => (await level())?.papers.map((p) => p.name) ?? [];

  it('chooses and removes a paper, and the organiser sees the name on the next read', async () => {
    const added = await run(
      choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel })),
    );
    expect(added).toEqual({ ok: true, message: 'Added.' });
    expect(await papersSeen()).toEqual(['Tokyo hotel.pdf']);
    const removed = await run(
      removePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel })),
    );
    expect(removed).toEqual({ ok: true, message: 'Removed.' });
    expect(await papersSeen()).toEqual([]);
  });

  it('refuses a passport, in plain words', async () => {
    const passport = await addPaper(w.db, w.guestId, own, 'passport', 'Passport scan.pdf');
    const refused = await run(
      choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId: passport })),
    );
    expect(refused).toMatchObject({ ok: false, field: 'documentId' });
    expect(JSON.stringify(refused)).toMatch(/bookings, itineraries, invitations/);
    expect(await papersSeen()).toEqual([]);
  });

  it("refuses another person's paper and a made-up id with the same words, and shows nothing", async () => {
    const organiserPaper = await addPaper(
      w.db,
      w.organiserId,
      w.organiserApplicantId,
      'hotel_booking',
      'Organiser hotel.pdf',
    );
    const stranger = await newAccount(w.db, 'stranger@example.com');
    const strangerSelf = await addPerson(w.db, stranger, 'Stranger');
    const strangerPaper = await addPaper(
      w.db,
      stranger,
      strangerSelf,
      'hotel_booking',
      'Theirs.pdf',
    );
    const family = await addPerson(w.db, w.guestId, 'A Family Member', 'FAMILY_MEMBER');
    const familyPaper = await addPaper(
      w.db,
      w.guestId,
      family,
      'hotel_booking',
      'Family hotel.pdf',
    );
    const answers = [];
    for (const documentId of [organiserPaper, strangerPaper, familyPaper, NO_SUCH]) {
      answers.push(await run(choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId }))));
    }
    for (const answer of answers) {
      expect(answer).toEqual({
        ok: false,
        message: 'That paper is not available.',
        field: 'documentId',
      });
    }
    const rows = await w.db.select({ n: count() }).from(schema.umpeTripCompanionPapers);
    expect(Number(rows[0]?.n)).toBe(0);
    expect(await papersSeen()).toEqual([]);
  });

  it('needs the Travel Bookings level first, in plain words', async () => {
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'PLAN_STATUS');
    const refused = await run(
      choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel })),
    );
    expect(refused).toEqual({
      ok: false,
      message: 'Choose Travel Bookings first.',
      field: 'documentId',
    });
  });

  it('is the companion alone', async () => {
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    const view = await requireAccess(
      w.db,
      accountPrincipal(w.guestId),
      'VIEW_METADATA',
      { documentId: hotel },
      { purpose: 'owner_trip' },
    );
    if (!view.ok) throw new Error('proof');
    const proof = view.value;
    await chooseTripPaper(w.db, access, proof);
    state.accountId = w.organiserId;
    expect(
      await run(removePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel }))),
    ).toEqual({ ok: false, message: UNAVAILABLE });
    expect(
      await run(choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel }))),
    ).toEqual({ ok: false, message: UNAVAILABLE });
    expect(await papersSeen()).toEqual(['Tokyo hotel.pdf']);
  });
});

describe('what the actions say back', () => {
  it('is only fixed words: never an address, an id, a link or a paper name', async () => {
    const own = await addPerson(w.db, w.guestId, 'Nadia Rahman');
    const hotel = await addPaper(w.db, w.guestId, own, 'hotel_booking', 'Tokyo hotel.pdf');
    await run(
      setShareLevelAction(INITIAL, form({ tripId: w.tripId, shareLevel: 'TRAVEL_BOOKINGS' })),
    );
    await run(choosePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel })));
    await run(removePaperAction(INITIAL, form({ tripId: w.tripId, documentId: hotel })));
    await run(planOwnCaseAction(INITIAL, form({ tripId: w.tripId })));
    await run(leaveTripAction(INITIAL, form({ tripId: w.tripId })));
    const text = JSON.stringify(said);
    expect(said.length).toBeGreaterThan(4);
    for (const secret of [
      '@',
      'example.com',
      'Tokyo',
      hotel,
      own,
      w.companionId,
      w.guestId,
      w.organiserId,
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/token|hash/i);
  });
});
