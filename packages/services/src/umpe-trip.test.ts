/**
 * UMPE P5 (R20, R21): group trips and family packages over each traveller's own case.
 *
 * Synthetic data only. Pins:
 * 1. Two travellers with different nationality on one trip get different checklists.
 * 2. A child's case needs the account holder's recorded guardian authority.
 * 3. An adult traveller outside the account is never added and nothing of theirs changes.
 * 4. Common evidence is not visible to a traveller without their owner's allowance.
 * 5. Removing a traveller keeps their case.
 * 6. Another account's trip looks exactly like a missing one; missing tables refuse plainly.
 */
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { attachPackVersion } from './missions';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { getCasePackage } from './umpe-package-service';
import {
  isCommonTripEvidenceType,
  travellerAuthorityProblem,
  tripNextAction,
} from './umpe-trip-rules';
import {
  addTravellerToTrip,
  addTripEvidence,
  getTrip,
  listTripEvidence,
  listTripEvidenceForTraveller,
  listTrips,
  removeTravellerFromTrip,
  setTripEvidenceAllowance,
  startGroupTrip,
} from './umpe-trip-service';

const TEST_TIMEOUT_MS = 90_000;
const TRIP = { destination: 'Japan', purpose: 'Tourism' } as const;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: created.value.id,
    accountId: created.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  return created.value.id;
}

async function traveller(
  db: Db,
  owner: string,
  displayName: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' | 'MINOR_GUARDIAN' = 'SELF',
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

async function manage(db: Db, actor: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('manage proof');
  return proof.value;
}

async function view(db: Db, actor: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('view proof');
  return proof.value;
}

async function manageDocument(db: Db, actor: string, documentId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'MANAGE',
    { documentId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('document proof');
  return proof.value;
}

async function document(db: Db, actor: string, applicantId: string, docType: string) {
  const doc = await registerDocument(db, {
    actorAccountId: actor,
    applicantId,
    originalName: `${docType}.pdf`,
    docType,
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: actor,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `k-${Math.random().toString(36).slice(2)}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(version)) throw new Error('version');
  return doc.value.id;
}

async function startTrip(db: Db, actor: string, first: string) {
  const started = await startGroupTrip(await manage(db, actor, first), TRIP);
  if (!isOk(started)) throw new Error(`start: ${started.error.message}`);
  return started.value;
}

async function addTraveller(db: Db, actor: string, tripId: string, applicantId: string) {
  const added = await addTravellerToTrip(await manage(db, actor, applicantId), tripId);
  if (!isOk(added)) throw new Error(`add: ${added.error.message}`);
  return added.value;
}

async function missionsOf(db: Db, applicantId: string) {
  return db.select().from(schema.missions).where(eq(schema.missions.applicantId, applicantId));
}

async function publishedPack(db: Db, actor: string, rows: readonly RequirementInput[]) {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: `p5.${Math.random().toString(36).slice(2)}`,
    name: 'P5 Synthetic',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  for (const row of rows) {
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      ...row,
    });
    if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
  }
  const approved = await approvePackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(approved)) throw new Error('approve');
  const published = await publishPackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(published)) throw new Error('publish');
  return version.value.id;
}

describe('UMPE P5 trip rules (pure)', () => {
  it('needs recorded authority for every record but the account holder', () => {
    expect(travellerAuthorityProblem({ relationship: 'SELF', authorityConfirmedAt: null })).toBe(
      null,
    );
    expect(
      travellerAuthorityProblem({ relationship: 'MINOR_GUARDIAN', authorityConfirmedAt: null }),
    ).toBe('GUARDIAN_NOT_CONFIRMED');
    expect(
      travellerAuthorityProblem({ relationship: 'FAMILY_MEMBER', authorityConfirmedAt: null }),
    ).toBe('AUTHORITY_NOT_CONFIRMED');
    expect(
      travellerAuthorityProblem({
        relationship: 'MINOR_GUARDIAN',
        authorityConfirmedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBe(null);
  });

  it('allows only shareable travel documents as common evidence, failing closed', () => {
    expect(isCommonTripEvidenceType('HOTEL_BOOKING')).toBe(true);
    expect(isCommonTripEvidenceType('hotel_booking')).toBe(true);
    expect(isCommonTripEvidenceType('TRAVEL_ITINERARY')).toBe(true);
    expect(isCommonTripEvidenceType('passport')).toBe(false);
    expect(isCommonTripEvidenceType('BANK_STATEMENT')).toBe(false);
    expect(isCommonTripEvidenceType('TRAVEL_INSURANCE')).toBe(false);
    expect(isCommonTripEvidenceType('something unknown')).toBe(false);
    expect(isCommonTripEvidenceType(null)).toBe(false);
  });

  it('picks one next action: a change first, then what unblocks most, then review', () => {
    const base = { phrase: 'NEEDS_ATTENTION', active: true, hasChange: false } as const;
    expect(tripNextAction({ ...base, reasons: ['REQUIRED_GAP', 'NO_CHECKLIST'] })).toBe(
      'CHOOSE_CHECKLIST',
    );
    expect(tripNextAction({ ...base, reasons: ['REQUIRED_GAP', 'NEEDS_ANSWER'] })).toBe(
      'ANSWER_QUESTIONS',
    );
    expect(tripNextAction({ ...base, hasChange: true, reasons: ['REQUIRED_GAP'] })).toBe(
      'REVIEW_CHANGE',
    );
    expect(tripNextAction({ ...base, phrase: 'READY_FOR_FINAL_REVIEW', reasons: [] })).toBe(
      'FINAL_REVIEW',
    );
    expect(tripNextAction({ ...base, phrase: 'PREPARED_FOR_HANDOFF', reasons: [] })).toBe(
      'SHARE_WHEN_READY',
    );
    expect(tripNextAction({ ...base, active: false, reasons: ['REQUIRED_GAP'] })).toBe('VIEW_CASE');
  });
});

describe('UMPE P5 group trips (database)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  }, TEST_TIMEOUT_MS);

  it(
    'gives two travellers with different nationality their own, different checklists',
    async () => {
      const owner = await account(db, 'p5-nationality@example.com');
      const anna = await traveller(db, owner, 'Synthetic Anna');
      const ben = await traveller(db, owner, 'Synthetic Ben', 'FAMILY_MEMBER');
      await registerFieldDefinition(db, { key: 'nationality', dataType: 'string' });
      for (const [applicantId, value] of [
        [anna, 'BD'],
        [ben, 'SG'],
      ] as const) {
        const fact = await editFact(db, {
          actorAccountId: owner,
          applicantId,
          fieldKey: 'nationality',
          value,
        });
        expect(isOk(fact)).toBe(true);
      }
      const versionId = await publishedPack(db, owner, [
        { kind: 'DOCUMENT', docType: 'passport', citation: 'Synthetic rule 1' },
        {
          kind: 'DOCUMENT',
          docType: 'employer_letter',
          citation: 'Synthetic rule 2',
          necessity: 'CONDITIONAL',
          condition: { op: 'equals', field: 'nationality', value: 'BD' },
        },
      ]);

      const started = await startTrip(db, owner, anna);
      const added = await addTraveller(db, owner, started.tripId, ben);
      expect(added.missionId).not.toBe(started.missionId);

      const caseItems = async (missionId: string) => {
        const attached = await attachPackVersion(db, {
          actorAccountId: owner,
          missionId,
          packVersionId: versionId,
        });
        expect(isOk(attached)).toBe(true);
        const proof = await requireAccess(
          db,
          accountPrincipal(owner),
          'VIEW_METADATA',
          { missionId },
          { purpose: 'self' },
        );
        if (!isOk(proof)) throw new Error('case proof');
        const pkg = await getCasePackage(proof.value, missionId);
        if (!isOk(pkg)) throw new Error('package');
        return pkg.value.items.filter((i) => i.state !== 'NOT_APPLICABLE').map((i) => i.key);
      };
      const annaItems = await caseItems(started.missionId);
      const benItems = await caseItems(added.missionId);
      expect(annaItems).toContain('employer_letter');
      expect(benItems).not.toContain('employer_letter');
      expect(benItems).toContain('passport');

      // Each traveller keeps their own case; nothing was merged.
      expect((await missionsOf(db, anna)).map((m) => m.id)).toEqual([started.missionId]);
      expect((await missionsOf(db, ben)).map((m) => m.id)).toEqual([added.missionId]);
      const trip = await getTrip(await view(db, owner, anna), started.tripId);
      if (!isOk(trip)) throw new Error('trip');
      expect(trip.value.travellers.map((t) => t.applicantId)).toEqual([anna, ben]);
      // The existing family-trip label keeps working.
      const labels = (await missionsOf(db, ben)).map((m) => m.itineraryRef);
      expect(labels).toEqual([trip.value.itineraryRef]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a child's case until guardian authority is recorded, and creates nothing",
    async () => {
      const owner = await account(db, 'p5-guardian@example.com');
      const parent = await traveller(db, owner, 'Synthetic Parent');
      const started = await startTrip(db, owner, parent);

      // A child record made before authority was recorded (no confirmation on the row).
      const [legacyChild] = await db
        .insert(schema.applicants)
        .values({
          ownerAccountId: owner,
          displayName: 'Synthetic Child',
          relationship: 'MINOR_GUARDIAN',
        })
        .returning({ id: schema.applicants.id });
      if (!legacyChild) throw new Error('child');
      const refused = await addTravellerToTrip(
        await manage(db, owner, legacyChild.id),
        started.tripId,
      );
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      expect(isErr(refused) && refused.error.message).toMatch(/parent or guardian/);
      expect(await missionsOf(db, legacyChild.id)).toEqual([]);
      // Starting a new trip with that child is refused the same way, and leaves no trip behind.
      const before = await db.select().from(schema.umpeTrips);
      const startRefused = await startGroupTrip(await manage(db, owner, legacyChild.id), TRIP);
      expect(isErr(startRefused) && startRefused.error.code).toBe('forbidden');
      expect(await db.select().from(schema.umpeTrips)).toHaveLength(before.length);

      // A child record with the guardian confirmation joins with their own case.
      const child = await traveller(db, owner, 'Synthetic Child Two', 'MINOR_GUARDIAN');
      const joined = await addTraveller(db, owner, started.tripId, child);
      expect((await missionsOf(db, child)).map((m) => m.id)).toEqual([joined.missionId]);
      expect(joined.missionId).not.toBe(started.missionId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'never adds or edits an adult traveller from outside the account',
    async () => {
      const owner = await account(db, 'p5-owner@example.com');
      const outsider = await account(db, 'p5-outsider@example.com');
      const mine = await traveller(db, owner, 'Synthetic Owner');
      const theirs = await traveller(db, outsider, 'Synthetic Outsider');
      const started = await startTrip(db, owner, mine);
      const theirRow = (
        await db.select().from(schema.applicants).where(eq(schema.applicants.id, theirs))
      )[0];

      // The account holder cannot even obtain a managing proof for someone else's record.
      const denied = await requireAccess(
        db,
        accountPrincipal(owner),
        'MANAGE',
        { applicantId: theirs },
        { purpose: 'owner_trip' },
      );
      expect(isOk(denied)).toBe(false);
      // The outsider's own proof cannot reach the account holder's trip: it looks missing.
      const viaOwnProof = await addTravellerToTrip(
        await manage(db, outsider, theirs),
        started.tripId,
      );
      expect(isErr(viaOwnProof) && viaOwnProof.error.code).toBe('not_found');
      // A read-only proof is not a managing proof.
      const readOnly = await addTravellerToTrip(
        (await view(db, owner, mine)) as unknown as Awaited<ReturnType<typeof manage>>,
        started.tripId,
      );
      expect(isErr(readOnly) && readOnly.error.code).toBe('forbidden');

      expect(await missionsOf(db, theirs)).toEqual([]);
      const after = (
        await db.select().from(schema.applicants).where(eq(schema.applicants.id, theirs))
      )[0];
      expect(after).toEqual(theirRow);
      const links = await db
        .select()
        .from(schema.umpeTripTravellers)
        .where(eq(schema.umpeTripTravellers.applicantId, theirs));
      expect(links).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'shows common evidence to a traveller only after their owner allows it',
    async () => {
      const owner = await account(db, 'p5-evidence@example.com');
      const anna = await traveller(db, owner, 'Synthetic Anna');
      const ben = await traveller(db, owner, 'Synthetic Ben', 'FAMILY_MEMBER');
      const cara = await traveller(db, owner, 'Synthetic Cara', 'MINOR_GUARDIAN');
      const started = await startTrip(db, owner, anna);
      await addTraveller(db, owner, started.tripId, ben);
      await addTraveller(db, owner, started.tripId, cara);

      const passport = await document(db, owner, anna, 'passport');
      const refused = await addTripEvidence(
        await manageDocument(db, owner, passport),
        started.tripId,
      );
      expect(isErr(refused) && refused.error.code).toBe('invalid');

      const hotel = await document(db, owner, anna, 'hotel_booking');
      const added = await addTripEvidence(await manageDocument(db, owner, hotel), started.tripId);
      if (!isOk(added)) throw new Error(`evidence: ${added.error.message}`);
      const evidenceId = added.value.evidenceId;

      const seenBy = async (applicantId: string) => {
        const listed = await listTripEvidenceForTraveller(
          await view(db, owner, applicantId),
          started.tripId,
        );
        if (!isOk(listed)) throw new Error('list');
        return listed.value.map((e) => e.id);
      };
      // Nobody but its own traveller sees it before an allowance.
      expect(await seenBy(anna)).toEqual([evidenceId]);
      expect(await seenBy(ben)).toEqual([]);
      expect(await seenBy(cara)).toEqual([]);

      const allowed = await setTripEvidenceAllowance(
        await manage(db, owner, ben),
        started.tripId,
        evidenceId,
        true,
      );
      expect(isOk(allowed) && allowed.value.changed).toBe(true);
      expect(await seenBy(ben)).toEqual([evidenceId]);
      expect(await seenBy(cara)).toEqual([]);

      const all = await listTripEvidence(await view(db, owner, anna), started.tripId);
      if (!isOk(all)) throw new Error('all');
      expect(all.value.map((e) => [e.id, e.allowedFor])).toEqual([[evidenceId, [ben]]]);
      // It is a reference: still one document, owned by its traveller, nothing copied.
      const docs = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.docType, 'hotel_booking'));
      expect(docs.map((d) => d.applicantId)).toEqual([anna]);

      const revoked = await setTripEvidenceAllowance(
        await manage(db, owner, ben),
        started.tripId,
        evidenceId,
        false,
      );
      expect(isOk(revoked) && revoked.value.changed).toBe(true);
      expect(await seenBy(ben)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps the case of a traveller removed from the trip and ends their allowances',
    async () => {
      const owner = await account(db, 'p5-remove@example.com');
      const anna = await traveller(db, owner, 'Synthetic Anna');
      const ben = await traveller(db, owner, 'Synthetic Ben', 'FAMILY_MEMBER');
      const started = await startTrip(db, owner, anna);
      const benCase = await addTraveller(db, owner, started.tripId, ben);
      const hotel = await document(db, owner, anna, 'hotel_booking');
      const added = await addTripEvidence(await manageDocument(db, owner, hotel), started.tripId);
      if (!isOk(added)) throw new Error('evidence');
      await setTripEvidenceAllowance(
        await manage(db, owner, ben),
        started.tripId,
        added.value.evidenceId,
        true,
      );
      const before = (await missionsOf(db, ben))[0];

      const removed = await removeTravellerFromTrip(await manage(db, owner, ben), started.tripId);
      expect(isOk(removed) && removed.value.removed).toBe(true);

      const after = await missionsOf(db, ben);
      expect(after.map((m) => [m.id, m.state, m.title, m.purgedAt])).toEqual([
        [benCase.missionId, before?.state, before?.title, null],
      ]);
      const trip = await getTrip(await view(db, owner, anna), started.tripId);
      if (!isOk(trip)) throw new Error('trip');
      expect(trip.value.travellers.map((t) => t.applicantId)).toEqual([anna]);
      const live = await db
        .select()
        .from(schema.umpeTripEvidenceAllowances)
        .where(
          and(
            eq(schema.umpeTripEvidenceAllowances.applicantId, ben),
            sql`${schema.umpeTripEvidenceAllowances.revokedAt} is null`,
          ),
        );
      expect(live).toEqual([]);
      // Removing again changes nothing; adding again opens the same kept case.
      const again = await removeTravellerFromTrip(await manage(db, owner, ben), started.tripId);
      expect(isOk(again) && again.value.removed).toBe(false);
      const back = await addTraveller(db, owner, started.tripId, ben);
      expect(back.missionId).toBe(benCase.missionId);
      expect(back.existingCase).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "makes another account's trip look missing and lists only the account's own trips",
    async () => {
      const owner = await account(db, 'p5-a@example.com');
      const other = await account(db, 'p5-b@example.com');
      const mine = await traveller(db, owner, 'Synthetic A');
      const theirs = await traveller(db, other, 'Synthetic B');
      const started = await startTrip(db, owner, mine);

      const foreign = await getTrip(await view(db, other, theirs), started.tripId);
      const unknown = await getTrip(
        await view(db, other, theirs),
        '00000000-0000-4000-8000-000000000000',
      );
      expect(isErr(foreign) && foreign.error).toEqual(isErr(unknown) && unknown.error);
      const evidence = await listTripEvidence(await view(db, other, theirs), started.tripId);
      expect(isErr(evidence) && evidence.error.code).toBe('not_found');

      const ownList = await listTrips(await view(db, owner, mine));
      const otherList = await listTrips(await view(db, other, theirs));
      expect(isOk(ownList) && ownList.value.map((t) => [t.id, t.travellerCount])).toEqual([
        [started.tripId, 1],
      ]);
      expect(isOk(otherList) && otherList.value).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'answers "no trips" and refuses plainly while the tables are missing',
    async () => {
      const owner = await account(db, 'p5-missing@example.com');
      const mine = await traveller(db, owner, 'Synthetic Missing');
      await db.execute(
        sql`drop table umpe_trip_evidence_allowances, umpe_trip_evidence, umpe_trip_travellers, umpe_trips`,
      );
      const listed = await listTrips(await view(db, owner, mine));
      expect(isOk(listed) && listed.value).toEqual([]);
      const started = await startGroupTrip(await manage(db, owner, mine), TRIP);
      expect(isErr(started) && started.error.message).toMatch(/not switched on/);
      expect(await missionsOf(db, mine)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
