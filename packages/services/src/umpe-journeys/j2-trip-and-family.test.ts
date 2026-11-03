/**
 * Journey J2 (trip and family), services layer, on a real migrated in-memory database.
 *
 * Covered: country, purpose, the traveller's confirmed residence and the travel dates pick the
 * correct published checklist version (the newest one, never an older one, never one for another
 * purpose or residence, never linked on its own when a date or the residence is not known); three
 * authorized people on one trip each get their own case and their own requirement set; an any-of
 * group is met by either alternative; each case pins exact versions of that person's own
 * documents; a shared booking is visible to another traveller only after an explicit allowance;
 * recommended evidence never blocks; a conditional item whose fact is missing stays Unverified,
 * never Not Applicable and never green; Exclude is refused on a blocking item and a required item
 * left missing stays visible after other exclusions. Negatives: an adult from another account and
 * a child without recorded guardian confirmation cannot be added.
 *
 * Not exercisable below the browser (reported, not faked): real sign-in, the trip and case
 * screens, and the live deployment. Checklist authoring here uses a synthetic platform owner.
 *
 * Synthetic people and documents only.
 */
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { staffPrincipal } from '../access/principal';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { addDocumentVersion, registerDocument } from '../documents';
import { attachPackVersion, computeReadiness } from '../missions';
import {
  type PackMatchTerms,
  findMatchingPublicPack,
  listFittingPublicPacks,
  readTravellerCoverage,
} from '../pack-matching';
import { setPackRouteConditions } from '../pack-rule-details';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../packs';
import { grantPlatformRole } from '../platform-roles';
import { editFact, registerFieldDefinition } from '../profile';
import {
  getCasePackage,
  markPackageChangeReviewed,
  recordPackageChoice,
} from '../umpe-package-service';
import {
  addTravellerToTrip,
  addTripEvidence,
  listTripEvidenceForTraveller,
  setTripEvidenceAllowance,
  startGroupTrip,
} from '../umpe-trip-service';

const TIMEOUT = 120_000;
const OWNER_EMAIL = 'j2-owner@example.invalid';
const TRIP = { destination: 'United Kingdom', purpose: 'Tourism' } as const;
const UK = ['GB', 'United Kingdom', 'UK'];

const REQUIREMENTS: readonly RequirementInput[] = [
  { kind: 'DOCUMENT', docType: 'passport', citation: 'Synthetic rule 1', necessity: 'MANDATORY' },
  {
    kind: 'DOCUMENT',
    docType: 'bank_statement',
    citation: 'Synthetic rule 2',
    necessity: 'MANDATORY',
    groupKey: 'funds',
    groupMode: 'ANY_OF',
  },
  {
    kind: 'DOCUMENT',
    docType: 'sponsor_letter',
    citation: 'Synthetic rule 3',
    necessity: 'MANDATORY',
    groupKey: 'funds',
    groupMode: 'ANY_OF',
  },
  {
    kind: 'DOCUMENT',
    docType: 'employer_letter',
    citation: 'Synthetic rule 4',
    necessity: 'CONDITIONAL',
    condition: { op: 'equals', field: 'nationality', value: 'BD' },
  },
  {
    kind: 'DOCUMENT',
    docType: 'hotel_booking',
    citation: 'Synthetic rule 5',
    necessity: 'RECOMMENDED',
  },
];

describe('J2 trip and family', () => {
  let db: Db;
  let owner: string;
  let anna: string;
  let ben: string;
  let cara: string;
  let outsider: string;
  let outsidersAdult: string;
  let mainPackId: string;
  let v1: string;
  let v2: string;
  let tripId: string;
  const missionOf = new Map<string, string>();
  const docsOf = new Map<string, Map<string, string>>();
  let hotelEvidenceId: string;

  async function proof(applicantId: string, action: 'MANAGE' | 'VIEW_METADATA' = 'MANAGE') {
    const p = await requireAccess(
      db,
      accountPrincipal(owner),
      action,
      { applicantId },
      { purpose: 'owner_trip' },
    );
    if (!isOk(p)) throw new Error('proof');
    return p.value as never;
  }
  async function caseProof(missionId: string, action: 'MANAGE' | 'VIEW_METADATA') {
    const p = await requireAccess(
      db,
      accountPrincipal(owner),
      action,
      { missionId },
      { purpose: 'self' },
    );
    if (!isOk(p)) throw new Error('case proof');
    return p.value as never;
  }
  async function person(
    accountId: string,
    displayName: string,
    relationship: 'SELF' | 'FAMILY_MEMBER' | 'MINOR_GUARDIAN',
  ) {
    const created = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName,
      relationship,
      authorityConfirmed: relationship !== 'SELF',
    });
    if (!isOk(created)) throw new Error(`applicant: ${created.error.message}`);
    return created.value.id;
  }
  async function confirmed(applicantId: string, fieldKey: string, value: string) {
    const saved = await editFact(db, {
      actorAccountId: owner,
      applicantId,
      fieldKey,
      value,
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
    });
    if (!isOk(saved)) throw new Error(`fact ${fieldKey}`);
  }
  async function document(applicantId: string, docType: string) {
    const doc = await registerDocument(db, {
      actorAccountId: owner,
      applicantId,
      originalName: `${docType}.pdf`,
      docType,
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: owner,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `j2-${applicantId}-${docType}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    const mine = docsOf.get(applicantId) ?? new Map<string, string>();
    mine.set(docType, doc.value.id);
    docsOf.set(applicantId, mine);
    return doc.value.id;
  }
  /** A public authoritative pack; published with the author-reviewer rule lifted for one account. */
  async function publicPack(
    name: string,
    extra: { purpose?: string; residence?: readonly string[] } = {},
  ) {
    const pack = await createPack(db, {
      actorAccountId: owner,
      key: `j2.${name.toLowerCase().replace(/\W+/g, '.')}`,
      name,
      jurisdiction: 'UK',
      purpose: extra.purpose ?? 'Tourism',
      ...(extra.residence ? { residenceApplicability: extra.residence } : {}),
    });
    if (!isOk(pack)) throw new Error(`pack: ${pack.error.message}`);
    return pack.value.id;
  }
  async function draft(packId: string, rows: readonly RequirementInput[]) {
    const version = await addPackVersion(db, { actorAccountId: owner, packId });
    if (!isOk(version)) throw new Error('version');
    for (const row of rows) {
      const added = await addRequirement(db, {
        actorAccountId: owner,
        packVersionId: version.value.id,
        ...row,
      });
      if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
    }
    return version.value.id;
  }
  async function publish(packId: string, versionId: string) {
    await db.update(schema.packs).set({ authoritative: false }).where(eq(schema.packs.id, packId));
    const approved = await approvePackVersion(db, { actorAccountId: owner, packVersionId: versionId });
    if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
    const published = await publishPackVersion(db, {
      actorAccountId: owner,
      packVersionId: versionId,
    });
    if (!isOk(published)) throw new Error(`publish: ${published.error.message}`);
    await db.update(schema.packs).set({ authoritative: true }).where(eq(schema.packs.id, packId));
  }
  async function termsFor(applicantId: string, travelStart?: Date): Promise<PackMatchTerms> {
    const coverage = await readTravellerCoverage(await proof(applicantId));
    return {
      country: UK,
      purpose: ['Tourism'],
      traveller: {
        nationality: { terms: coverage.nationality, known: coverage.nationality.length > 0 },
        residence: { terms: coverage.residence, known: coverage.residence.length > 0 },
      },
      ...(travelStart ? { travelStart } : {}),
    };
  }
  async function pkg(applicantId: string) {
    const missionId = missionOf.get(applicantId) ?? '';
    const result = await getCasePackage(await caseProof(missionId, 'VIEW_METADATA'), missionId);
    if (!isOk(result)) throw new Error(`package: ${result.error.message}`);
    return result.value;
  }
  async function readiness(applicantId: string) {
    const result = await computeReadiness(db, missionOf.get(applicantId) ?? '');
    if (!isOk(result)) throw new Error('readiness');
    return result.value;
  }
  const item = async (applicantId: string, key: string) => {
    const found = (await pkg(applicantId)).items.find((i) => i.key === key);
    if (!found) throw new Error(`no item ${key}`);
    return found;
  };

  beforeAll(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const account = await provisionAccount(db, { email: OWNER_EMAIL });
    if (!isOk(account)) throw new Error('provision');
    owner = account.value.id;
    const granted = await grantPlatformRole(db, {
      actor: { accountId: owner, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
      targetAccountId: owner,
      role: 'PLATFORM_OWNER',
      reason: 'synthetic seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    await setConsent(db, {
      actorAccountId: owner,
      accountId: owner,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await registerFieldDefinition(db, { key: 'nationality', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'country_of_residence', dataType: 'string' });
    anna = await person(owner, 'Synthetic Anna', 'SELF');
    ben = await person(owner, 'Synthetic Ben', 'FAMILY_MEMBER');
    cara = await person(owner, 'Synthetic Cara', 'MINOR_GUARDIAN');
    await confirmed(anna, 'nationality', 'BD');
    await confirmed(anna, 'country_of_residence', 'BD');
    await confirmed(ben, 'nationality', 'SG');
    await confirmed(ben, 'country_of_residence', 'BD');
    // Cara's nationality and residence are not recorded yet.

    const outsiderAccount = await provisionAccount(db, { email: 'j2-outsider@example.invalid' });
    if (!isOk(outsiderAccount)) throw new Error('provision outsider');
    outsider = outsiderAccount.value.id;
    await setConsent(db, {
      actorAccountId: outsider,
      accountId: outsider,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    outsidersAdult = await person(outsider, 'Synthetic Outsider', 'SELF');

    // The checklist for UK tourism from Bangladesh: version 1, then version 2 for 2027 trips.
    mainPackId = await publicPack('UK Tourism From Bangladesh', { residence: ['BD'] });
    v1 = await draft(mainPackId, [REQUIREMENTS[0] as RequirementInput]);
    await publish(mainPackId, v1);
    v2 = await draft(mainPackId, REQUIREMENTS);
    const staff = await staffPrincipal(
      db,
      { accountId: owner, email: OWNER_EMAIL, bootstrapEmails: [] },
      'PACK_MANAGE',
    );
    if (!isOk(staff)) throw new Error('staff');
    const window = await setPackRouteConditions(db, staff.value, {
      packVersionId: v2,
      consularPosts: [],
      travelFrom: '2027-01-01',
      travelUntil: '2027-12-31',
    });
    if (!isOk(window)) throw new Error(`window: ${window.error.message}`);
    await publish(mainPackId, v2);
    // Decoys: another purpose, and another country of residence.
    const study = await publicPack('UK Study', { purpose: 'Study' });
    await publish(study, await draft(study, [REQUIREMENTS[0] as RequirementInput]));
    const india = await publicPack('UK Tourism From India', { residence: ['IN'] });
    await publish(india, await draft(india, [REQUIREMENTS[0] as RequirementInput]));
  }, TIMEOUT);

  it(
    'step 1: country, purpose, residence and travel dates pick the newest published version',
    async () => {
      const inWindow = new Date('2027-06-01T00:00:00Z');
      for (const applicantId of [anna, ben]) {
        const match = await findMatchingPublicPack(db, await termsFor(applicantId, inWindow));
        expect(match).toMatchObject({ packVersionId: v2, version: 2, coversTraveller: true });
        expect(match?.packVersionId).not.toBe(v1);
      }
      // Another purpose: nothing.
      expect(
        await listFittingPublicPacks(db, { ...(await termsFor(anna, inWindow)), purpose: ['Study'] }),
      ).toEqual([expect.objectContaining({ packName: 'UK Study' })]);
      // Outside the dates: left out. No date: asked for, never linked on its own.
      expect(
        await listFittingPublicPacks(db, await termsFor(anna, new Date('2028-02-01T00:00:00Z'))),
      ).toEqual([]);
      const undated = await listFittingPublicPacks(db, await termsFor(anna));
      expect(undated.map((p) => [p.packVersionId, p.needs])).toEqual([[v2, ['TRAVEL_DATES']]]);
      expect(await findMatchingPublicPack(db, await termsFor(anna))).toBeNull();
      // Residence not known: listed for the person to pick, never linked on its own.
      const caraTerms = await termsFor(cara, inWindow);
      const forCara = await listFittingPublicPacks(db, caraTerms);
      expect(forCara.find((p) => p.packVersionId === v2)?.coversTraveller).toBe(false);
      expect(await findMatchingPublicPack(db, caraTerms)).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'step 2: three authorized people join one trip, each with their own case on the version',
    async () => {
      const started = await startGroupTrip(await proof(anna), TRIP);
      if (!isOk(started)) throw new Error(`start: ${started.error.message}`);
      tripId = started.value.tripId;
      missionOf.set(anna, started.value.missionId);
      for (const applicantId of [ben, cara]) {
        const added = await addTravellerToTrip(await proof(applicantId), tripId);
        if (!isOk(added)) throw new Error(`add: ${added.error.message}`);
        missionOf.set(applicantId, added.value.missionId);
      }
      expect(new Set(missionOf.values()).size).toBe(3);
      for (const missionId of missionOf.values()) {
        const attached = await attachPackVersion(db, {
          actorAccountId: owner,
          missionId,
          packVersionId: v2,
        });
        expect(isOk(attached)).toBe(true);
      }
      // Each person's own documents.
      await document(anna, 'passport');
      await document(anna, 'bank_statement');
      await document(anna, 'hotel_booking');
      await document(ben, 'passport');
      await document(ben, 'sponsor_letter');
      await document(cara, 'passport');
    },
    TIMEOUT,
  );

  it(
    'step 3: separate requirement sets, with the conditional item read per person (R06)',
    async () => {
      // Anna is BD: the employer letter applies and is missing.
      expect((await item(anna, 'employer_letter')).state).toBe('CRITICAL_GAP');
      // Ben is SG: it does not apply to him.
      expect((await item(ben, 'employer_letter')).state).toBe('NOT_APPLICABLE');
      // Cara's nationality is unknown: Unverified, never Not Applicable, never green.
      const caras = await item(cara, 'employer_letter');
      expect(caras.state).toBe('UNVERIFIED');
      expect(caras.state).not.toBe('NOT_APPLICABLE');
      const caraReadiness = await readiness(cara);
      expect(caraReadiness.ready).toBe(false);
      const caraPackage = await pkg(cara);
      expect(caraPackage.phrase).toBe('NEEDS_ATTENTION');
      expect(caraPackage.questions).toEqual(
        expect.arrayContaining([{ kind: 'FACT', fieldKey: 'nationality' }]),
      );
    },
    TIMEOUT,
  );

  it(
    'step 4: an any-of group is met by either alternative, and missing for nobody twice',
    async () => {
      const annaReady = await readiness(anna);
      const benReady = await readiness(ben);
      const caraReady = await readiness(cara);
      expect(annaReady.missing.some((m) => m.groupKey === 'funds')).toBe(false);
      expect(benReady.missing.some((m) => m.groupKey === 'funds')).toBe(false);
      const caraFunds = caraReady.missing.filter((m) => m.groupKey === 'funds');
      expect(caraFunds).toHaveLength(1);
      expect(caraFunds[0]?.alternatives?.map((a) => a.key)).toEqual([
        'bank_statement',
        'sponsor_letter',
      ]);
      // Ben's sponsor letter covers the group; the bank statement is not a gap for him.
      expect((await item(ben, 'bank_statement')).blocking).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'step 5: each case pins an exact version of that person own document',
    async () => {
      for (const applicantId of [anna, ben, cara]) {
        const proposed = (await item(applicantId, 'passport')).proposed;
        expect(proposed?.documentVersionId).toBeTruthy();
        expect(proposed?.documentId).toBe(docsOf.get(applicantId)?.get('passport'));
        const [version] = await db
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, proposed?.documentVersionId ?? ''));
        expect(version?.documentId).toBe(docsOf.get(applicantId)?.get('passport'));
      }
      const annaPassport = await item(anna, 'passport');
      const chose = await recordPackageChoice(
        await caseProof(missionOf.get(anna) ?? '', 'MANAGE'),
        {
          missionId: missionOf.get(anna) ?? '',
          packRequirementId: annaPassport.packRequirementId,
          choice: 'USE_COPY',
          documentVersionId: annaPassport.proposed?.documentVersionId ?? '',
        },
      );
      expect(isOk(chose)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "negative: one person's document version is never pinned on another person's case",
    async () => {
      const bensPassport = (await item(ben, 'passport')).proposed?.documentVersionId ?? '';
      const caraPassport = await item(cara, 'passport');
      const refused = await recordPackageChoice(
        await caseProof(missionOf.get(cara) ?? '', 'MANAGE'),
        {
          missionId: missionOf.get(cara) ?? '',
          packRequirementId: caraPassport.packRequirementId,
          choice: 'USE_COPY',
          documentVersionId: bensPassport,
        },
      );
      expect(isErr(refused)).toBe(true);
      expect((await item(cara, 'passport')).chosen).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'step 6: a shared booking is linked only for the traveller it was explicitly allowed for',
    async () => {
      const hotelDoc = docsOf.get(anna)?.get('hotel_booking') ?? '';
      const docProof = await requireAccess(
        db,
        accountPrincipal(owner),
        'MANAGE',
        { documentId: hotelDoc },
        { purpose: 'owner_trip' },
      );
      if (!isOk(docProof)) throw new Error('doc proof');
      const added = await addTripEvidence(docProof.value as never, tripId);
      if (!isOk(added)) throw new Error(`evidence: ${added.error.message}`);
      hotelEvidenceId = added.value.evidenceId;
      const seenBy = async (applicantId: string) => {
        const listed = await listTripEvidenceForTraveller(
          await proof(applicantId, 'VIEW_METADATA'),
          tripId,
        );
        if (!isOk(listed)) throw new Error('list');
        return listed.value.map((e) => e.id);
      };
      expect(await seenBy(ben)).toEqual([]);
      expect(await seenBy(cara)).toEqual([]);
      const allowed = await setTripEvidenceAllowance(await proof(ben), tripId, hotelEvidenceId, true);
      expect(isOk(allowed) && allowed.value.changed).toBe(true);
      expect(await seenBy(ben)).toEqual([hotelEvidenceId]);
      expect(await seenBy(cara)).toEqual([]);
      // Still one document, owned by Anna: nothing copied.
      const hotels = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.docType, 'hotel_booking'));
      expect(hotels.map((d) => d.applicantId)).toEqual([anna]);
    },
    TIMEOUT,
  );

  it(
    'step 7: missing recommended evidence never blocks',
    async () => {
      // Ben has no hotel booking of his own: the recommended item is a caveat, not a gap.
      const hotel = await item(ben, 'hotel_booking');
      expect(hotel.necessity).toBe('RECOMMENDED');
      expect(hotel.blocking).toBe(false);
      const benReady = await readiness(ben);
      expect(benReady.ready).toBe(true);
      const benPkg = await pkg(ben);
      expect(benPkg.reasons).not.toContain('REQUIRED_GAP');
      // The only thing open is the earlier change note (his documents arrived after the case
      // was first read); once he has looked at it, the case is ready without a hotel booking.
      expect(benPkg.reasons).toEqual(['SOMETHING_CHANGED']);
      const reviewed = await markPackageChangeReviewed(
        await caseProof(missionOf.get(ben) ?? '', 'MANAGE'),
        missionOf.get(ben) ?? '',
      );
      expect(isOk(reviewed)).toBe(true);
      expect((await pkg(ben)).phrase).toBe('READY_FOR_FINAL_REVIEW');
    },
    TIMEOUT,
  );

  it(
    'negative: Exclude is refused on a blocking item, which stays visible after other exclusions',
    async () => {
      const missionId = missionOf.get(anna) ?? '';
      const employer = await item(anna, 'employer_letter');
      const hotel = await item(anna, 'hotel_booking');
      expect(employer.canExclude).toBe(false);
      const refused = await recordPackageChoice(await caseProof(missionId, 'MANAGE'), {
        missionId,
        packRequirementId: employer.packRequirementId,
        choice: 'EXCLUDE',
        reason: 'Synthetic reason',
      });
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      const excluded = await recordPackageChoice(await caseProof(missionId, 'MANAGE'), {
        missionId,
        packRequirementId: hotel.packRequirementId,
        choice: 'EXCLUDE',
        reason: 'Staying with family',
      });
      expect(isOk(excluded)).toBe(true);
      const after = await pkg(anna);
      expect(after.phrase).toBe('NEEDS_ATTENTION');
      expect(after.reasons).toContain('REQUIRED_GAP');
      expect(after.items.find((i) => i.key === 'employer_letter')?.state).toBe('CRITICAL_GAP');
      expect((await readiness(anna)).missing.map((m) => m.key)).toContain('employer_letter');
    },
    TIMEOUT,
  );

  it(
    'negative: an adult from another account cannot be added, and nothing of theirs changes',
    async () => {
      const denied = await requireAccess(
        db,
        accountPrincipal(owner),
        'MANAGE',
        { applicantId: outsidersAdult },
        { purpose: 'owner_trip' },
      );
      expect(isOk(denied)).toBe(false);
      const theirProof = await requireAccess(
        db,
        accountPrincipal(outsider),
        'MANAGE',
        { applicantId: outsidersAdult },
        { purpose: 'owner_trip' },
      );
      if (!isOk(theirProof)) throw new Error('their proof');
      const viaOwn = await addTravellerToTrip(theirProof.value as never, tripId);
      expect(isErr(viaOwn) && viaOwn.error.code).toBe('not_found');
      const theirCases = await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.applicantId, outsidersAdult));
      expect(theirCases).toEqual([]);
      const links = await db
        .select()
        .from(schema.umpeTripTravellers)
        .where(eq(schema.umpeTripTravellers.applicantId, outsidersAdult));
      expect(links).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'negative: a child without recorded guardian confirmation cannot be added',
    async () => {
      const [legacyChild] = await db
        .insert(schema.applicants)
        .values({
          ownerAccountId: owner,
          displayName: 'Synthetic Unconfirmed Child',
          relationship: 'MINOR_GUARDIAN',
        })
        .returning({ id: schema.applicants.id });
      if (!legacyChild) throw new Error('child');
      const refused = await addTravellerToTrip(await proof(legacyChild.id), tripId);
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      expect(isErr(refused) && refused.error.message).toMatch(/parent or guardian/);
      const cases = await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.applicantId, legacyChild.id));
      expect(cases).toEqual([]);
      const travellers = await db
        .select()
        .from(schema.umpeTripTravellers)
        .where(inArray(schema.umpeTripTravellers.applicantId, [legacyChild.id]));
      expect(travellers).toEqual([]);
      // The trip still has exactly the three authorized people.
      const count = await db.execute(
        sql`select count(*)::int as n from umpe_trip_travellers where trip_id = ${tripId}`,
      );
      expect((count.rows[0] as { n: number } | undefined)?.n).toBe(3);
    },
    TIMEOUT,
  );
});
