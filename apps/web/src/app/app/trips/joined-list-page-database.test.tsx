import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

import { schema } from '@visastack/db';
import {
  type Db,
  TRIP_COMPANIONS_SWITCH,
  addCompanion,
  declineCompanionInvitation,
  joinedCompanionAccess,
  leaveTrip,
  openCompanionInvitation,
} from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRIEND,
  type JoinedWorld,
  joinedWorld,
  newAccount,
} from '../trip-invitations/[id]/joined-world.test-support';

/**
 * Trips You Joined on the My Trips list page, read from a real database and rendered: joined trips
 * link to their page, a waiting invitation has no link and no token, and with the feature off, the
 * table missing or nothing to show the section is not there at all.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));

vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));

const { default: TripsPage } = await import('./(list)/page');

let w: JoinedWorld;
let previousSwitch: string | undefined;
const page = () => renderServer(TripsPage());

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

describe('Trips You Joined', () => {
  it('lists a joined trip as a link to its page, and nothing private', async () => {
    const html = await page();
    const words = textOf(html);
    expect(words).toContain('Trips You Joined');
    expect(words).toContain('Japan - Tourism Japan');
    expect(html).toContain(`href="/app/trip-invitations/${w.tripId}"`);
    expect(html).not.toContain(FRIEND);
    expect(html).not.toContain('organiser@example.com');
    expect(html).not.toContain(w.companionId);
    expect(html).not.toMatch(/token|hash|accept/i);
  });

  it('shows a waiting invitation as a plain line with no link and no token', async () => {
    const waiting = await addCompanion(await w.organiserProof(), w.tripId, {
      name: 'Someone Else',
      email: 'waiting@example.com',
    });
    if (!waiting.ok || !waiting.value.invitation) throw new Error('invite');
    state.accountId = await newAccount(w.db, 'waiting@example.com');
    const html = await page();
    const words = textOf(html);
    expect(words).toContain('Trips You Joined');
    expect(words).toContain('Open the link in your email to answer.');
    expect(html).not.toContain('/app/trip-invitations');
    expect(html).not.toContain(waiting.value.invitation.rawToken);
    expect(html).not.toContain('token=');
    expect(html).not.toContain('waiting@example.com');
  });

  it('is not there for someone with nothing to show, for one who left, or for one who declined', async () => {
    state.accountId = await newAccount(w.db, 'nobody@example.com');
    expect(textOf(await page())).not.toContain('Trips You Joined');
    state.accountId = w.guestId;
    const access = await joinedCompanionAccess(w.db, w.guestId, w.tripId);
    if (!access) throw new Error('access');
    await leaveTrip(w.db, access);
    expect(textOf(await page())).not.toContain('Trips You Joined');
    // Declined invitation: nothing either.
    const other = await addCompanion(await w.organiserProof(), w.tripId, {
      name: 'Decliner',
      email: 'decliner@example.com',
    });
    if (!other.ok || !other.value.invitation) throw new Error('invite');
    state.accountId = await newAccount(w.db, 'decliner@example.com');
    const opened = await openCompanionInvitation(w.db, {
      accountId: state.accountId,
      rawToken: other.value.invitation.rawToken,
    });
    if (!opened.ok) throw new Error('open');
    await declineCompanionInvitation(w.db, opened.value, {
      rawToken: other.value.invitation.rawToken,
    });
    expect(textOf(await page())).not.toContain('Trips You Joined');
  }, 60_000);

  it("never shows the organiser's own trips as joined, and an organiser sees no section", async () => {
    state.accountId = w.organiserId;
    const html = await page();
    expect(textOf(html)).not.toContain('Trips You Joined');
    expect(textOf(html)).toContain('Group Trips');
  });

  it('is not there while the feature is off or the table is missing', async () => {
    delete process.env[TRIP_COMPANIONS_SWITCH];
    expect(textOf(await page())).not.toContain('Trips You Joined');
    process.env[TRIP_COMPANIONS_SWITCH] = 'true';
    await w.db.execute(sql`drop table umpe_trip_companion_papers, umpe_trip_companions`);
    state.db = drizzle(w.client, { schema }) as unknown as Db;
    expect(textOf(await page())).not.toContain('Trips You Joined');
  });
});
