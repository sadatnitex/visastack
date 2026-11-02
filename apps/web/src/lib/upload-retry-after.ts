import { RATE_LIMITS } from '@visastack/services';

// Kept out of the route file: a Next.js route module may only export route fields.

/** The longest wait ever asked for: the whole window, when the wait cannot be worked out. */
const SAFE_RETRY_AFTER_SECONDS = 3600;

/**
 * Seconds until the hourly upload window frees up. The limit counts in fixed windows (each one
 * starts at a multiple of its length), so the wait is what is left of the current one.
 */
export function uploadRetryAfterSeconds(now: number = Date.now()): number {
  const windowMs = RATE_LIMITS?.UPLOAD_RESERVE?.windowMs;
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) {
    return SAFE_RETRY_AFTER_SECONDS;
  }
  const left = Math.ceil((windowMs - (now % windowMs)) / 1000);
  return Math.min(SAFE_RETRY_AFTER_SECONDS, Math.max(1, left));
}
