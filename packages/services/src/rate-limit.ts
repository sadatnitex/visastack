import { sql } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * Application-level rate limiting (Build Spec §14 — usage controls /
 * anti-automation), for the pilot's genuinely abuse-prone actions: creating
 * grants (an email-addressed invite a script could spam) and requesting
 * evidence (an agency-side action that reaches into an applicant's workspace).
 *
 * Fixed-window counters stored in Postgres — no Redis, matching the same
 * no-external-dependency posture as the Neon-bytea blob store and the upload
 * quotas. A single atomic upsert increments the counter for the current
 * window, so concurrent requests can't race past the limit via a separate
 * read-then-write.
 */

export interface RateLimitConfig {
  readonly limit: number;
  readonly windowMs: number;
}

/** Pilot defaults: generous enough that no real user should ever notice. */
export const RATE_LIMITS = {
  GRANT_CREATE: { limit: 20, windowMs: 60 * 60 * 1000 },
  EVIDENCE_REQUEST: { limit: 50, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export interface CheckRateLimitInput {
  readonly subjectId: string;
  readonly action: string;
}

/**
 * Increment the counter for (subjectId, action, current window) and report
 * whether it stays within `config.limit`. Fails open on the side of counting:
 * once a window's count exceeds the limit, every further call in that window
 * is refused, including this one's own increment — so the stored count can
 * exceed the limit slightly, but the caller is never allowed through.
 */
export async function checkRateLimit(
  db: Db,
  input: CheckRateLimitInput,
  config: RateLimitConfig,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const windowStart = windowStartFor(now, config.windowMs);
  const rows = await db
    .insert(schema.rateLimitBuckets)
    .values({ subjectId: input.subjectId, action: input.action, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [
        schema.rateLimitBuckets.subjectId,
        schema.rateLimitBuckets.action,
        schema.rateLimitBuckets.windowStart,
      ],
      set: {
        count: sql`${schema.rateLimitBuckets.count} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ count: schema.rateLimitBuckets.count });
  const count = rows[0]?.count ?? 1;
  if (count > config.limit) {
    return {
      allowed: false,
      reason: `too many ${input.action.replace('.', ' ')} actions in a short time — please try again later`,
    };
  }
  return { allowed: true };
}
