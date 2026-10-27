import { type SQL, not, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Runs recorded without any AI call (S5, ADR 0019): a reading done by fixed rules, such as the
 * passport's machine-readable lines, is stored through the same suggestion tables as an AI
 * reading, as a zero-cost run whose model version starts with this prefix. It lets
 * `field_proposals.ai_extraction_run_id` stay required without a migration, and it is the one rule
 * that keeps such a run out of every AI count, cost report and attempt limit.
 */
export const DETERMINISTIC_MODEL_PREFIX = 'deterministic:';

/** The reader for a passport's machine-readable lines. Bump the number when the mapping changes. */
export const MRZ_TD3_MODEL_VERSION = `${DETERMINISTIC_MODEL_PREFIX}mrz-td3/1`;

export function isDeterministicModelVersion(modelVersion: string | null | undefined): boolean {
  return typeof modelVersion === 'string' && modelVersion.startsWith(DETERMINISTIC_MODEL_PREFIX);
}

/**
 * SQL for "this run was an AI call", on a `model_version` column. Every AI count, spend sum and
 * failure rate over `ai_extraction_runs` applies it, so a rule-based run never looks like AI use.
 */
export function excludingDeterministicRuns(modelVersion: PgColumn): SQL {
  return not(sql`${modelVersion} like ${`${DETERMINISTIC_MODEL_PREFIX}%`}`);
}
