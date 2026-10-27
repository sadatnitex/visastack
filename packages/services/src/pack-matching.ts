import { and, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * Which published checklist fits a new case (owner list item 1, 26 Oct 2026).
 *
 * A pack describes the route it covers with two free-text labels, `jurisdiction` ("UK",
 * "United Kingdom", "GB") and `purpose` ("tourism", "Tourism"). A case knows its country and
 * purpose from the pickers on the new-case form. The caller passes every name that may stand for
 * each (a country's code, its name and other common names; a purpose's key and its label) and a
 * pack fits when both of its labels equal one of those names, ignoring case, accents and
 * punctuation.
 *
 * It answers only when exactly one pack fits. None, or two different packs, returns null, so the
 * person picks the checklist themselves: guessing between routes would put the wrong list in front
 * of them. A pack an agency made for its own clients is never offered here, and neither is a pack
 * whose coverage was never filled in (unset means "not yet classified", never "applies to all").
 *
 * Reads only the pack catalogue, which holds no applicant data; attaching the pack stays with the
 * existing owner-checked `attachPackVersion`.
 */

export interface PackMatchTerms {
  /** Every name that may stand for the case's country. */
  readonly country: readonly string[];
  /** Every name that may stand for the case's purpose. */
  readonly purpose: readonly string[];
}

export interface PackMatch {
  readonly packVersionId: string;
  readonly packName: string;
  readonly version: number;
}

/** A label reduced to lower-case letters and digits separated by single spaces. */
export function packMatchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function keySet(terms: readonly string[]): ReadonlySet<string> {
  return new Set(terms.map(packMatchKey).filter((key) => key.length > 0));
}

/** The one published catalogue pack that covers this country and purpose, or null. */
export async function findMatchingPublicPack(
  db: Db,
  terms: PackMatchTerms,
): Promise<PackMatch | null> {
  const countries = keySet(terms.country);
  const purposes = keySet(terms.purpose);
  if (countries.size === 0 || purposes.size === 0) return null;

  const rows = await db
    .select({
      packId: schema.packs.id,
      packName: schema.packs.name,
      jurisdiction: schema.packs.jurisdiction,
      purpose: schema.packs.purpose,
      packVersionId: schema.packVersions.id,
      version: schema.packVersions.version,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(eq(schema.packVersions.status, 'PUBLISHED'), isNull(schema.packs.ownerOrganizationId)),
    );

  const fitting = rows.filter(
    (row) =>
      row.jurisdiction !== null &&
      row.purpose !== null &&
      countries.has(packMatchKey(row.jurisdiction)) &&
      purposes.has(packMatchKey(row.purpose)),
  );
  if (new Set(fitting.map((row) => row.packId)).size !== 1) return null;
  // Several published versions of the one pack: the newest is the current checklist.
  const newest = fitting.reduce((best, row) => (row.version > best.version ? row : best));
  return {
    packVersionId: newest.packVersionId,
    packName: newest.packName,
    version: newest.version,
  };
}
