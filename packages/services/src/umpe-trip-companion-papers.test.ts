/**
 * UMPE UX6, package 4: Travel Bookings, the papers a companion chose to show the organiser by name.
 *
 * Synthetic data only. Pins:
 * 1. A companion chooses only THEIR OWN record's common travel papers (bookings, itineraries,
 *    invitations, accommodation): never a passport or a bank paper, never another person's paper,
 *    never a managed family member's, and only with their own owner proof of that one paper.
 * 2. The organiser sees the NAME and KIND of each chosen paper and nothing else (no id, no file),
 *    and only while the companion's level is Travel Bookings and they are still joined.
 * 3. Lowering the level, removing a paper, leaving or being removed takes the paper off the
 *    organiser's next read; a retyped, archived or deleted paper drops out too.
 * 4. The table can be missing (the migration runs after this code ships): the level then shows
 *    nothing extra, the choice list is empty, and everything else keeps working.
 */
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { joinedCompanionAccess } from './access/trip-companion-access';
import type { Db } from './db';
import {
  COMPANION_PAPERS_MAX,
  chooseTripPaper,
  listMyTripPapers,
  organiserPaperNames,
  removeTripPaper,
} from './umpe-trip-companion-papers';
import { leaveTrip, removeCompanion, setCompanionShareLevel } from './umpe-trip-companions';
import { TRIP_COMPANIONS_SWITCH } from './umpe-trip-companions-switch';
import {
  type Organiser,
  account,
  document,
  documentProof,
  freshDb,
  joined,
  organiser,
  organiserList,
  proofFor,
  traveller,
} from './umpe-trip-companions.test-support';

const TEST_TIMEOUT_MS = 90_000;
const SWITCH = TRIP_COMPANIONS_SWITCH;
const NO_SUCH = '00000000-0000-4000-8000-000000000000';

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
  readonly own: string;
  readonly hotel: string;
  readonly ticket: string;
}

/** An organiser, and a companion who joined at `level` and has a record of their own with two papers. */
async function world(level = 'TRAVEL_BOOKINGS'): Promise<World> {
  const db = await freshDb();
  const org = await organiser(db);
  const made = await joined(db, org, 'Nadia Rahman', 'nadia@example.com', level);
  const own = await traveller(db, made.guest, 'Nadia Rahman');
  const hotel = await document(db, made.guest, own, 'hotel_booking', 'Tokyo hotel.pdf');
  const ticket = await document(db, made.guest, own, 'FLIGHT_TICKET', 'Flight to Tokyo.pdf');
  return {
    db,
    org,
    guest: made.guest,
    access: made.access,
    companionId: made.companionId,
    own,
    hotel,
    ticket,
  };
}

async function choose(w: World, documentId: string, actor = w.guest) {
  const proof = await documentProof(w.db, actor, documentId);
  if (!proof) throw new Error('no proof for that paper');
  return chooseTripPaper(w.db, w.access, proof);
}

async function papersRows(db: Db) {
  return db.select().from(schema.umpeTripCompanionPapers);
}

describe('UMPE UX6 package 4: choosing papers (the companion)', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TEST_TIMEOUT_MS);

  it('offers only their own common travel papers, and nothing of anyone else', async () => {
    // Papers that must never be offered: a passport and a bank paper of their own record, a
    // managed family member's booking, and the organiser's own booking.
    await document(w.db, w.guest, w.own, 'passport');
    await document(w.db, w.guest, w.own, 'bank_statement');
    const child = await traveller(w.db, w.guest, 'A Family Member', 'FAMILY_MEMBER');
    await document(w.db, w.guest, child, 'hotel_booking', 'Family hotel.pdf');
    await document(
      w.db,
      w.org.accountId,
      w.org.applicantId,
      'hotel_booking',
      'Organiser hotel.pdf',
    );
    const listed = await listMyTripPapers(w.db, w.access);
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.available).toBe(true);
    expect(listed.value.chosen).toEqual([]);
    expect(listed.value.options.map((o) => o.name).sort()).toEqual([
      'Flight to Tokyo.pdf',
      'Tokyo hotel.pdf',
    ]);
    expect(listed.value.options.map((o) => o.kind).sort()).toEqual([
      'Flight Ticket',
      'Hotel or Stay Booking',
    ]);
  });

  it('chooses a paper by name, once: choosing it again changes nothing', async () => {
    const first = await choose(w, w.hotel);
    expect(isOk(first) && first.value.added).toBe(true);
    const again = await choose(w, w.hotel);
    expect(isOk(again) && again.value.added).toBe(false);
    expect(await papersRows(w.db)).toHaveLength(1);
    const listed = await listMyTripPapers(w.db, w.access);
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.chosen.map((c) => c.name)).toEqual(['Tokyo hotel.pdf']);
    expect(listed.value.options.map((c) => c.name)).toEqual(['Flight to Tokyo.pdf']);
  });

  it('refuses a passport or a bank paper (common travel kinds only), and writes nothing', async () => {
    for (const kind of ['passport', 'bank_statement', 'medical_certificate', 'mystery_kind']) {
      const id = await document(w.db, w.guest, w.own, kind);
      const refused = await choose(w, id);
      expect(isErr(refused), kind).toBe(true);
    }
    expect(await papersRows(w.db)).toEqual([]);
  });

  it("refuses another person's paper, a managed family member's paper, and a copied proof", async () => {
    const orgDoc = await document(w.db, w.org.accountId, w.org.applicantId, 'hotel_booking');
    // The companion cannot even form a proof of the organiser's paper.
    expect(await documentProof(w.db, w.guest, orgDoc)).toBeNull();
    // The organiser's own proof of their own paper is not the companion's: the account differs.
    const theirs = await documentProof(w.db, w.org.accountId, orgDoc);
    if (!theirs) throw new Error('proof');
    const wrongAccount = await chooseTripPaper(w.db, w.access, theirs);
    expect(isErr(wrongAccount) && wrongAccount.error.code).toBe('not_found');
    // A managed family member's paper: the companion's own account, but not their own record.
    const child = await traveller(w.db, w.guest, 'A Family Member', 'FAMILY_MEMBER');
    const childDoc = await document(w.db, w.guest, child, 'hotel_booking', 'Family hotel.pdf');
    const family = await documentProof(w.db, w.guest, childDoc);
    if (!family) throw new Error('proof');
    const refused = await chooseTripPaper(w.db, w.access, family);
    expect(isErr(refused) && refused.error.code).toBe('not_found');
    // A copy of a genuine proof is not a proof.
    const real = await documentProof(w.db, w.guest, w.hotel);
    if (!real) throw new Error('proof');
    const copy = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
    expect(isErr(await chooseTripPaper(w.db, w.access, copy))).toBe(true);
    // A proof of a person (not a paper) is not a paper either.
    const person = await proofFor(w.db, w.guest, w.own, 'VIEW_METADATA');
    expect(isErr(await chooseTripPaper(w.db, w.access, person))).toBe(true);
    expect(await papersRows(w.db)).toEqual([]);
  });

  it('needs the Travel Bookings level first', async () => {
    for (const level of ['NAME_ONLY', 'PLAN_STATUS']) {
      const low = await world(level);
      const refused = await choose(low, low.hotel);
      expect(isErr(refused) && refused.error.message, level).toBe('Choose Travel Bookings first.');
      expect(await papersRows(low.db)).toEqual([]);
    }
  });

  it('a paper that is archived or in Recently Deleted is not offered, and cannot be chosen', async () => {
    const lonely = await document(w.db, w.guest, w.own, 'FLIGHT_BOOKING');
    await w.db.execute(
      sql`insert into document_lifecycle (document_id, applicant_id, archived_at) values (${lonely}, ${w.own}, now())`,
    );
    const listed = await listMyTripPapers(w.db, w.access);
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.options.map((o) => o.kind)).not.toContain('Flight Booking');
    await w.db.execute(
      sql`update document_lifecycle set archived_at = null, deleted_at = now(), delete_path = 'REQUEST', purge_after = now() + interval '30 days' where document_id = ${lonely}`,
    );
    // Access to a deleted paper may be denied outright, or granted and then refused by the choice.
    const proof = await documentProof(w.db, w.guest, lonely);
    if (proof) expect(isErr(await chooseTripPaper(w.db, w.access, proof))).toBe(true);
    expect(await papersRows(w.db)).toEqual([]);
  });

  it(
    `shows at most ${COMPANION_PAPERS_MAX} papers`,
    async () => {
      for (let i = 0; i < COMPANION_PAPERS_MAX; i += 1) {
        const id = await document(w.db, w.guest, w.own, 'hotel_booking', `Stay ${i}.pdf`);
        expect(isOk(await choose(w, id))).toBe(true);
      }
      const extra = await document(w.db, w.guest, w.own, 'hotel_booking', 'One too many.pdf');
      const refused = await choose(w, extra);
      expect(isErr(refused) && refused.error.message).toMatch(/up to 20/);
      expect(await papersRows(w.db)).toHaveLength(COMPANION_PAPERS_MAX);
    },
    TEST_TIMEOUT_MS,
  );

  it('removes a choice; a paper that was never chosen, or a made-up id, changes nothing', async () => {
    await choose(w, w.hotel);
    expect(isOk(await removeTripPaper(w.db, w.access, w.ticket))).toBe(true);
    expect(await papersRows(w.db)).toHaveLength(1);
    expect(isOk(await removeTripPaper(w.db, w.access, 'not-an-id'))).toBe(true);
    const gone = await removeTripPaper(w.db, w.access, w.hotel);
    expect(isOk(gone) && gone.value.removed).toBe(true);
    expect(await papersRows(w.db)).toEqual([]);
    // The paper itself is untouched.
    const kept = await w.db.select().from(schema.documents).where(eq(schema.documents.id, w.hotel));
    expect(kept).toHaveLength(1);
  });

  it("cannot remove another companion's choice", async () => {
    await choose(w, w.hotel);
    const other = await joined(w.db, w.org, 'Omar', 'omar@example.com', 'TRAVEL_BOOKINGS');
    const result = await removeTripPaper(w.db, other.access, w.hotel);
    expect(isOk(result) && result.value.removed).toBe(false);
    expect(await papersRows(w.db)).toHaveLength(1);
  });

  it('audits ids only, never a name', async () => {
    await choose(w, w.hotel);
    await removeTripPaper(w.db, w.access, w.hotel);
    const events = await w.db
      .select()
      .from(schema.auditEvents)
      .where(sql`${schema.auditEvents.eventType} like 'UMPE_TRIP_COMPANION_PAPER_%'`);
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'UMPE_TRIP_COMPANION_PAPER_CHOSEN',
      'UMPE_TRIP_COMPANION_PAPER_REMOVED',
    ]);
    for (const event of events) {
      expect(Object.keys(event.metadata ?? {}).sort()).toEqual(['documentId', 'tripId']);
      expect(JSON.stringify(event)).not.toMatch(/Tokyo|hotel\.pdf|nadia/i);
    }
  });

  it('refuses a stale, copied or switched-off access in every function', async () => {
    const real = await documentProof(w.db, w.guest, w.hotel);
    if (!real) throw new Error('proof');
    const copy = Object.assign(Object.create(Object.getPrototypeOf(w.access)), w.access);
    expect(isErr(await listMyTripPapers(w.db, copy))).toBe(true);
    expect(isErr(await chooseTripPaper(w.db, copy, real))).toBe(true);
    expect(isErr(await removeTripPaper(w.db, copy, w.hotel))).toBe(true);
    // Left the trip: the access made before still looks fine, but the live row says no.
    expect(isOk(await leaveTrip(w.db, w.access))).toBe(true);
    expect(isErr(await chooseTripPaper(w.db, w.access, real))).toBe(true);
    expect(isErr(await listMyTripPapers(w.db, w.access))).toBe(true);
    expect(isErr(await removeTripPaper(w.db, w.access, w.hotel))).toBe(true);
    expect(await papersRows(w.db)).toEqual([]);
    process.env[SWITCH] = 'false';
    expect(isErr(await listMyTripPapers(w.db, w.access))).toBe(true);
  });
});

describe('UMPE UX6 package 4: what the organiser sees', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TEST_TIMEOUT_MS);

  const names = async () => {
    const people = await organiserList(w.db, w.org);
    return people.find((p) => p.id === w.companionId)?.papers ?? [];
  };

  it('sees the name and kind of a chosen paper and nothing more', async () => {
    await choose(w, w.hotel);
    await choose(w, w.ticket);
    const papers = await names();
    expect(papers).toEqual([
      { name: 'Tokyo hotel.pdf', kind: 'Hotel or Stay Booking' },
      { name: 'Flight to Tokyo.pdf', kind: 'Flight Ticket' },
    ]);
    for (const paper of papers) expect(Object.keys(paper).sort()).toEqual(['kind', 'name']);
    // No id of any paper, document or companion's account anywhere in the organiser's view.
    const text = JSON.stringify(await organiserList(w.db, w.org));
    for (const secret of [w.hotel, w.ticket, w.guest, w.own, 'nadia@example.com']) {
      expect(text).not.toContain(secret);
    }
  });

  it('sees nothing extra below Travel Bookings, even if a choice is still stored', async () => {
    await choose(w, w.hotel);
    // Lowering through the service withdraws the choice itself...
    await setCompanionShareLevel(w.db, w.access, 'PLAN_STATUS');
    expect(await papersRows(w.db)).toEqual([]);
    expect(await names()).toEqual([]);
    // ...and going back up never brings it back.
    await setCompanionShareLevel(w.db, w.access, 'TRAVEL_BOOKINGS');
    expect(await names()).toEqual([]);
    // The read gate itself, with a stale choice put back straight into the table and the level
    // lowered underneath it.
    await w.db
      .insert(schema.umpeTripCompanionPapers)
      .values({ companionId: w.companionId, documentId: w.hotel });
    expect((await names()).map((p) => p.name)).toEqual(['Tokyo hotel.pdf']);
    await w.db
      .update(schema.umpeTripCompanions)
      .set({ shareLevel: 'PLAN_STATUS' })
      .where(eq(schema.umpeTripCompanions.id, w.companionId));
    expect(await names()).toEqual([]);
    const proof = await proofFor(w.db, w.org.accountId, w.org.applicantId, 'VIEW_METADATA');
    expect((await organiserPaperNames(proof, w.org.tripId)).size).toBe(0);
  });

  it('a removed paper is gone on the next read', async () => {
    await choose(w, w.hotel);
    await choose(w, w.ticket);
    await removeTripPaper(w.db, w.access, w.hotel);
    expect((await names()).map((p) => p.name)).toEqual(['Flight to Tokyo.pdf']);
  });

  it('leaving or being removed takes the choices away', async () => {
    await choose(w, w.hotel);
    await leaveTrip(w.db, w.access);
    expect(await papersRows(w.db)).toEqual([]);
    expect(await names()).toEqual([]);
    const again = await world();
    await choose(again, again.hotel);
    const removed = await removeCompanion(
      await proofFor(again.db, again.org.accountId, again.org.applicantId, 'MANAGE'),
      again.org.tripId,
      again.companionId,
    );
    expect(isOk(removed)).toBe(true);
    expect(await papersRows(again.db)).toEqual([]);
  });

  it('a retyped, deleted or archived paper drops out of the organiser view', async () => {
    await choose(w, w.hotel);
    await choose(w, w.ticket);
    // Retyped into a passport: never shown, whatever was chosen before.
    await w.db
      .update(schema.documents)
      .set({ docType: 'passport' })
      .where(eq(schema.documents.id, w.hotel));
    expect((await names()).map((p) => p.name)).toEqual(['Flight to Tokyo.pdf']);
    // Sent to Recently Deleted.
    await w.db.execute(
      sql`insert into document_lifecycle (document_id, applicant_id, deleted_at, delete_path, purge_after) values (${w.ticket}, ${w.own}, now(), 'REQUEST', now() + interval '30 days')`,
    );
    expect(await names()).toEqual([]);
    // The companion's own list leaves the retyped paper out as well.
    const listed = await listMyTripPapers(w.db, w.access);
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.chosen).toEqual([]);
  });

  it('deleting the paper removes the choice with it', async () => {
    await choose(w, w.hotel);
    await w.db.delete(schema.documents).where(eq(schema.documents.id, w.hotel));
    expect(await papersRows(w.db)).toEqual([]);
    expect(await names()).toEqual([]);
  });

  it("another organiser's proof, or another trip, sees nothing", async () => {
    await choose(w, w.hotel);
    const stranger = await organiser(w.db, 'stranger@example.com');
    const proof = await proofFor(w.db, stranger.accountId, stranger.applicantId, 'VIEW_METADATA');
    expect((await organiserPaperNames(proof, w.org.tripId)).size).toBe(0);
    const mine = await proofFor(w.db, w.org.accountId, w.org.applicantId, 'VIEW_METADATA');
    expect((await organiserPaperNames(mine, stranger.tripId)).size).toBe(0);
    expect((await organiserPaperNames(mine, 'not-an-id')).size).toBe(0);
  });

  it("another companion's choices are theirs alone", async () => {
    await choose(w, w.hotel);
    const other = await joined(w.db, w.org, 'Omar Khan', 'omar@example.com', 'TRAVEL_BOOKINGS');
    const people = await organiserList(w.db, w.org);
    expect(people.find((p) => p.id === other.companionId)?.papers).toEqual([]);
    expect(people.find((p) => p.id === w.companionId)?.papers).toHaveLength(1);
  });

  it('the organiser can never choose papers for a companion', async () => {
    // A document proof of the organiser's own paper is the best they can form, and it is refused.
    const mine = await document(w.db, w.org.accountId, w.org.applicantId, 'hotel_booking');
    const proof = await documentProof(w.db, w.org.accountId, mine);
    if (!proof) throw new Error('proof');
    expect(isErr(await chooseTripPaper(w.db, w.access, proof))).toBe(true);
    const direct = await requireAccess(
      w.db,
      accountPrincipal(w.org.accountId),
      'VIEW_METADATA',
      { documentId: w.hotel },
      { purpose: 'owner_trip' },
    );
    expect(isErr(direct)).toBe(true);
    expect(await papersRows(w.db)).toEqual([]);
  });
});

describe('UMPE UX6 package 4: the papers table is missing', () => {
  it(
    'Travel Bookings behaves as before, the choice list is empty, and nothing else breaks',
    async () => {
      const w = await world();
      await w.db.execute(sql`drop table umpe_trip_companion_papers`);
      const listed = await listMyTripPapers(w.db, w.access);
      expect(isOk(listed) && listed.value).toEqual({ available: false, chosen: [], options: [] });
      const refused = await choose(w, w.hotel);
      expect(isErr(refused) && refused.error.message).toMatch(/not switched on/);
      expect(isOk(await removeTripPaper(w.db, w.access, w.hotel))).toBe(true);
      const people = await organiserList(w.db, w.org);
      expect(people.find((p) => p.id === w.companionId)).toMatchObject({
        status: 'JOINED',
        shareLevel: 'TRAVEL_BOOKINGS',
        papers: [],
      });
      // Every writer that withdraws papers still works without the table.
      expect(isOk(await setCompanionShareLevel(w.db, w.access, 'NAME_ONLY'))).toBe(true);
      expect(isOk(await leaveTrip(w.db, w.access))).toBe(true);
      const again = await world();
      await again.db.execute(sql`drop table umpe_trip_companion_papers`);
      const removed = await removeCompanion(
        await proofFor(again.db, again.org.accountId, again.org.applicantId, 'MANAGE'),
        again.org.tripId,
        again.companionId,
      );
      expect(isOk(removed)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it('the companion still reads their access when nothing else is missing', async () => {
    const w = await world();
    expect(await joinedCompanionAccess(w.db, w.guest, w.org.tripId)).not.toBeNull();
    // Unknown id and never-joined account: no access to ask with.
    expect(await joinedCompanionAccess(w.db, NO_SUCH, w.org.tripId)).toBeNull();
    expect(
      await joinedCompanionAccess(w.db, await account(w.db, 'nobody@example.com'), w.org.tripId),
    ).toBeNull();
  });
});
