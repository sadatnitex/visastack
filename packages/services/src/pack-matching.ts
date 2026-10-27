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
 * Applicability: an empty or unset list means the pack does not narrow who it is for. A list that
 * names nationalities (or residences) fits only a traveller whose confirmed value is on it. When
 * the traveller's value is not known:
 * - `certain` (used to link a checklist on its own) leaves the pack out, so a checklist meant for
 *   other nationalities is never linked automatically;
 * - `possible` (used to say whether there is a checklist to pick) keeps it, since the person may
 *   well be covered and can still choose it themselves.
 *
 * A pack's `route` is not compared: a case has no route of its own. Two packs for different
 * routes of the same country and purpose are two fitting packs, so nothing is linked and the
 * person picks.
 *
 * A pack an agency made for its own clients is never offered here, and neither is a pack whose
 * country or purpose was never filled in (unset means "not yet classified", never "applies to
 * all"). Only the newest published version of each pack is read, and only for packs whose
 * country and purpose already match in the database.
 */

export interface TravellerMatchTerms {
  /** Every name that may stand for each of the traveller's confirmed nationalities; empty when not known. */
  readonly nationality: readonly string[];
  /** Every name that may stand for the traveller's confirmed country of residence; empty when not known. */
  readonly residence: readonly string[];
}

export interface PackMatchTerms {
  /** Every name that may stand for the case's country. */
  readonly country: readonly string[];
  /** Every name that may stand for the case's purpose. */
  readonly purpose: readonly string[];
  /** Who the case is for, so a pack meant for other people is left out. */
  readonly traveller: TravellerMatchTerms;
}

/** How sure the match must be that the traveller is covered (see the module note). */
export type PackFit = 'certain' | 'possible';

export interface PackMatch {
  readonly packVersionId: string;
  readonly packName: string;
  readonly version: number;
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

/** The common accent marks (U+0300 to U+036F), which the database strips like `packMatchKey`. */
const COMBINING_MARKS = `[${String.fromCodePoint(0x300)}-${String.fromCodePoint(0x36f)}]`;

/**
 * `packMatchKey` worked out by the database, so only matching packs are read. It strips the
 * common accent block; a label with a rarer mark keys differently and is simply not linked, which
 * leaves the choice with the person.
 */
function sqlMatchKey(column: AnyPgColumn): SQL<string> {
  return sql<string>`btrim(regexp_replace(lower(regexp_replace(normalize(${column}, NFD), ${COMBINING_MARKS}, '', 'g')), '[^a-z0-9]+', ' ', 'g'))`;
}

function keySet(terms: readonly string[]): ReadonlySet<string> {
  return new Set(terms.map(packMatchKey).filter((key) => key.length > 0));
}

/** Whether a pack's list of who it is for admits this traveller. */
function admits(
  list: readonly string[] | null,
  traveller: ReadonlySet<string>,
  fit: PackFit,
): boolean {
  const named = keySet(list ?? []);
  if (named.size === 0) return true;
  if (traveller.size === 0) return fit === 'possible';
  for (const key of traveller) if (named.has(key)) return true;
  return false;
}

/**
 * Every published catalogue pack that fits this country, purpose and traveller, newest version of
 * each, in name order.
 */
export async function listFittingPublicPacks(
  db: Db,
  terms: PackMatchTerms,
  fit: PackFit,
): Promise<PackMatch[]> {
  const countries = keySet(terms.country);
  const purposes = keySet(terms.purpose);
  if (countries.size === 0 || purposes.size === 0) return [];
  const nationality = keySet(terms.traveller.nationality);
  const residence = keySet(terms.traveller.residence);

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
        isNull(schema.packs.ownerOrganizationId),
        isNotNull(schema.packs.jurisdiction),
        isNotNull(schema.packs.purpose),
        inArray(sqlMatchKey(schema.packs.jurisdiction), [...countries]),
        inArray(sqlMatchKey(schema.packs.purpose), [...purposes]),
      ),
    )
    // The newest published version of each pack is its current checklist.
    .orderBy(schema.packVersions.packId, desc(schema.packVersions.version));

  return rows
    .filter(
      (row) =>
        // The database narrowed the rows; the same rule decides here, so the two never disagree.
        row.jurisdiction !== null &&
        row.purpose !== null &&
        countries.has(packMatchKey(row.jurisdiction)) &&
        purposes.has(packMatchKey(row.purpose)) &&
        admits(row.nationalityApplicability, nationality, fit) &&
        admits(row.residenceApplicability, residence, fit),
    )
    .map((row) => ({
      packVersionId: row.packVersionId,
      packName: row.packName,
      version: row.version,
    }))
    .sort((a, b) => a.packName.localeCompare(b.packName, 'en'));
}

/**
 * The one published catalogue pack that certainly covers this country, purpose and traveller, or
 * null. None, or two different packs, returns null, so the person picks the checklist themselves:
 * guessing between routes would put the wrong list in front of them.
 */
export async function findMatchingPublicPack(
  db: Db,
  terms: PackMatchTerms,
): Promise<PackMatch | null> {
  const fitting = await listFittingPublicPacks(db, terms, 'certain');
  return fitting.length === 1 ? (fitting[0] ?? null) : null;
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
