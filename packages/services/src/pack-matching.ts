import { packMatchKey } from '@visastack/core';
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AuthorizedApplicant } from './access';
import { isTrustedFactStatus } from './ai';
import { type Db, schema } from './db';
import { type PackRouteConditions, listPackRouteConditions } from './pack-rule-details';

/**
 * Which published checklist fits a new case (owner list item 1, 26 Oct 2026).
 *
 * A pack describes the route it covers with two free-text labels, `jurisdiction` ("UK",
 * "United Kingdom", "GB") and `purpose` ("tourism", "Tourism"), and may narrow who it is for with
 * `nationalityApplicability` and `residenceApplicability` (codes or names, such as "BD" or
 * "Bangladesh"). A case knows its country and purpose from the pickers on the new-case form, and
 * the traveller's nationality and country of residence come from their confirmed profile values
 * (`readTravellerCoverage`, behind the access gate). The caller passes every name that may stand
 * for each, and a label fits when it equals one of those names, ignoring case, accents and
 * punctuation.
 *
 * Who a pack is for: an empty or unset list means the pack does not narrow who it is for. A list
 * that names nationalities (or residences) fits a traveller whose confirmed value is on it, and
 * never one whose confirmed values are all known and all elsewhere. When the traveller's value is
 * not known (nothing confirmed, or a confirmed value that names no country the app can read), the
 * pack may still be theirs: it is listed for the person to pick, marked as not known to cover
 * them, and never linked on its own.
 *
 * A pack's `route` (UMPE P1, R05) is compared when the caller knows the case's route: a pack
 * for another route is left out. A pack that names a route while the case's route is not known
 * may still be the right one, so it is listed, marked as not known to fit the route, and never
 * linked on its own (the same rule as an unknown nationality or residence). A pack with no
 * route does not narrow by route. Cases have no route field yet, so today every route-specific
 * pack is offered for the person to pick rather than linked. Two packs for different routes of
 * the same country and purpose are two fitting packs, so nothing is linked and the person picks.
 *
 * Application post and travel dates (UMPE G2, R05) are compared only when the pack declares them
 * (`pack_route_conditions`, on the version that would be linked). A case whose post or trip start is known and outside what the pack
 * declares is left out. A case that lacks a value the pack declares is never guessed about: the pack
 * is listed with `needs` naming the case detail to add, and never linked on its own. A pack that
 * declares nothing matches exactly as before.
 *
 * Only an authoritative public pack counts (`packs.authoritative`, the reviewed public catalogue,
 * with no owning agency): an agency's own checklist, including one whose agency was deleted, is
 * never offered here. Neither is a pack whose country or purpose was never filled in (unset means
 * "not yet classified", never "applies to all"). Only the newest published version of each pack
 * is read, and only for packs whose country and purpose roughly match in the database.
 */

export interface TravellerCountries {
  /** Every name for each of the traveller's confirmed values that names a country. */
  readonly terms: readonly string[];
  /**
   * True when there is at least one confirmed value and every one names a country, so a pack
   * that names none of them is known not to be theirs.
   */
  readonly known: boolean;
}

export interface TravellerMatchTerms {
  readonly nationality: TravellerCountries;
  readonly residence: TravellerCountries;
}

export interface PackMatchTerms {
  /** Every name that may stand for the case's country. */
  readonly country: readonly string[];
  /** Every name that may stand for the case's purpose. */
  readonly purpose: readonly string[];
  /** Who the case is for, so a pack meant for other people is left out. */
  readonly traveller: TravellerMatchTerms;
  /**
   * Every name that may stand for the case's route (visa type or subroute), when known. Omitted
   * or empty means the route is not known: a route-specific pack is then listed, never linked.
   */
  readonly route?: readonly string[];
  /** The case's application post (consular jurisdiction), when known. */
  readonly consularPost?: string | null;
  /** The case's trip start, when known. Compared by its calendar date (UTC). */
  readonly travelStart?: Date | null;
}

/** A case detail a pack needs before it can be known to fit. */
export type PackMatchNeed = 'APPLICATION_POST' | 'TRAVEL_DATES';

export interface PackMatch {
  readonly packVersionId: string;
  readonly packName: string;
  readonly version: number;
  /**
   * True when the pack does not narrow who it is for, or names the traveller's confirmed value.
   * False when it may cover them but their nationality or residence is not known.
   */
  readonly coversTraveller: boolean;
  /**
   * True when the pack names no route, or names the case's known route. False when it names a
   * route and the case's route is not known, so it may fit but is never linked on its own.
   */
  readonly coversRoute: boolean;
  /**
   * UMPE G2: the case details this pack declares and the case lacks. Present only when there is
   * at least one, so a pack that declares nothing reads exactly as before. A pack with needs is
   * listed, never linked on its own.
   */
  readonly needs?: readonly PackMatchNeed[];
}

/** The traveller's confirmed values, as they were saved. */
export interface TravellerCoverage {
  readonly nationality: readonly string[];
  readonly residence: readonly string[];
}

/** Profile fields that say who a pack is for. */
const NATIONALITY_FIELD = 'nationality';
const RESIDENCE_FIELD = 'country_of_residence';

export { packMatchKey };

/** `packMatchKey` without its spaces: the coarse key the database can work out too. */
function coarseKey(key: string): string {
  return key.replace(/ /g, '');
}

/**
 * A coarse key the database works out: decomposed, lower-cased, everything but ASCII letters and
 * digits dropped (accent marks of every kind go with the rest). Two labels with the same
 * `packMatchKey` always share it, so this filter can only let too many packs through, never too
 * few; the exact key then decides here.
 */
function sqlCoarseKey(column: AnyPgColumn): SQL<string> {
  return sql<string>`regexp_replace(lower(normalize(${column}, NFD)), '[^a-z0-9]+', '', 'g')`;
}

function keySet(terms: readonly string[]): ReadonlySet<string> {
  return new Set(terms.map(packMatchKey).filter((key) => key.length > 0));
}

/** Whether a pack's list of who it is for leaves this traveller out, admits them, or may. */
function coverage(
  list: readonly string[] | null,
  traveller: { readonly keys: ReadonlySet<string>; readonly known: boolean },
): 'covers' | 'may' | 'excludes' {
  const named = keySet(list ?? []);
  if (named.size === 0) return 'covers';
  for (const key of traveller.keys) if (named.has(key)) return 'covers';
  return traveller.known ? 'excludes' : 'may';
}

/**
 * Whether a pack's route fits the case's: no route on the pack covers every route; a known route
 * fits only when the names match; an unknown case route may fit.
 */
function routeFit(
  packRoute: string | null,
  caseRoutes: ReadonlySet<string>,
): 'covers' | 'may' | 'excludes' {
  const named = packMatchKey(packRoute ?? '');
  if (named.length === 0) return 'covers';
  if (caseRoutes.size === 0) return 'may';
  return caseRoutes.has(named) ? 'covers' : 'excludes';
}

/**
 * Whether a declared application post and the case's post name the same place: equal, or one found
 * as whole words in the other ("Dhaka" and "US Embassy Dhaka", either way round), ignoring case,
 * accents and punctuation. No partial words.
 */
function postNamed(declared: string, casePostKey: string): boolean {
  const key = packMatchKey(declared);
  if (key.length === 0) return false;
  return (
    key === casePostKey ||
    ` ${casePostKey} `.includes(` ${key} `) ||
    ` ${key} `.includes(` ${casePostKey} `)
  );
}

/** How a pack's declared post and travel window fit the case, and what the case still lacks. */
function caseDetailFit(
  conditions: PackRouteConditions | undefined,
  casePostKey: string,
  travelStartDay: string | null,
): {
  readonly excluded: boolean;
  readonly needs: PackMatchNeed[];
  /** Why a known case value is outside what the pack declares; set only when `excluded`. */
  readonly why?: 'OTHER_APPLICATION_POST' | 'OUTSIDE_TRAVEL_DATES';
} {
  const needs: PackMatchNeed[] = [];
  if (!conditions) return { excluded: false, needs };
  if (conditions.consularPosts.length > 0) {
    if (casePostKey.length === 0) needs.push('APPLICATION_POST');
    else if (!conditions.consularPosts.some((post) => postNamed(post, casePostKey))) {
      return { excluded: true, needs: [], why: 'OTHER_APPLICATION_POST' };
    }
  }
  if (conditions.travelFrom !== null || conditions.travelUntil !== null) {
    if (travelStartDay === null) needs.push('TRAVEL_DATES');
    else if (
      (conditions.travelFrom !== null && travelStartDay < conditions.travelFrom) ||
      (conditions.travelUntil !== null && travelStartDay > conditions.travelUntil)
    ) {
      return { excluded: true, needs: [], why: 'OUTSIDE_TRAVEL_DATES' };
    }
  }
  return { excluded: false, needs };
}

/**
 * Whether one pack version's declared application posts and travel window fit a case (UMPE G2):
 * `excluded` when a known case value is outside them, `needs` naming a declared detail the case
 * lacks. A version that declares nothing fits. Used by matching and by the trip package, which
 * raises one change when the linked checklist no longer fits after the case details are edited.
 */
export function caseDetailsFit(
  conditions: PackRouteConditions | undefined,
  consularPost: string | null,
  travelStart: Date | null,
): { readonly excluded: boolean; readonly needs: readonly PackMatchNeed[] } {
  const { excluded, needs } = caseDetailFit(
    conditions,
    packMatchKey(consularPost ?? ''),
    dayOf(travelStart),
  );
  return { excluded, needs };
}

/** A trip start as its UTC calendar date, or null when unknown or not a real date. */
function dayOf(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

/**
 * Why a case has no checklist to link or pick (VS-006). `NO_REVIEWED_CHECKLIST` means no reviewed
 * public checklist is published for the destination and purpose at all; the others mean one exists
 * but is meant for something else about this case. Reasons only explain an empty result and never
 * change what matches. The case's application post is a different thing from its destination:
 * `OTHER_APPLICATION_POST` is about the embassy or visa centre, never the country.
 */
export type NoPackReason =
  | 'NO_REVIEWED_CHECKLIST'
  | 'OTHER_NATIONALITY'
  | 'OTHER_RESIDENCE'
  | 'OTHER_ROUTE'
  | 'OTHER_APPLICATION_POST'
  | 'OUTSIDE_TRAVEL_DATES';

/** The order reasons are reported in. */
const NO_PACK_REASON_ORDER: readonly NoPackReason[] = [
  'NO_REVIEWED_CHECKLIST',
  'OTHER_NATIONALITY',
  'OTHER_RESIDENCE',
  'OTHER_ROUTE',
  'OTHER_APPLICATION_POST',
  'OUTSIDE_TRAVEL_DATES',
];

interface PublicPackEvaluation {
  readonly fitting: PackMatch[];
  /** Catalogue packs for this destination and purpose, before who they are for and case details. */
  readonly candidates: number;
  readonly excludedBecause: ReadonlySet<NoPackReason>;
}

/**
 * Reads every published catalogue pack for this country and purpose and decides, for each, whether
 * it fits the case or why it does not. The one place the matching rules live.
 */
async function evaluatePublicPacks(db: Db, terms: PackMatchTerms): Promise<PublicPackEvaluation> {
  const countries = keySet(terms.country);
  const purposes = keySet(terms.purpose);
  const excludedBecause = new Set<NoPackReason>();
  if (countries.size === 0 || purposes.size === 0) {
    return { fitting: [], candidates: 0, excludedBecause };
  }
  const nationality = {
    keys: keySet(terms.traveller.nationality.terms),
    known: terms.traveller.nationality.known,
  };
  const residence = {
    keys: keySet(terms.traveller.residence.terms),
    known: terms.traveller.residence.known,
  };
  const routes = keySet(terms.route ?? []);

  const rows = await db
    .selectDistinctOn([schema.packVersions.packId], {
      packId: schema.packVersions.packId,
      packName: schema.packs.name,
      jurisdiction: schema.packs.jurisdiction,
      purpose: schema.packs.purpose,
      route: schema.packs.route,
      nationalityApplicability: schema.packs.nationalityApplicability,
      residenceApplicability: schema.packs.residenceApplicability,
      packVersionId: schema.packVersions.id,
      version: schema.packVersions.version,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(
        eq(schema.packVersions.status, 'PUBLISHED'),
        eq(schema.packs.authoritative, true),
        isNull(schema.packs.ownerOrganizationId),
        isNotNull(schema.packs.jurisdiction),
        isNotNull(schema.packs.purpose),
        inArray(sqlCoarseKey(schema.packs.jurisdiction), [...countries].map(coarseKey)),
        inArray(sqlCoarseKey(schema.packs.purpose), [...purposes].map(coarseKey)),
      ),
    )
    // The newest published version of each pack is its current checklist.
    .orderBy(schema.packVersions.packId, desc(schema.packVersions.version));

  // Route conditions belong to the exact version that would be linked (the newest published one).
  const conditionsByVersion = await listPackRouteConditions(
    db,
    rows.map((row) => row.packVersionId),
  );
  const casePostKey = packMatchKey(terms.consularPost ?? '');
  const travelStartDay = dayOf(terms.travelStart);

  const fitting: PackMatch[] = [];
  let candidates = 0;
  for (const row of rows) {
    // The database only narrowed the rows; the exact key decides.
    if (row.jurisdiction === null || row.purpose === null) continue;
    if (!countries.has(packMatchKey(row.jurisdiction))) continue;
    if (!purposes.has(packMatchKey(row.purpose))) continue;
    candidates += 1;
    const byNationality = coverage(row.nationalityApplicability, nationality);
    const byResidence = coverage(row.residenceApplicability, residence);
    const byRoute = routeFit(row.route, routes);
    const details = caseDetailFit(
      conditionsByVersion.get(row.packVersionId),
      casePostKey,
      travelStartDay,
    );
    if (
      byNationality === 'excludes' ||
      byResidence === 'excludes' ||
      byRoute === 'excludes' ||
      details.excluded
    ) {
      if (byNationality === 'excludes') excludedBecause.add('OTHER_NATIONALITY');
      if (byResidence === 'excludes') excludedBecause.add('OTHER_RESIDENCE');
      if (byRoute === 'excludes') excludedBecause.add('OTHER_ROUTE');
      if (details.why) excludedBecause.add(details.why);
      continue;
    }
    fitting.push({
      packVersionId: row.packVersionId,
      packName: row.packName,
      version: row.version,
      coversTraveller: byNationality === 'covers' && byResidence === 'covers',
      coversRoute: byRoute === 'covers',
      ...(details.needs.length > 0 ? { needs: details.needs } : {}),
    });
  }
  fitting.sort((a, b) => a.packName.localeCompare(b.packName, 'en'));
  return { fitting, candidates, excludedBecause };
}

/**
 * Every published catalogue pack that fits this country and purpose and is not known to be meant
 * for other people, newest version of each, in name order.
 */
export async function listFittingPublicPacks(db: Db, terms: PackMatchTerms): Promise<PackMatch[]> {
  return (await evaluatePublicPacks(db, terms)).fitting;
}

/**
 * Why no checklist fits a case (VS-006), for words on the case page. Empty when at least one
 * checklist fits (even if none can be linked on its own). `NO_REVIEWED_CHECKLIST` alone when no
 * reviewed public checklist is published for the destination and purpose; otherwise every way the
 * published ones are meant for something else about this case. Read-only; matching is unchanged.
 */
export async function explainNoFittingPack(
  db: Db,
  terms: PackMatchTerms,
): Promise<readonly NoPackReason[]> {
  const { fitting, candidates, excludedBecause } = await evaluatePublicPacks(db, terms);
  if (fitting.length > 0) return [];
  if (candidates === 0) return ['NO_REVIEWED_CHECKLIST'];
  return NO_PACK_REASON_ORDER.filter((reason) => excludedBecause.has(reason));
}

/**
 * The one published catalogue pack to link on its own, or null. It is linked only when it is the
 * only pack that may fit and it is known to cover the traveller and the case's route; otherwise the person picks:
 * guessing between routes, or for someone the pack may not be meant for, would put the wrong list
 * in front of them.
 */
export async function findMatchingPublicPack(
  db: Db,
  terms: PackMatchTerms,
): Promise<PackMatch | null> {
  const [only, ...others] = await listFittingPublicPacks(db, terms);
  return only &&
    others.length === 0 &&
    only.coversTraveller &&
    only.coversRoute &&
    only.needs === undefined
    ? only
    : null;
}

/**
 * The traveller's confirmed nationality and country of residence, for choosing a checklist. Only
 * values the person or a reviewer stands behind count (an unconfirmed reading never decides who a
 * checklist is for), and a protected value is left out rather than revealed for this. Nothing is
 * returned without a genuine gate proof.
 */
export async function readTravellerCoverage(
  proof: AuthorizedApplicant<'MANAGE'>,
): Promise<TravellerCoverage> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) return { nationality: [], residence: [] };
  const rows = await proof.tx
    .select({
      fieldKey: schema.fieldDefinitions.key,
      value: schema.factVersions.value,
      protectedKeyVersion: schema.factVersions.protectedKeyVersion,
      status: schema.factVersions.status,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
    )
    .innerJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(
      and(
        eq(schema.facts.applicantId, proof.applicant.id),
        inArray(schema.fieldDefinitions.key, [NATIONALITY_FIELD, RESIDENCE_FIELD]),
      ),
    );

  const nationality: string[] = [];
  const residence: string[] = [];
  for (const row of rows) {
    if (row.protectedKeyVersion !== null || !isTrustedFactStatus(row.status)) continue;
    const value = row.value?.trim() ?? '';
    if (value.length === 0) continue;
    (row.fieldKey === NATIONALITY_FIELD ? nationality : residence).push(value);
  }
  return { nationality, residence };
}
