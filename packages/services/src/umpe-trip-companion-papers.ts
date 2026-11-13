import { type Result, err, ok } from '@visastack/core';
/**
 * UMPE UX6 package 4: Travel Bookings, the third thing a companion may share with the organiser.
 *
 * A joined companion may choose some of THEIR OWN booking, itinerary, invitation and accommodation
 * papers (the common trip evidence kinds, `isCommonTripEvidenceType`) to show the organiser BY NAME
 * ONLY: the paper's display name and its kind, never the file, a link to it, or anything inside it.
 * Passports, bank and medical papers can never be chosen. The choice is stored as one row per pair
 * in `umpe_trip_companion_papers` (no copy of anything), and it is only ever shown to the organiser
 * while the companion's sharing level is Travel Bookings.
 *
 * Companion side. Every function takes a `TripCompanionAccess` (checked at run time) and works on
 * the companion's own row only. Choosing a paper also takes the companion's own owner proof of that
 * one document (`requireAccess`, actor `applicant_owner`), and the record behind it must be the
 * companion's own record (their SELF applicant): another person's paper, or a managed family
 * member's, is refused, so no path reaches a paper that is not theirs.
 *
 * Organiser side. `organiserPaperNames` takes the organiser's owner proof, and its query itself
 * requires the companion to be JOINED at Travel Bookings, so lowering the level or removing a paper
 * removes it on the next read. It returns names and kinds and nothing else (no ids).
 *
 * The table ships before its migration runs: while it is missing every read answers "none", the
 * Travel Bookings level behaves as it did before, and choosing is refused plainly.
 */
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { and, asc, count, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import {
  type TripCompanionAccess,
  companionsReady,
  tripCompanionAccessProblem,
} from './access/trip-companion-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError } from './errors';
import { caseFlowAEn } from './i18n/case-flow-a';
import {
  everydayDocumentCondition,
  lifecycleTablesPresent,
  presentApplicantCondition,
} from './lifecycle/foundation';
import { tripCompanionPapersTablePresent } from './umpe-trip-companion-tables';
import { isCommonTripEvidenceType } from './umpe-trip-rules';
import { ownerAccountOf } from './umpe-trip-service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many papers may be shown to the organiser by one companion. */
export const COMPANION_PAPERS_MAX = 20;

/** The most papers the choice list offers at once. */
const OPTIONS_LIMIT = 100;
/** Papers are read this many at a time, and never more than this many are scanned in all. */
const OPTIONS_PAGE = 200;
const OPTIONS_SCAN_LIMIT = 5000;

export const COMPANION_PAPERS_NOT_AVAILABLE =
  caseFlowAEn['umpe_trip_companion_papers.choosing_papers_is_not_switched_on'];

/** One of the companion's own papers, as the companion sees it. */
export interface CompanionPaperView {
  readonly documentId: string;
  readonly name: string;
  /** The kind in plain words, for example "Flight Booking". */
  readonly kind: string;
}

/** What the organiser may see of a chosen paper: its name and kind, nothing else. */
export interface OrganiserPaperView {
  readonly name: string;
  readonly kind: string;
}

export interface CompanionPapers {
  /** False while the table is missing: nothing can be chosen and nothing is shown. */
  readonly available: boolean;
  readonly chosen: readonly CompanionPaperView[];
  /** The companion's own papers that may be chosen and are not yet. */
  readonly options: readonly CompanionPaperView[];
}

const kindOf = (docType: string | null): string =>
  (docType ? resolveDocumentType(docType)?.label : undefined) ?? 'Travel Paper';

const nameOf = (row: {
  readonly approvedName: string | null;
  readonly originalName: string;
}): string => row.approvedName?.trim() || row.originalName;

/** The companion's own live row, only while this very account is still joined to it. */
async function liveRow(db: Db, access: TripCompanionAccess) {
  const companions = schema.umpeTripCompanions;
  return first(
    await db
      .select({ id: companions.id, shareLevel: companions.shareLevel })
      .from(companions)
      .where(
        and(
          eq(companions.id, access.companionId),
          eq(companions.tripId, access.tripId),
          eq(companions.state, 'JOINED'),
          eq(companions.joinedAccountId, access.accountId),
        ),
      )
      .limit(1),
  );
}

/**
 * The papers a joined companion has chosen, and the ones they could choose: their own record's
 * common travel papers that are present and not archived. The organiser is never part of this read.
 */
export async function listMyTripPapers(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<CompanionPapers, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (!(await companionsReady(db)) || !(await liveRow(db, access))) {
    return err(
      keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
    );
  }
  if (!(await tripCompanionPapersTablePresent(db))) {
    return ok({ available: false, chosen: [], options: [] });
  }
  const lifecycle = await lifecycleTablesPresent(db);
  const fields = {
    id: schema.documents.id,
    approvedName: schema.documents.approvedName,
    originalName: schema.documents.originalName,
    docType: schema.documents.docType,
  };
  // Their own record only (the account behind this access, and the record that is them), present
  // and not archived. The travel kinds are decided in code (a stored kind may be an alias), so the
  // papers are read in pages until enough that can be offered are found: an older paper of another
  // kind never hides a newer travel paper.
  const ownTravelPapers = and(
    eq(schema.applicants.ownerAccountId, access.accountId),
    eq(schema.applicants.relationship, 'SELF'),
    lifecycle ? everydayDocumentCondition() : undefined,
    lifecycle ? presentApplicantCondition() : undefined,
  );
  // What is chosen comes from the choices themselves, so a choice is always listed (and can always
  // be withdrawn) while the organiser can see it.
  const chosenRows = await db
    .select(fields)
    .from(schema.umpeTripCompanionPapers)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.umpeTripCompanionPapers.documentId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
    .where(and(eq(schema.umpeTripCompanionPapers.companionId, access.companionId), ownTravelPapers))
    .orderBy(asc(schema.umpeTripCompanionPapers.createdAt), asc(schema.umpeTripCompanionPapers.id));
  const picked = new Set(chosenRows.map((row) => row.id));
  const wanted = OPTIONS_LIMIT + picked.size;
  const optionRows: (typeof chosenRows)[number][] = [];
  for (
    let offset = 0;
    optionRows.length < wanted && offset < OPTIONS_SCAN_LIMIT;
    offset += OPTIONS_PAGE
  ) {
    const page = await db
      .select(fields)
      .from(schema.documents)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
      .where(ownTravelPapers)
      .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id))
      .limit(OPTIONS_PAGE)
      .offset(offset);
    optionRows.push(...page.filter((doc) => isCommonTripEvidenceType(doc.docType)));
    if (page.length < OPTIONS_PAGE) break;
  }
  const view = (doc: (typeof chosenRows)[number]): CompanionPaperView => ({
    documentId: doc.id,
    name: nameOf(doc),
    kind: kindOf(doc.docType),
  });
  return ok({
    available: true,
    chosen: chosenRows.filter((doc) => isCommonTripEvidenceType(doc.docType)).map(view),
    options: optionRows
      .filter((doc) => !picked.has(doc.id))
      .slice(0, OPTIONS_LIMIT)
      .map(view),
  });
}

/**
 * Show one of the companion's own papers to the organiser, by name only. Needs the companion's own
 * owner proof of that one document (the record must be theirs, the one that is them), a common
 * travel paper kind, their level to be Travel Bookings, and fewer than 20 papers chosen already.
 * Choosing the same paper twice changes nothing. Audited with ids only.
 */
export async function chooseTripPaper(
  db: Db,
  access: TripCompanionAccess,
  paper: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<{ readonly added: boolean }, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (
    !AuthorizedApplicant.isGenuine(paper, 'VIEW_METADATA') ||
    paper.actor.kind !== 'applicant_owner' ||
    paper.resource.kind !== 'document' ||
    paper.applicant.ownerAccountId !== access.accountId ||
    paper.applicant.relationship !== 'SELF' ||
    paper.resource.document.applicantId !== paper.applicant.id
  ) {
    return err(keyedError('not_found', 'umpe_trip_companion_papers.that_paper_is_not_available'));
  }
  const documentId = paper.resource.document.id;
  if (!(await companionsReady(db)) || !(await tripCompanionPapersTablePresent(db))) {
    return err(
      keyedError('invalid', 'umpe_trip_companion_papers.choosing_papers_is_not_switched_on'),
    );
  }
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    const row = first(
      await tx
        .select({ shareLevel: companions.shareLevel })
        .from(companions)
        .where(
          and(
            eq(companions.id, access.companionId),
            eq(companions.tripId, access.tripId),
            eq(companions.state, 'JOINED'),
            eq(companions.joinedAccountId, access.accountId),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!row)
      return err(
        keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
      );
    if (row.shareLevel !== 'TRAVEL_BOOKINGS')
      return err(keyedError('invalid', 'umpe_trip_companion_papers.choose_travel_bookings_first'));
    // The paper is read again here: still theirs, still present, still a travel paper kind.
    const lifecycle = await lifecycleTablesPresent(tx);
    const doc = first(
      await tx
        .select({ docType: schema.documents.docType })
        .from(schema.documents)
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.applicants.id, paper.applicant.id),
            eq(schema.applicants.ownerAccountId, access.accountId),
            eq(schema.applicants.relationship, 'SELF'),
            // The same rule as the list of papers that can be offered: present and not archived.
            lifecycle ? everydayDocumentCondition() : undefined,
            lifecycle ? presentApplicantCondition() : undefined,
          ),
        )
        .limit(1),
    );
    if (!doc)
      return err(keyedError('not_found', 'umpe_trip_companion_papers.that_paper_is_not_available'));
    if (!isCommonTripEvidenceType(doc.docType)) {
      return err(
        keyedError(
          'invalid',
          'umpe_trip_companion_papers.only_bookings_itineraries_invitations_and_accommodation',
        ),
      );
    }
    const papers = schema.umpeTripCompanionPapers;
    const already = first(
      await tx
        .select({ id: papers.id })
        .from(papers)
        .where(and(eq(papers.companionId, access.companionId), eq(papers.documentId, documentId)))
        .limit(1),
    );
    if (already) return ok({ added: false });
    const have = first(
      await tx
        .select({ n: count() })
        .from(papers)
        .where(eq(papers.companionId, access.companionId)),
    );
    if (Number(have?.n ?? 0) >= COMPANION_PAPERS_MAX) {
      return err(
        keyedError('invalid', 'umpe_trip_companion_papers.too_many', { max: COMPANION_PAPERS_MAX }),
      );
    }
    await tx.insert(papers).values({ companionId: access.companionId, documentId });
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_PAPER_CHOSEN',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId, documentId },
    });
    return ok({ added: true });
  });
}

/**
 * Stop showing one paper to the organiser. Only the companion's own choice on their own row; a
 * paper that was not chosen (or a made-up id) changes nothing. The organiser's next read no longer
 * has it. The paper itself is untouched.
 */
export async function removeTripPaper(
  db: Db,
  access: TripCompanionAccess,
  documentId: string,
): Promise<Result<{ readonly removed: boolean }, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (!UUID.test(documentId)) return ok({ removed: false });
  if (!(await companionsReady(db)) || !(await tripCompanionPapersTablePresent(db))) {
    return ok({ removed: false });
  }
  return db.transaction(async (tx) => {
    if (!(await liveRow(tx, access)))
      return err(
        keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
      );
    const papers = schema.umpeTripCompanionPapers;
    const gone = await tx
      .delete(papers)
      .where(and(eq(papers.companionId, access.companionId), eq(papers.documentId, documentId)))
      .returning({ id: papers.id });
    if (gone.length === 0) return ok({ removed: false });
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_PAPER_REMOVED',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId, documentId },
    });
    return ok({ removed: true });
  });
}

/**
 * The names of the papers each joined companion of this trip chose to show the organiser, keyed by
 * the companion's id. Only a companion who is JOINED at Travel Bookings has any, and only a paper
 * that is still the companion's own, present and a travel paper kind (a retyped or deleted one is
 * simply left out). Names and kinds only: never a document id, a file, a link or any detail. Needs
 * the organiser's owner proof, and the trip must be theirs.
 */
export async function organiserPaperNames(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  tripId: string,
): Promise<ReadonlyMap<string, readonly OrganiserPaperView[]>> {
  const owner = ownerAccountOf(proof, 'VIEW_METADATA');
  const names = new Map<string, OrganiserPaperView[]>();
  if (!owner.ok || !UUID.test(tripId)) return names;
  const db = proof.tx;
  if (!(await companionsReady(db)) || !(await tripCompanionPapersTablePresent(db))) return names;
  const companions = schema.umpeTripCompanions;
  const papers = schema.umpeTripCompanionPapers;
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await db
    .select({
      companionId: papers.companionId,
      approvedName: schema.documents.approvedName,
      originalName: schema.documents.originalName,
      docType: schema.documents.docType,
    })
    .from(papers)
    .innerJoin(companions, eq(companions.id, papers.companionId))
    .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, companions.tripId))
    .innerJoin(schema.documents, eq(schema.documents.id, papers.documentId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
    .where(
      and(
        eq(companions.tripId, tripId),
        eq(schema.umpeTrips.ownerAccountId, owner.value),
        // The level gate: a joined companion at Travel Bookings, and nobody else.
        eq(companions.state, 'JOINED'),
        eq(companions.shareLevel, 'TRAVEL_BOOKINGS'),
        // The paper is the joined person's own, on their own record.
        eq(schema.applicants.ownerAccountId, companions.joinedAccountId),
        eq(schema.applicants.relationship, 'SELF'),
        // A paper the companion archived, deleted or retyped drops out of the organiser's view.
        lifecycle ? everydayDocumentCondition() : undefined,
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(asc(papers.createdAt), asc(papers.id));
  for (const row of rows) {
    if (!isCommonTripEvidenceType(row.docType)) continue;
    const list = names.get(row.companionId) ?? [];
    list.push({ name: nameOf(row), kind: kindOf(row.docType) });
    names.set(row.companionId, list);
  }
  return names;
}
