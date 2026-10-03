import { type Db, schema } from './db';
import type { RateLimitConfig } from './rate-limit';

/**
 * Test-only helper (not exported from the package index): put a rate-limit
 * counter exactly AT its limit, so the very next real call for that
 * subject/action is refused. Proves a limit is wired without looping hundreds
 * of real calls through a slow in-memory database.
 *
 * Seeds the current window AND the next one, so a test that happens to run
 * across a window boundary cannot flake: whichever window the real call lands
 * in is already full.
 */
export async function exhaustRateLimit(
  db: Db,
  subjectId: string,
  action: string,
  config: RateLimitConfig,
  now: Date = new Date(),
): Promise<void> {
  const currentWindow = Math.floor(now.getTime() / config.windowMs) * config.windowMs;
  for (const windowStart of [currentWindow, currentWindow + config.windowMs]) {
    await db
      .insert(schema.rateLimitBuckets)
      .values({ subjectId, action, windowStart: new Date(windowStart), count: config.limit })
      .onConflictDoUpdate({
        target: [
          schema.rateLimitBuckets.subjectId,
          schema.rateLimitBuckets.action,
          schema.rateLimitBuckets.windowStart,
        ],
        set: { count: config.limit },
      });
  }
}
