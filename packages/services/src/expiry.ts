import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * The Expiry Centre (NTF-01, Part 5 §1): "Track separately: intrinsic
 * expiry; case-specific freshness/staleness; verification expiry where
 * relevant." Three distinct, independently-computed classifications below,
 * deliberately never merged into one status - mirrors the directive's own
 * examples ("passport expiry = intrinsic; bank statement too old for route =
 * requirement-specific staleness") and its "never mutate the document's
 * intrinsic validity to represent a route rule."
 *
 * Every function here is pure (an explicit `now`, never `new Date()`
 * internally) so classification is deterministic and unit-testable without a
 * database.
 */

/** "Default expiry reminder thresholds: 90; 60; 30; 7; expiry date." */
export const DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS: readonly number[] = [90, 60, 30, 7, 0];

export type ExpiryUrgency = 'unknown' | 'ok' | 'reminder' | 'expired';

export interface ExpiryClassification {
  readonly urgency: ExpiryUrgency;
  /** Whole days until the date; negative once past. `null` only when `urgency` is `unknown`. */
  readonly daysRemaining: number | null;
  /**
   * The smallest configured threshold still `>=` daysRemaining - i.e. the
   * reminder window currently in effect. Meaningful only while
   * `urgency === 'reminder'`; `null` otherwise. A future outbox worker
   * (Part 5 §3) uses this as part of a reminder's idempotency key ("event;
   * recipient; channel; threshold where applicable") so each threshold
   * fires at most once.
   */
  readonly thresholdCrossed: number | null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Classify a future-dated expiry (intrinsic document expiry, or issuer
 * verification `validUntil`) against a reminder-threshold ladder.
 * "Unknown expiry remains unknown" - a `null` date is never guessed at.
 */
export function classifyExpiry(
  date: Date | null,
  now: Date,
  thresholds: readonly number[] = DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS,
): ExpiryClassification {
  if (!date) return { urgency: 'unknown', daysRemaining: null, thresholdCrossed: null };

  const daysRemaining = daysBetween(now, date);
  if (daysRemaining < 0) return { urgency: 'expired', daysRemaining, thresholdCrossed: null };

  const maxThreshold = thresholds.length > 0 ? Math.max(...thresholds) : 0;
  if (daysRemaining > maxThreshold) return { urgency: 'ok', daysRemaining, thresholdCrossed: null };

  const crossed = [...thresholds].filter((t) => t >= daysRemaining).sort((a, b) => a - b)[0];
  return { urgency: 'reminder', daysRemaining, thresholdCrossed: crossed ?? 0 };
}

export type StalenessStatus = 'not_applicable' | 'unknown' | 'fresh' | 'stale';

export interface StalenessClassification {
  readonly status: StalenessStatus;
  /** Whole days since the document's own date. `null` unless both a rule and a date exist. */
  readonly ageDays: number | null;
}

/**
 * Classify case-specific/route freshness: does this piece of evidence's OWN
 * date fall inside the requirement's `maxAgeDays` window? Distinct from
 * `classifyExpiry` on purpose - this is an age-since-issued rule, not a
 * countdown to a future expiry date, and it lives on the requirement
 * (`packRequirements.maxAgeDays`), never on the document.
 *
 * `not_applicable`: the requirement carries no freshness rule at all.
 * `unknown`: a rule exists but the document's own date was never recorded -
 * "do not fabricate dates" means this is surfaced, not guessed, and (by
 * design) does not by itself block the requirement from being satisfied.
 * `stale`: a rule exists, the date is known, and it is outside the window -
 * this DOES block the requirement from being satisfied (missions.ts).
 */
export function classifyStaleness(
  documentDate: Date | null,
  maxAgeDays: number | null,
  now: Date,
): StalenessClassification {
  if (maxAgeDays === null) return { status: 'not_applicable', ageDays: null };
  if (!documentDate) return { status: 'unknown', ageDays: null };
  const ageDays = daysBetween(documentDate, now);
  return { status: ageDays > maxAgeDays ? 'stale' : 'fresh', ageDays };
}

/** Strict `YYYY-MM-DD`, never in the future relative to `now` (a document cannot be dated ahead of today). */
const DOCUMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a stored `documents.documentDate`/`issuer_verifications`-style plain
 * date string. Returns `null` for anything absent or malformed rather than
 * throwing - a defensively-unknown date, never a fabricated one.
 */
export function parseDocumentDate(raw: string | null | undefined): Date | null {
  if (!raw || !DOCUMENT_DATE_PATTERN.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Validates a caller-supplied date string before it is ever stored (write-side counterpart to `parseDocumentDate`). */
export function isValidDocumentDateString(raw: string, now: Date = new Date()): boolean {
  const parsed = parseDocumentDate(raw);
  return parsed !== null && parsed.getTime() <= now.getTime();
}

export interface DocumentExpiryPolicy {
  readonly id: string;
  readonly docType: string;
  readonly thresholdDays: readonly number[];
}

/** The configured reminder-threshold ladder for a docType, or the platform default when none is configured. */
export async function getReminderThresholds(
  db: Db,
  docType: string | null,
): Promise<readonly number[]> {
  if (!docType) return DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS;
  const row = first(
    await db
      .select({ thresholdDays: schema.documentExpiryPolicies.thresholdDays })
      .from(schema.documentExpiryPolicies)
      .where(eq(schema.documentExpiryPolicies.docType, docType))
      .limit(1),
  );
  return row ? row.thresholdDays : DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS;
}

/** Every configured per-docType override (admin view). */
export async function listDocumentExpiryPolicies(db: Db): Promise<DocumentExpiryPolicy[]> {
  return db
    .select()
    .from(schema.documentExpiryPolicies)
    .orderBy(schema.documentExpiryPolicies.docType);
}

/**
 * Set (or replace) the reminder-threshold ladder for a docType. Reached only
 * from an already `PACK_MANAGE`-gated admin action (matching
 * `packs.ts`'s `addRequirement`, which likewise trusts its caller) - no
 * platform-role check is repeated here.
 */
export async function setDocumentExpiryPolicy(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly docType: string;
    readonly thresholdDays: readonly number[];
  },
): Promise<Result<DocumentExpiryPolicy, ServiceError>> {
  const docType = input.docType.trim();
  if (docType.length === 0) return err(serviceError('invalid', 'docType is required'));
  const thresholdDays = [...new Set(input.thresholdDays)].sort((a, b) => b - a);
  if (thresholdDays.length === 0 || thresholdDays.some((t) => !Number.isInteger(t) || t < 0)) {
    return err(serviceError('invalid', 'thresholdDays must be non-negative integers'));
  }

  return db.transaction(async (tx) => {
    const existing = first(
      await tx
        .select({ id: schema.documentExpiryPolicies.id })
        .from(schema.documentExpiryPolicies)
        .where(eq(schema.documentExpiryPolicies.docType, docType))
        .limit(1),
    );
    const row = existing
      ? first(
          await tx
            .update(schema.documentExpiryPolicies)
            .set({ thresholdDays: [...thresholdDays], updatedAt: new Date() })
            .where(eq(schema.documentExpiryPolicies.id, existing.id))
            .returning(),
        )
      : first(
          await tx
            .insert(schema.documentExpiryPolicies)
            .values({ docType, thresholdDays: [...thresholdDays] })
            .returning(),
        );
    if (!row) return err(serviceError('invalid', 'failed to save expiry policy'));

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_EXPIRY_POLICY_SET',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'document_expiry_policy',
      resourceId: row.id,
      metadata: { docType, thresholdDays },
    });
    return ok({ id: row.id, docType: row.docType, thresholdDays: row.thresholdDays });
  });
}
