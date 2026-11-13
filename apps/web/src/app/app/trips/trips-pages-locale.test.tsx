import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
const data = vi.hoisted(() => ({
  trips: [] as { id: string; title: string; travellerCount: number }[],
  hasTravellers: true,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.test' }),
}));
vi.mock('./trip-data', () => ({
  loadTripList: async () => ({ trips: data.trips, hasTravellers: data.hasTravellers }),
  loadJoinedTrips: async () => [],
  loadTripPage: async () => null,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listApplicants: async () => [{ id: 'p1', displayName: 'Rahima Akter' }],
  tripTablesReady: async () => true,
  tripCompanionsAvailable: async () => false,
}));
vi.mock('./actions', () => ({
  startGroupTripAction: vi.fn(),
  addTravellersAction: vi.fn(),
  removeTravellerAction: vi.fn(),
  addTripEvidenceAction: vi.fn(),
  removeTripEvidenceAction: vi.fn(),
  tripEvidenceAllowanceAction: vi.fn(),
  removeCompanionAction: vi.fn(),
  resendCompanionAction: vi.fn(),
}));

const { appTripsCatalog } = await import('../../../i18n/app-trips');
const { default: TripsPage } = await import('./(list)/page');
const { default: TripPage } = await import('./[id]/page');
const { default: NewTripPage } = await import('./new/page');

const bn = appTripsCatalog.bn as Record<string, string>;
const en = appTripsCatalog.en as Record<string, string>;

/** The group trip pages under Bengali, in each state a traveller can reach. */
async function draw(locale: 'en' | 'bn', page: () => Promise<React.JSX.Element>) {
  current.holder = null;
  current.locale = locale;
  return textOf(await renderServer(await page()));
}
function expectBengali(text: string, keys: readonly string[]) {
  for (const key of keys) {
    const full = `appTrips.${key}`;
    expect(full in bn, key).toBe(true);
    for (const part of (bn[full] ?? '?')
      .split(/\{\w+\}/)
      .map((p) => p.trim())
      .filter(Boolean))
      expect(text, key).toContain(part);
    expect(text, key).not.toContain(en[full]);
  }
  expect(text).not.toMatch(/appTrips\./);
}

beforeEach(() => {
  navigationState.pathname = '/app/trips';
  data.trips = [];
  data.hasTravellers = true;
});
afterEach(() => {
  current.locale = 'en';
});

describe('the group trip pages under Bengali', () => {
  it('no trips yet: the empty line and Start a Group Trip', async () => {
    const text = await draw('bn', () => TripsPage());
    expectBengali(text, ['appTripsPage.noGroupTripsYet', 'appTripsPage.startAGroupTrip']);
  });

  it('a list of trips counts the travellers on each, with Bengali digits', async () => {
    data.trips = [
      { id: 't1', title: 'Cox’s Bazar', travellerCount: 1 },
      { id: 't2', title: 'Bangkok', travellerCount: 3 },
    ];
    const text = await draw('bn', () => TripsPage());
    expectBengali(text, ['appTripsPage.1Traveller']);
    expect(text).toContain(
      bn['appTrips.appTripsPage.travellercountTravellers']?.replace('{travellerCount}', '৩'),
    );
    expect(text).not.toContain('3 Travellers');
    expect(await draw('en', () => TripsPage())).toContain('3 Travellers');
  });

  it('a trip that cannot be shown says so', async () => {
    const text = await draw('bn', () =>
      TripPage({ params: Promise.resolve({ id: 't9' }), searchParams: Promise.resolve({}) }),
    );
    expectBengali(text, ['appTripsIdPage.thisTripIsNotAvailable']);
  });

  it('starting a group trip explains what it does', async () => {
    const text = await draw('bn', () => NewTripPage());
    expectBengali(text, ['appTripsNewPage.tellUsWhereYouAreGoing']);
  });
});
