import { sql } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * Pilot product events (Build Spec §14/§23-25 — privacy-preserving usage
 * measurement).
 *
 * A minimal, append-only log of known funnel milestones: which one, when,
 * and by which account. No free-text property bag and no PII — the
 * `accountId` is the same opaque identifier already used throughout the
 * audit trail, never the email. This exists to give the pilot a real,
 * bounded scorecard (signups, applicants, uploads, missions, grants, AI
 * runs) — not a general-purpose analytics/telemetry system.
 */

export const PRODUCT_EVENT_TYPES = [
  'ACCOUNT_CREATED',
  'APPLICANT_CREATED',
  'DOCUMENT_UPLOADED',
  'MISSION_CREATED',
  'GRANT_CREATED',
  'AI_EXTRACTION_RUN',
  'AI_OCR_RUN',
] as const;

export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

export interface RecordProductEventInput {
  readonly eventType: ProductEventType;
  readonly accountId: string | null;
}

/** Append one funnel event. Callers pass the same `tx` as their own write so it commits atomically with it. */
export async function recordProductEvent(db: Db, input: RecordProductEventInput): Promise<void> {
  await db.insert(schema.productEvents).values({
    eventType: input.eventType,
    accountId: input.accountId,
  });
}

export interface PilotScorecardRow {
  readonly eventType: ProductEventType;
  readonly total: number;
  readonly last7Days: number;
}

/**
 * One row per known event type (present even at zero, so the admin scorecard
 * never silently omits a milestone that hasn't happened yet in the pilot).
 */
export async function getPilotScorecard(
  db: Db,
  now: Date = new Date(),
): Promise<PilotScorecardRow[]> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      eventType: schema.productEvents.eventType,
      total: sql<string>`count(*)`,
      last7Days: sql<string>`count(*) filter (where ${schema.productEvents.occurredAt} >= ${since.toISOString()})`,
    })
    .from(schema.productEvents)
    .groupBy(schema.productEvents.eventType);

  const byType = new Map(rows.map((row) => [row.eventType, row]));
  return PRODUCT_EVENT_TYPES.map((eventType) => {
    const row = byType.get(eventType);
    return {
      eventType,
      total: Number(row?.total ?? 0),
      last7Days: Number(row?.last7Days ?? 0),
    };
  });
}
