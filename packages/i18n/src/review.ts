import type { ReviewArea } from './catalog';
import { CATALOG_LIST, type CatalogId } from './messages';

/**
 * Where each catalog's Bangla stands on professional review (directive Part 9
 * section 4: "if professional legal/privacy translation review is required,
 * mark it explicitly before public launch").
 *
 * A catalog whose `review` list is not empty makes statements a traveller may
 * rely on: what they consented to, what happens to their data, what a readiness
 * result does and does not mean. Its Bangla was drafted in-house and has not
 * been checked by a qualified Bangla-speaking professional. This file is the
 * record of when that changes.
 *
 * To record a review, add the catalog id here with who reviewed it, when, and
 * which areas they covered. That is a normal commit, so the sign-off is in the
 * history with its date and author. Until every catalog that needs a review has
 * an entry covering all its areas, the commercial readiness gate
 * `banglaTranslationReview` stays closed and Bangla screens that carry such text
 * show a notice saying so.
 */
export interface BanglaReviewRecord {
  /** The professional's name and role, as the organisation that engaged them records it. */
  readonly reviewer: string;
  /** ISO date (YYYY-MM-DD) the review was completed. */
  readonly reviewedOn: string;
  /** The areas this review covered; must include every area the catalog lists. */
  readonly areas: readonly ReviewArea[];
}

export const BANGLA_REVIEW_RECORDS: Readonly<Partial<Record<CatalogId, BanglaReviewRecord>>> = {};

/** The review areas a catalog's Bangla needs, empty when it is ordinary copy. */
export function reviewAreasFor(id: CatalogId): readonly ReviewArea[] {
  return CATALOG_LIST.find((catalog) => catalog.meta.id === id)?.meta.review ?? [];
}

/** True when the catalog's Bangla needs a professional review that has not been recorded. */
export function isBanglaReviewPending(
  id: CatalogId,
  records: Readonly<Partial<Record<CatalogId, BanglaReviewRecord>>> = BANGLA_REVIEW_RECORDS,
): boolean {
  const needed = reviewAreasFor(id);
  if (needed.length === 0) return false;
  const record = records[id];
  if (!record) return true;
  return !needed.every((area) => record.areas.includes(area));
}

/** Every catalog still waiting for a professional review of its Bangla. */
export function banglaReviewPending(
  records: Readonly<Partial<Record<CatalogId, BanglaReviewRecord>>> = BANGLA_REVIEW_RECORDS,
): readonly CatalogId[] {
  return CATALOG_LIST.map((catalog) => catalog.meta.id).filter((id) =>
    isBanglaReviewPending(id, records),
  );
}
