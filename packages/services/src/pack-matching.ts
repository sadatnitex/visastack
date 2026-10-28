import { packMatchKey } from '@visastack/core';
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AuthorizedApplicant } from './access';
import { isTrustedFactStatus } from './ai';
import { type Db, schema } from './db';

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
 * A pack's `route` is not compared: a case has no route of its own. Two packs for different
 * routes of the same country and purpose are two fitting packs, so nothing is linked and the
 * person picks.
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
}

export interface PackMatch {
  readonly packVersionId: string;
  readonly packName: string;
  readonly version: number;
  /**
   * True when the pack does not narrow who it is for, or names the traveller's confirmed value.
   * False when it may cover them but their nationality or residence is not known.
   */
  readonly coversTraveller: boolean;
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
 * Every published catalogue pack that fits this country and purpose and is not known to be meant
 * for other people, newest version of each, in name order.
 */
export async function listFittingPublicPacks(db: Db, terms: PackMatchTerms): Promise<PackMatch[]> {
  const countries = keySet(terms.country);
  const purposes = keySet(terms.purpose);
  if (countries.size === 0 || purposes.size === 0) return [];
  const nationality = {
    keys: keySet(terms.traveller.nationality.terms),
    known: terms.traveller.nationality.known,
  };
  const residence = {
    keys: keySet(terms.traveller.residence.terms),
    known: terms.traveller.residence.known,
  };

  const rows = await db
    .selectDistinctOn([schema.packVersions.packId], {
      packId: schema.packVersions.packId,
      packName: schema.packs.name,
      jurisdiction: schema.packs.jurisdiction,
      purpose: schema.packs.purpose,
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

  const fitting: PackMatch[] = [];
  for (const row of rows) {
    // The database only narrowed the rows; the exact key decides.
    if (row.jurisdiction === null || row.purpose === null) continue;
    if (!countries.has(packMatchKey(row.jurisdiction))) continue;
    if (!purposes.has(packMatchKey(row.purpose))) continue;
    const byNationality = coverage(row.nationalityApplicability, nationality);
    const byResidence = coverage(row.residenceApplicability, residence);
    if (byNationality === 'excludes' || byResidence === 'excludes') continue;
    fitting.push({
      packVersionId: row.packVersionId,
      packName: row.packName,
      version: row.version,
      coversTraveller: byNationality === 'covers' && byResidence === 'covers',
    });
  }
  return fitting.sort((a, b) => a.packName.localeCompare(b.packName, 'en'));
}

/**
 * The one published catalogue pack to link on its own, or null. It is linked only when it is the
 * only pack that may fit and it is known to cover the traveller; otherwise the person picks:
 * guessing between routes, or for someone the pack may not be meant for, would put the wrong list
 * in front of them.
 */
export async function findMatchingPublicPack(
  db: Db,
  terms: PackMatchTerms,
): Promise<PackMatch | null> {
  const [only, ...others] = await listFittingPublicPacks(db, terms);
  return only && others.length === 0 && only.coversTraveller ? only : null;
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
