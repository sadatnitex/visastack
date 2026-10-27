import { and, eq, lt, sql } from 'drizzle-orm';
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pilot defaults: generous enough that no real user should ever notice.
 *
 * Every number here is an UNMEASURED starting default, not a figure derived
 * from observed traffic -- the pilot has no production load data yet (Part 9
 * §9's load work is what would justify tuning them). They live in one place
 * so a measured change is a one-line edit.
 *
 * The `_ORG` entries are a second, organization-wide bucket for flows an
 * agency's admins perform: the directive asks for "actor + appropriate
 * network/org dimensions" (Part 9 §6), and a per-actor cap alone lets several
 * admins of one organization (or one compromised admin set) collectively
 * exceed what the organization should plausibly do.
 */
export const RATE_LIMITS = {
  GRANT_CREATE: { limit: 20, windowMs: 60 * 60 * 1000 },
  EVIDENCE_REQUEST: { limit: 50, windowMs: 60 * 60 * 1000 },
  ORG_INVITATION_CREATE: { limit: 30, windowMs: HOUR_MS },
  ORG_INVITATION_CREATE_ORG: { limit: 100, windowMs: HOUR_MS },
  CLIENT_INVITATION_CREATE: { limit: 60, windowMs: HOUR_MS },
  CLIENT_INVITATION_CREATE_ORG: { limit: 200, windowMs: HOUR_MS },
  UPLOAD_RESERVE: { limit: 200, windowMs: HOUR_MS },
  /** WP-PH1: adding, replacing or removing a profile photo, all counted together (adding or replacing one decodes and re-encodes an image). */
  PROFILE_PHOTO_CHANGE: { limit: 30, windowMs: HOUR_MS },
  ACCOUNT_EXPORT: { limit: 5, windowMs: HOUR_MS },
  BULK_EXPORT: { limit: 10, windowMs: HOUR_MS },
  BULK_EXPORT_ORG: { limit: 20, windowMs: HOUR_MS },
  /**
   * Sign-in, sign-up and password recovery (public beta). Keyed by a hash of the address and by a
   * hash of the network address, so one person cannot lock out another and one source cannot
   * drain the daily email allowance. Unmeasured starting defaults, like the rest of this table.
   */
  AUTH_SIGN_IN_EMAIL: { limit: 10, windowMs: HOUR_MS },
  AUTH_SIGN_IN_IP: { limit: 60, windowMs: HOUR_MS },
  AUTH_SIGN_UP_IP: { limit: 10, windowMs: HOUR_MS },
  AUTH_SIGN_UP_EMAIL: { limit: 3, windowMs: HOUR_MS },
  AUTH_EMAIL_SEND_EMAIL: { limit: 3, windowMs: HOUR_MS },
  AUTH_EMAIL_SEND_IP: { limit: 10, windowMs: HOUR_MS },
  /** One shared bucket per actor across all five AI Gateway tasks (extraction, OCR, classification, explanation, inconsistency check). */
  AI_RUN: { limit: 150, windowMs: HOUR_MS },
  /**
   * Visa photo sizes: each request decodes and re-encodes an image, so it is bounded even though
   * ordinary downloads are not. Checks (opening the section) and sizes made have separate buckets,
   * so looking at a photo never uses up its downloads.
   */
  PHOTO_CHECK: { limit: 60, windowMs: HOUR_MS },
  PHOTO_SIZE: { limit: 120, windowMs: HOUR_MS },
  // Looking a record up by its visible reference code (ADR 0018), per account: well above real
  // use, far below what guessing codes would need.
  REFERENCE_LOOKUP: { limit: 60, windowMs: HOUR_MS },
  // Guesses at a staff member's authenticator or recovery code (S3). Counted before the code is
  // checked and given back on a correct one, so ordinary use never builds up and a burst of
  // parallel guesses is still bounded. Backup codes share both buckets.
  STAFF_FACTOR_ATTEMPT: { limit: 5, windowMs: 5 * 60 * 1000 },
  STAFF_FACTOR_ATTEMPT_DAY: { limit: 20, windowMs: 24 * HOUR_MS },
  // One audit row per lock window, so a stream of refused tries cannot flood the audit chain.
  STAFF_FACTOR_LOCK_AUDIT: { limit: 1, windowMs: 5 * 60 * 1000 },
  // The public client-invitation page and its logo (growth loop 1), per network address: a page
  // view is one use, the logo another, so these sit far above a person opening a link a few times.
  INVITATION_PREVIEW_IP: { limit: 60, windowMs: HOUR_MS },
  INVITATION_LOGO_IP: { limit: 120, windowMs: HOUR_MS },
  // Online payments (S11). The gateway's callbacks are open to the internet and authenticated only
  // by asking the gateway, so each one is bounded per network address, and each payment is bounded
  // by how often it may make VisaStack call the gateway. Starting a payment is bounded per person
  // and per agency. Refused callbacks are audited at most this often in total, so a stream of
  // junk cannot flood the audit chain.
  PAYMENT_CALLBACK_IP: { limit: 300, windowMs: HOUR_MS },
  PAYMENT_CALLBACK_TRAN: { limit: 30, windowMs: HOUR_MS },
  PAYMENT_REJECT_AUDIT: { limit: 30, windowMs: HOUR_MS },
  PAYMENT_START: { limit: 20, windowMs: HOUR_MS },
  PAYMENT_START_ORG: { limit: 60, windowMs: HOUR_MS },
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
  /**
   * A plain-language noun for the refusal message ("invitation", "upload").
   * `action` is an internal identifier (`org_invitation.create`) that must
   * never reach an ordinary traveller (Part 9 §1: hide internal vocabulary).
   * Omitted keeps the original message exactly, so existing callers and their
   * tests are unaffected.
   */
  readonly label?: string;
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
  if (count > config.limit && input.label !== undefined) {
    return {
      allowed: false,
      reason: `too many ${input.label} requests in a short time - please try again later`,
    };
  }
  if (count > config.limit) {
    return {
      allowed: false,
      reason: `too many ${input.action.replace('.', ' ')} actions in a short time — please try again later`,
    };
  }
  return { allowed: true };
}

/**
 * Give one count back for the current window, never below zero. For limits that only mean to
 * bound failures: the attempt is counted before it is checked (so parallel guesses cannot all
 * slip through), and a success returns its count.
 */
export async function refundRateLimit(
  db: Db,
  input: CheckRateLimitInput,
  config: RateLimitConfig,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = windowStartFor(now, config.windowMs);
  await db
    .update(schema.rateLimitBuckets)
    .set({ count: sql`greatest(${schema.rateLimitBuckets.count} - 1, 0)`, updatedAt: sql`now()` })
    .where(
      and(
        eq(schema.rateLimitBuckets.subjectId, input.subjectId),
        eq(schema.rateLimitBuckets.action, input.action),
        eq(schema.rateLimitBuckets.windowStart, windowStart),
      ),
    );
}

export interface RateLimitCheck {
  readonly input: CheckRateLimitInput;
  readonly config: RateLimitConfig;
}

/**
 * Check several buckets in order (actor first, then organization) and return
 * the first refusal. Deliberately short-circuits: once the actor's own bucket
 * refuses, the organization's shared bucket is NOT incremented, so one abusive
 * member can never spend the rest of their organization's allowance by
 * hammering a limit they have already hit.
 */
export async function checkRateLimits(
  db: Db,
  checks: readonly RateLimitCheck[],
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  for (const check of checks) {
    const decision = await checkRateLimit(db, check.input, check.config, now);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}

/**
 * Counters are only ever read for their own window, so once a window has
 * ended its row is dead weight. Nothing previously removed them (the only
 * delete was account erasure), which was tolerable with two low-volume limits
 * but not with the broader set above. 48h is twice the longest configured
 * window (the 24h staff code limit), so a bucket still in use is never pruned.
 */
export const RATE_LIMIT_BUCKET_RETENTION_MS = 48 * HOUR_MS;

/** Delete counters whose window ended more than the retention period ago. Returns how many were removed. */
export async function pruneExpiredRateLimitBuckets(
  db: Db,
  now: Date = new Date(),
  retentionMs: number = RATE_LIMIT_BUCKET_RETENTION_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionMs);
  const deleted = await db
    .delete(schema.rateLimitBuckets)
    .where(lt(schema.rateLimitBuckets.windowStart, cutoff))
    .returning({ id: schema.rateLimitBuckets.id });
  return deleted.length;
}
