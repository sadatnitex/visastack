/**
 * The owner's blanket approval of 2026-11-12 (data/drafts/OWNER_DECISIONS.json, key
 * release_blanket_approval_2026-11-12), as data the register builder and the CSV updater share.
 *
 * The approved groups are exactly those marked RELEASED in
 * data/RELEASE_CLASSIFICATION_2026-11-12.json. The approval was given without a line-by-line reading
 * of the Bengali, so the state says so and `reviewed` stays NO.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CLASSIFICATION_REL = 'docs/localization/data/RELEASE_CLASSIFICATION_2026-11-12.json';
export const APPROVED_REVIEW_STATE = 'OWNER_BLANKET_APPROVED_2026-11-12';
export const APPROVED_RELEASE_STATE = 'RELEASED_ON_OWNER_BLANKET_APPROVAL_2026-11-12';
export const APPROVED_SIGN_OFF = 'owner (blanket approval, no line-by-line reading)';
export const APPROVED_DATE = '2026-11-12';

export function loadClassification(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, CLASSIFICATION_REL), 'utf8'));
}

/** Groups whose Bengali ships on the blanket approval. */
export function approvedGroups(root = ROOT) {
  return new Set(
    loadClassification(root)
      .groups.filter((g) => g.state === 'RELEASED')
      .map((g) => g.group),
  );
}

/** The state columns of a register row, given its group and the values it would have had. */
export function registerStates(group, approved, fallback) {
  if (approved.has(group))
    return { review_state: APPROVED_REVIEW_STATE, release_state: APPROVED_RELEASE_STATE };
  // A group taken out of the approved set goes back to its unreviewed state.
  return fallback.review_state === APPROVED_REVIEW_STATE
    ? { review_state: 'ASSIGNED_NOT_REVIEWED', release_state: 'DRAFT_NOT_FOR_RELEASE' }
    : fallback;
}

/** The sign-off columns of a review-queue row. */
export function queueStates(group, approved, fallback) {
  if (approved.has(group))
    return {
      review_state: APPROVED_REVIEW_STATE,
      reviewer_sign_off: APPROVED_SIGN_OFF,
      sign_off_date: APPROVED_DATE,
    };
  return fallback.review_state === APPROVED_REVIEW_STATE
    ? { review_state: 'ASSIGNED_NOT_REVIEWED', reviewer_sign_off: '', sign_off_date: '' }
    : fallback;
}
