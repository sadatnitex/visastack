import { type Result, err, ok } from '@visastack/core';
import { and, gte, inArray, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { type Db, first, schema } from './db';
import type { ServiceError } from './errors';
import { isMissingRelationError } from './missing-relation';

/**
 * The staff count of AI app connections (ADR 0021 section 7, S16), for the AI Settings page.
 *
 * Totals only, across the whole platform: how many connections are live, how many were turned
 * off, and how many context calls were answered or refused in the last seven days (from the
 * `AI_CONTEXT_SERVED` and `AI_CONTEXT_DENIED` audit records). Nothing about any one person, app,
 * record or case is returned, so the card cannot show per-person data even by mistake.
 *
 * Security admins only (`AI_SETTINGS_MANAGE`, the AI Settings page's own action), with a fresh,
 * genuine staff scope. Until the AI connection tables exist (their migration has not run), the
 * answer is "not available yet" rather than an error.
 */

/** How far back the call counts look. */
export const AI_CONNECTION_COUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type AiConnectionCounts =
  | {
      readonly available: true;
      /** Activated, not turned off and not past their end. */
      readonly active: number;
      /** Turned off at any time (by the person, or ended for them). */
      readonly turnedOff: number;
      /** Context calls answered in the last seven days. */
      readonly served: number;
      /** Context calls refused in the last seven days. */
      readonly denied: number;
      readonly since: Date;
    }
  | { readonly available: false };

export async function getAiConnectionCounts(
  db: Db,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
  now: Date = new Date(),
): Promise<Result<AiConnectionCounts, ServiceError>> {
  const problem = staffScopeProblem(staff, 'AI_SETTINGS_MANAGE');
  if (problem) return err(problem);
  const since = new Date(now.getTime() - AI_CONNECTION_COUNT_WINDOW_MS);
  const connections = schema.aiConnections;
  const audit = schema.auditEvents;
  try {
    const [totals, calls] = await Promise.all([
      db
        .select({
          active: sql<string>`count(*) filter (where ${connections.revokedAt} is null and ${connections.activatedAt} is not null and (${connections.expiresAt} is null or ${connections.expiresAt} > ${now.toISOString()}::timestamptz))`,
          turnedOff: sql<string>`count(*) filter (where ${connections.revokedAt} is not null)`,
        })
        .from(connections),
      db
        .select({ eventType: audit.eventType, total: sql<string>`count(*)` })
        .from(audit)
        .where(
          and(
            inArray(audit.eventType, ['AI_CONTEXT_SERVED', 'AI_CONTEXT_DENIED']),
            gte(audit.occurredAt, since),
          ),
        )
        .groupBy(audit.eventType),
    ]);
    const row = first(totals);
    const callsOf = (eventType: string) =>
      Number(calls.find((call) => call.eventType === eventType)?.total ?? 0);
    return ok({
      available: true,
      active: Number(row?.active ?? 0),
      turnedOff: Number(row?.turnedOff ?? 0),
      served: callsOf('AI_CONTEXT_SERVED'),
      denied: callsOf('AI_CONTEXT_DENIED'),
      since,
    });
  } catch (error) {
    if (isMissingRelationError(error)) return ok({ available: false });
    throw error;
  }
}
