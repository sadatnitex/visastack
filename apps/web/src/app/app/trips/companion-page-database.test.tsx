import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  TRIP_COMPANIONS_SWITCH,
  accountPrincipal,
  addCompanion,
  createApplicant,
  provisionAccount,
  requireAccess,
  setConsent,
  startGroupTrip,
} from '@visastack/services';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseCountryOptions, casePurposeGroups } from '../../../lib/case-choices';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';
import { loadTripPage } from './trip-data';
import { GroupTripStartForm } from './trip-forms';
import { TripOverview } from './trip-overview';

/**
 * The trip page as the organiser gets it, read from a real database and rendered: one person of
 * each state, and nothing in the page that is an address, a link or a stored hash. With the
 * feature off, or the table missing, the page has nothing new on it.
 */

const FRIEND = 'friend@example.com';
const OTHER = 'joined.person@example.com';
let db: Db;
let client: Awaited<ReturnType<typeof createMigratedPglite>>;
let accountId: string;
let tripId: string;
let previousSwitch: string | undefined;

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
  const account = await provisionAccount(db, { email: 'owner@example.com' });
  if (!account.ok) throw new Error('account');
  accountId = account.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const self = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Rahima Akter',
  });
  if (!self.ok) throw new Error('applicant');
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId: self.value.id },
    { purpose: 'owner_trip' },
  );
  if (!proof.ok) throw new Error('proof');
  const started = await startGroupTrip(proof.value, { destination: 'Japan', purpose: 'Tourism' });
  if (!started.ok) throw new Error('trip');
  tripId = started.value.tripId;
  const add = async (name: string, email?: string) => {
    const added = await addCompanion(proof.value, tripId, {
      name,
      ...(email === undefined ? {} : { email }),
    });
    if (!added.ok) throw new Error(added.error.message);
    return added.value.companion.id;
  };
  await add('Jamal Hossain');
  await add('Nadia Rahman', FRIEND);
  const joined = await add('Lena Planner', OTHER);
  const joiner = await provisionAccount(db, { email: OTHER });
  if (!joiner.ok) throw new Error('joiner');
  await db
    .update(schema.umpeTripCompanions)
    .set({
      state: 'JOINED',
      tokenHash: null,
      expiresAt: null,
      joinedAccountId: joiner.value.id,
      shareLevel: 'PLAN_STATUS',
    })
    .where(eq(schema.umpeTripCompanions.id, joined));
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) delete process.env[TRIP_COMPANIONS_SWITCH];
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

const page = async (on: Db = db) => {
  const data = await loadTripPage(on, accountId, tripId);
  if (!data) throw new Error('no trip');
  const html = await renderServer(
    <TripOverview
      tripId={data.id}
      travellers={data.travellers}
      sharedDocuments={data.sharedDocuments}
      addable={data.addable}
      documentOptions={data.documentOptions}
      companionsOn={data.companionsOn}
      companions={data.companions}
    />,
  );
  return { data, html };
};

describe('the group trip page with people travelling with the organiser', () => {
  it('lists one person of each state with their name and one word, and nothing private', async () => {
    const { data, html } = await page();
    expect(data.companionsOn).toBe(true);
    expect(data.companions.map((c) => [c.name, c.status])).toEqual([
      ['Jamal Hossain', 'NAME_ONLY'],
      ['Nadia Rahman', 'INVITED'],
      ['Lena Planner', 'JOINED'],
    ]);
    const words = textOf(html);
    expect(words).toContain('Travelling with You');
    expect(words).toContain('Jamal Hossain Not on VisaStack Yet');
    expect(words).toContain('Nadia Rahman Invited');
    expect(words).toContain('Lena Planner Joined Shares Plan Status');
    expect(html).not.toContain(FRIEND);
    expect(html).not.toContain(OTHER);
    expect(html).not.toMatch(/@|mailto:/);
    expect(html).not.toMatch(/[0-9a-f]{64}/);
    expect(html).not.toMatch(/token|hash/i);
    // Only the invited person can be sent to again.
    expect(html.match(/>Send Again</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Send Again: Nadia Rahman"');
    expect(html.match(/>Remove</g)).toHaveLength(3);
  });

  it('shows the Add Someone Else button on the start form and the trip form, and no address in either', async () => {
    const start = await renderServer(
      <GroupTripStartForm
        countries={caseCountryOptions()}
        purposes={casePurposeGroups()}
        travellers={[{ applicantId: 'p1', name: 'Rahima Akter' }]}
        companionsOn
      />,
    );
    expect(start).toContain('Add Someone Else');
    expect(start).not.toContain('newPersonName');
    expect(start).not.toMatch(/@|token|hash/i);
    const { html } = await page();
    expect(html).toContain('Add Someone Else');
  });

  it('has nothing new on it while the feature is off', async () => {
    delete process.env[TRIP_COMPANIONS_SWITCH];
    const { data, html } = await page();
    expect(data.companionsOn).toBe(false);
    expect(data.companions).toEqual([]);
    expect(html).not.toContain('Travelling with You');
    expect(html).not.toContain('Someone Else');
    expect(html).not.toContain('Jamal Hossain');
  });

  it('has nothing new on it while the table is missing', async () => {
    await db.execute(sql`drop table umpe_trip_companion_papers, umpe_trip_companions`);
    // A table that was seen once is remembered per database handle (it is never dropped for real),
    // so the page reads through a fresh handle, as a new request does.
    const { data, html } = await page(drizzle(client, { schema }) as unknown as Db);
    expect(data.companionsOn).toBe(false);
    expect(html).not.toContain('Travelling with You');
    expect(html).not.toContain('Someone Else');
  });
});
