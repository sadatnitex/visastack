import { type SQL, and, not, sql } from 'drizzle-orm';
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

/**
 * A suggestion an AI app made through its connection (S21, ADR 0021 extension): the same zero-cost
 * run pattern, with the model version `connector:<app's address>` and the prompt version
 * `connection:<connection id>`. VisaStack made no AI call for it, so it is kept out of every AI
 * count, cost report and attempt limit too, and it never stops the automatic reading of a document.
 */
export const CONNECTOR_MODEL_PREFIX = 'connector:';
export const CONNECTION_PROMPT_PREFIX = 'connection:';

export function connectorModelVersion(clientHost: string): string {
  return `${CONNECTOR_MODEL_PREFIX}${clientHost}`;
}

export function connectionPromptVersion(connectionId: string): string {
  return `${CONNECTION_PROMPT_PREFIX}${connectionId}`;
}

export function isDeterministicModelVersion(modelVersion: string | null | undefined): boolean {
  return typeof modelVersion === 'string' && modelVersion.startsWith(DETERMINISTIC_MODEL_PREFIX);
}

export function isConnectorModelVersion(modelVersion: string | null | undefined): boolean {
  return typeof modelVersion === 'string' && modelVersion.startsWith(CONNECTOR_MODEL_PREFIX);
}

/** The connection a connector run came from, or null for any other run. */
export function connectionIdOfRun(run: {
  readonly modelVersion: string;
  readonly promptVersion: string;
}): string | null {
  if (!isConnectorModelVersion(run.modelVersion)) return null;
  if (!run.promptVersion.startsWith(CONNECTION_PROMPT_PREFIX)) return null;
  const id = run.promptVersion.slice(CONNECTION_PROMPT_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** SQL for "this run was an AI app's suggestion", on a `model_version` column. */
export function connectorRunsOnly(modelVersion: PgColumn): SQL {
  return sql`${modelVersion} like ${`${CONNECTOR_MODEL_PREFIX}%`}`;
}

/**
 * SQL for "this run was an AI call VisaStack made", on a `model_version` column. Every AI count,
 * spend sum and failure rate over `ai_extraction_runs` applies it, so neither a rule-based run nor
 * an AI app's suggestion ever looks like AI use.
 */
export function excludingDeterministicRuns(modelVersion: PgColumn): SQL {
  return and(
    not(sql`${modelVersion} like ${`${DETERMINISTIC_MODEL_PREFIX}%`}`),
    not(connectorRunsOnly(modelVersion)),
  ) as SQL;
}
