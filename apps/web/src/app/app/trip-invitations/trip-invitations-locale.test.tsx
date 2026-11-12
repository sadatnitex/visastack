import { schema } from '@visastack/db';
import {
  type AuthorizedApplicant,
  TRIP_COMPANIONS_SWITCH,
  accountPrincipal,
  addCompanion,
  chooseTripPaper,
  joinedCompanionAccess,
  provisionAccount,
  requireAccess,
  setCompanionShareLevel,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../../../lib/bengali-marked.test-support';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';
import {
  COMPANION_NAME,
  type JoinedWorld,
  addPaper,
  addPerson,
  joinedWorld,
} from './[id]/joined-world.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  locale: 'en' as 'en' | 'bn',
  generation: 0,
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));
vi.mock('../actions', () => ({ setConsentAction: async () => ({ ok: true, message: '' }) }));
vi.mock('./accept/actions', () => ({
  acceptTripInvitationAction: async () => ({ ok: true, message: '' }),
  declineTripInvitationAction: async () => ({ ok: true, message: '' }),
}));
vi.mock('./[id]/actions', () => ({
  setShareLevelAction: async () => ({ ok: true, message: '' }),
  leaveTripAction: async () => ({ ok: true, message: '' }),
  planOwnCaseAction: async () => ({ ok: true, message: '' }),
  choosePaperAction: async () => ({ ok: true, message: '' }),
  removePaperAction: async () => ({ ok: true, message: '' }),
}));

import { I18nProvider } from '../../../components/i18n-provider';
import { appTripInvitationsCatalog } from '../../../i18n/app-trip-invitations';

const { default: AcceptPage } = await import('./accept/page');
const { default: JoinedTripPage } = await import('./[id]/page');

const BENGALI = /[ঀ-৿]/;
const bn = appTripInvitationsCatalog.bn as Record<string, string>;
const en = appTripInvitationsCatalog.en as Record<string, string>;
const key = (page: string, name: string) => `appTripInvitations.appTripInvitations${page}.${name}`;

let previousSwitch: string | undefined;
let w: JoinedWorld;

async function show(locale: 'en' | 'bn', element: () => Promise<React.JSX.Element>) {
  state.locale = locale;
  state.generation += 1;
  return renderServer(
    <I18nProvider locale={locale} pageLang="en">
      {await element()}
    </I18nProvider>,
  );
}
const accept = (locale: 'en' | 'bn', token: string) =>
  show(locale, () => AcceptPage({ searchParams: Promise.resolve({ token }) }));
const joined = (locale: 'en' | 'bn') =>
  show(locale, () => JoinedTripPage({ params: Promise.resolve({ id: w.tripId }) }));

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  w = await joinedWorld();
  state.db = w.db;
  state.accountId = w.guestId;
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) Reflect.deleteProperty(process.env, TRIP_COMPANIONS_SWITCH);
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

describe('trip invitation pages under Bengali', () => {
  it('unavailable invitation: the Bengali heading and help sentence (signed off 2026-11-12)', async () => {
    const words = textOf(await accept('bn', 'N'.repeat(43)));
    expect(words).toContain(bn[key('AcceptPage', 'goToHome')]);
    expect(words).toContain(bn[key('AcceptPage', 'invitationUnavailable')]);
    expect(words).toContain(bn[key('AcceptPage', 'askThePersonWhoInvitedYou')]);
    expect(textOf(await accept('en', 'N'.repeat(43)))).not.toMatch(BENGALI);
  });

  it('open invitation: the Why label and the sharing wording are Bengali (signed off 2026-11-12)', async () => {
    const organiserProof = await w.organiserProof();
    const added = await addCompanion(organiserProof, w.tripId, {
      name: 'Karim Uddin',
      email: 'karim@example.com',
    });
    if (!added.ok || !added.value.invitation) throw new Error('invite');
    const made = await provisionAccount(w.db, { email: 'karim@example.com' });
    if (!made.ok) throw new Error('account');
    await setConsent(w.db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await w.db
      .update(schema.accounts)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.accounts.id, made.value.id));
    state.accountId = made.value.id;
    const token = added.value.invitation.rawToken;
    const words = textOf(await accept('bn', token));
    expect(words).toContain(bn[key('IdPage', 'why')]);
    expect(words).toContain(bn[key('AcceptAcceptForm', 'shareMore')]);
    expect(words).toContain(bn[key('AcceptPage', 'invitationEnds')]);
    expect(textOf(await accept('en', token))).toContain('Share More');
  });

  it('joined trip, name only: the Why label is Bengali', async () => {
    const words = textOf(await joined('bn'));
    expect(words).toContain(bn[key('IdPage', 'why')]);
    expect(words).not.toContain('Papers You Show');
    expect(textOf(await joined('en'))).not.toMatch(BENGALI);
  });

  it('joined trip with a chosen paper: the Remove label keeps its English name, matching the visible button', async () => {
    const self = await addPerson(w.db, w.guestId, COMPANION_NAME);
    const hotel = await addPaper(w.db, w.guestId, self, 'hotel_booking', 'Tokyo hotel.pdf');
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await setCompanionShareLevel(w.db, access, 'TRAVEL_BOOKINGS');
    const proof = await requireAccess(
      w.db,
      accountPrincipal(w.guestId),
      'VIEW_METADATA',
      { documentId: hotel },
      { purpose: 'owner_trip' },
    );
    if (!proof.ok) throw new Error('proof');
    await chooseTripPaper(w.db, access, proof.value as AuthorizedApplicant<'VIEW_METADATA'>);
    const html = await joined('bn');
    expect(html).toContain('aria-label="Remove: Tokyo hotel.pdf"');
    expect(await joined('en')).toContain('aria-label="Remove: Tokyo hotel.pdf"');
    expect(textOf(html)).toContain(bn[key('IdJoinedTripForms', 'whatYouShareWithTheOrganiser')]);
  });
});

describe('trip invitation pages, language of parts', () => {
  it('marks the Bengali on an English page lang="bn"', async () => {
    const r = bengaliMarking(await accept('bn', 'N'.repeat(43)));
    expect(r.unmarked).toEqual([]);
    expect(r.marked).toBeGreaterThan(0);
  });
});
