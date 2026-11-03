/**
 * UMPE UX6, package 4: "Plan My Own Case for This Trip".
 *
 * Synthetic data only. Pins:
 * 1. The case is the companion's OWN, on their OWN account and their own record, with the trip's
 *    destination and purpose, through the ordinary case creation path. Nothing is made on the
 *    organiser's account.
 * 2. It needs the companion's account consent and a record of their own (never a family member
 *    they manage): with none, the answer says so and nothing is made.
 * 3. One case per companion and trip: a second try (even at the same moment) opens the first.
 * 4. Nothing flows to the organiser except the one plain phrase, and only at Plan Status or more:
 *    no grant, no access to the case, its checklist or its documents.
 */
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { joinedCompanionAccess } from './access/trip-companion-access';
import { setConsent } from './consent';
import type { Db } from './db';
import { myTripCaseId, planMyOwnCase } from './umpe-trip-companion-case';
import { leaveTrip, setCompanionShareLevel } from './umpe-trip-companions';
import { TRIP_COMPANIONS_SWITCH } from './umpe-trip-companions-switch';
import {
  type Organiser,
  document,
  freshDb,
  joined,
  organiser,
  organiserList,
  proofFor,
  traveller,
} from './umpe-trip-companions.test-support';

const TEST_TIMEOUT_MS = 90_000;
const SWITCH = TRIP_COMPANIONS_SWITCH;

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[SWITCH];
  process.env[SWITCH] = 'true';
});
afterEach(() => {
  if (previous === undefined) delete process.env[SWITCH];
  else process.env[SWITCH] = previous;
});

interface World {
  readonly db: Db;
  readonly org: Organiser;
  readonly guest: string;
  readonly access: Awaited<ReturnType<typeof joined>>['access'];
  readonly companionId: string;
}

async function world(level = 'NAME_ONLY'): Promise<World> {
  const db = await freshDb();
  const org = await organiser(db);
  const made = await joined(db, org, 'Nadia Rahman', 'nadia@example.com', level);
  return { db, org, guest: made.guest, access: made.access, companionId: made.companionId };
}

async function missionsOf(db: Db, accountId: string) {
  return db
    .select({ id: schema.missions.id, applicantId: schema.missions.applicantId })
    .from(schema.missions)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(eq(schema.applicants.ownerAccountId, accountId));
}

const ownMissionOf = async (db: Db, companionId: string) =>
  (
    await db
      .select({ id: schema.umpeTripCompanions.ownMissionId })
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, companionId))
  )[0]?.id ?? null;

describe('UMPE UX6 package 4: Plan My Own Case for This Trip', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TEST_TIMEOUT_MS);

  it("starts the companion's own case on their own record, with the trip's destination and purpose", async () => {
    const self = await traveller(w.db, w.guest, 'Nadia Rahman');
    const planned = await planMyOwnCase(w.db, w.access);
    if (!isOk(planned) || planned.value.status === 'needs_own_record') throw new Error('plan');
    expect(planned.value).toMatchObject({
      status: 'started',
      destination: 'Japan',
      purpose: 'Tourism',
    });
    const [mission] = await w.db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, planned.value.missionId));
    expect(mission).toMatchObject({
      applicantId: self,
      destination: 'Japan',
      purpose: 'Tourism',
      title: 'Japan - Tourism',
    });
    expect(await ownMissionOf(w.db, w.companionId)).toBe(planned.value.missionId);
    // It is an ordinary case of their own account, and the organiser's account got nothing.
    expect((await missionsOf(w.db, w.guest)).map((m) => m.id)).toEqual([planned.value.missionId]);
    const organiserCases = await missionsOf(w.db, w.org.accountId);
    expect(organiserCases.map((m) => m.id)).not.toContain(planned.value.missionId);
    const found = await myTripCaseId(w.db, w.access);
    expect(isOk(found) && found.value).toBe(planned.value.missionId);
  });

  it(
    'is idempotent: a second try opens the same case, and two at once make one',
    async () => {
      await traveller(w.db, w.guest, 'Nadia Rahman');
      const first = await planMyOwnCase(w.db, w.access);
      const second = await planMyOwnCase(w.db, w.access);
      if (!isOk(first) || !isOk(second)) throw new Error('plan');
      expect(second.value).toMatchObject({ status: 'existing' });
      expect(
        'missionId' in first.value && 'missionId' in second.value && first.value.missionId,
      ).toBe('missionId' in second.value && second.value.missionId);
      expect(await missionsOf(w.db, w.guest)).toHaveLength(1);

      const other = await world();
      await traveller(other.db, other.guest, 'Nadia Rahman');
      const both = await Promise.all([
        planMyOwnCase(other.db, other.access),
        planMyOwnCase(other.db, other.access),
      ]);
      expect(both.every((r) => isOk(r))).toBe(true);
      expect(await missionsOf(other.db, other.guest)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it('starts a new one when the first is gone (purged), and links the new one', async () => {
    await traveller(w.db, w.guest, 'Nadia Rahman');
    const first = await planMyOwnCase(w.db, w.access);
    if (!isOk(first) || first.value.status === 'needs_own_record') throw new Error('plan');
    await w.db
      .update(schema.missions)
      .set({ purgedAt: new Date() })
      .where(eq(schema.missions.id, first.value.missionId));
    const found = await myTripCaseId(w.db, w.access);
    expect(isOk(found) && found.value).toBeNull();
    const again = await planMyOwnCase(w.db, w.access);
    if (!isOk(again) || again.value.status === 'needs_own_record') throw new Error('plan');
    expect(again.value.status).toBe('started');
    expect(again.value.missionId).not.toBe(first.value.missionId);
    expect(await ownMissionOf(w.db, w.companionId)).toBe(again.value.missionId);
  });

  it('needs the account consent, and makes nothing without it', async () => {
    await traveller(w.db, w.guest, 'Nadia Rahman');
    await setConsent(w.db, {
      actorAccountId: w.guest,
      accountId: w.guest,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    const refused = await planMyOwnCase(w.db, w.access);
    expect(isErr(refused) && refused.error.code).toBe('consent_required');
    expect(await missionsOf(w.db, w.guest)).toEqual([]);
    expect(await ownMissionOf(w.db, w.companionId)).toBeNull();
  });

  it('with no record of their own, says so and makes nothing (and never uses a managed family member)', async () => {
    const none = await planMyOwnCase(w.db, w.access);
    expect(isOk(none) && none.value).toEqual({ status: 'needs_own_record' });
    await traveller(w.db, w.guest, 'A Family Member', 'FAMILY_MEMBER');
    const family = await planMyOwnCase(w.db, w.access);
    expect(isOk(family) && family.value).toEqual({ status: 'needs_own_record' });
    expect(await missionsOf(w.db, w.guest)).toEqual([]);
    expect(await ownMissionOf(w.db, w.companionId)).toBeNull();
    // Once they add a record of their own, the same call starts the case on it.
    const self = await traveller(w.db, w.guest, 'Nadia Rahman');
    const planned = await planMyOwnCase(w.db, w.access);
    expect(isOk(planned) && planned.value.status).toBe('started');
    expect((await missionsOf(w.db, w.guest))[0]?.applicantId).toBe(self);
  });

  it('shows the organiser nothing at Name Only, one plain phrase at Plan Status, and never access', async () => {
    const self = await traveller(w.db, w.guest, 'Nadia Rahman');
    const planned = await planMyOwnCase(w.db, w.access);
    if (!isOk(planned) || planned.value.status === 'needs_own_record') throw new Error('plan');
    const missionId = planned.value.missionId;
    // A paper in the companion's own record, which the organiser must never reach either.
    const paper = await document(w.db, w.guest, self, 'hotel_booking', 'Tokyo hotel.pdf');

    const named = (await organiserList(w.db, w.org)).find((p) => p.id === w.companionId);
    expect(named).toMatchObject({ shareLevel: 'NAME_ONLY', planStatus: null });

    await setCompanionShareLevel(w.db, w.access, 'PLAN_STATUS');
    const people = await organiserList(w.db, w.org);
    const shared = people.find((p) => p.id === w.companionId);
    expect(shared).toMatchObject({ shareLevel: 'PLAN_STATUS', planStatus: 'Getting Ready' });
    // Only the one phrase: no id of the case, the person or the paper, and no case wording.
    const text = JSON.stringify(people);
    for (const secret of [missionId, self, paper, w.guest, 'Japan - Tourism', 'Tokyo hotel']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(shared ?? {}).sort()).toEqual([
      'id',
      'name',
      'papers',
      'planStatus',
      'shareLevel',
      'status',
    ]);

    // No access of any kind: the organiser cannot open the case, the person or the paper.
    const principal = accountPrincipal(w.org.accountId);
    for (const resource of [{ missionId }, { applicantId: self }, { documentId: paper }]) {
      const denied = await requireAccess(w.db, principal, 'VIEW_METADATA', resource, {
        purpose: 'owner_trip',
      });
      expect(isErr(denied)).toBe(true);
    }
    // No grant, no sharing row, and nothing new on the organiser's account.
    const grants = await w.db.select({ n: count() }).from(schema.grants);
    expect(Number(grants[0]?.n)).toBe(0);
    // Only the organiser's own case for the trip, made when they started it.
    const organiserCases = await missionsOf(w.db, w.org.accountId);
    expect(organiserCases).toHaveLength(1);
    expect(organiserCases.map((m) => m.id)).not.toContain(missionId);
    const orgApplicants = await w.db
      .select({ n: count() })
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, w.org.accountId));
    expect(Number(orgApplicants[0]?.n)).toBe(1);
    // The organiser's own trip still has only the organiser's own traveller.
    const trip = await w.db
      .select({ n: count() })
      .from(schema.umpeTripTravellers)
      .where(eq(schema.umpeTripTravellers.tripId, w.org.tripId));
    expect(Number(trip[0]?.n)).toBe(1);
  });

  it('shows the phrase of the case as it moves on, and never after the level is lowered', async () => {
    await traveller(w.db, w.guest, 'Nadia Rahman');
    const planned = await planMyOwnCase(w.db, w.access);
    if (!isOk(planned) || planned.value.status === 'needs_own_record') throw new Error('plan');
    await setCompanionShareLevel(w.db, w.access, 'PLAN_STATUS');
    await w.db
      .update(schema.missions)
      .set({ state: 'SUBMISSION_READY' })
      .where(eq(schema.missions.id, planned.value.missionId));
    const ready = (await organiserList(w.db, w.org)).find((p) => p.id === w.companionId);
    expect(ready?.planStatus).toBe('Ready to Share');
    await setCompanionShareLevel(w.db, w.access, 'NAME_ONLY');
    const hidden = (await organiserList(w.db, w.org)).find((p) => p.id === w.companionId);
    expect(hidden?.planStatus).toBeNull();
  });

  it('audits ids only', async () => {
    const self = await traveller(w.db, w.guest, 'Nadia Rahman');
    await planMyOwnCase(w.db, w.access);
    const events = await w.db
      .select()
      .from(schema.auditEvents)
      .where(sql`${schema.auditEvents.eventType} = 'UMPE_TRIP_COMPANION_OWN_CASE_STARTED'`);
    expect(events).toHaveLength(1);
    expect(events[0]?.applicantId).toBe(self);
    expect(events[0]?.actorAccountId).toBe(w.guest);
    expect(Object.keys(events[0]?.metadata ?? {})).toEqual(['tripId']);
    expect(JSON.stringify(events[0])).not.toMatch(/Nadia|Japan|Tourism|example\.com/);
  });

  it('refuses a copied access, a switched-off feature, and a companion who has left', async () => {
    await traveller(w.db, w.guest, 'Nadia Rahman');
    const copy = Object.assign(Object.create(Object.getPrototypeOf(w.access)), w.access);
    expect(isErr(await planMyOwnCase(w.db, copy))).toBe(true);
    expect(isErr(await myTripCaseId(w.db, copy))).toBe(true);
    process.env[SWITCH] = 'false';
    expect(isErr(await planMyOwnCase(w.db, w.access))).toBe(true);
    process.env[SWITCH] = 'true';
    // The access made before they left no longer works: the live row says no.
    expect(isOk(await leaveTrip(w.db, w.access))).toBe(true);
    expect(isErr(await planMyOwnCase(w.db, w.access))).toBe(true);
    expect(isErr(await myTripCaseId(w.db, w.access))).toBe(true);
    expect(await missionsOf(w.db, w.guest)).toEqual([]);
    expect(await joinedCompanionAccess(w.db, w.guest, w.org.tripId)).toBeNull();
  });

  it("another companion's access starts only their own case", async () => {
    await traveller(w.db, w.guest, 'Nadia Rahman');
    const other = await joined(w.db, w.org, 'Omar Khan', 'omar@example.com');
    const omar = await traveller(w.db, other.guest, 'Omar Khan');
    const planned = await planMyOwnCase(w.db, other.access);
    expect(isOk(planned) && planned.value.status).toBe('started');
    expect(await missionsOf(w.db, w.guest)).toEqual([]);
    expect((await missionsOf(w.db, other.guest))[0]?.applicantId).toBe(omar);
    expect(await ownMissionOf(w.db, w.companionId)).toBeNull();
    // The organiser's proof of their own person is untouched.
    expect(await proofFor(w.db, w.org.accountId, w.org.applicantId, 'MANAGE')).toBeDefined();
  });
});
