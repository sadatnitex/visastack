import 'server-only';
import { after } from 'next/server';

/** Each server instance asks at most this often; the database counter then allows one per minute overall. */
const LOCAL_GAP_MS = 60_000;
let lastAsked = 0;

/**
 * After this response is sent, give waiting emails a short sending pass (see `drainWaitingEmails`).
 * Costs the person nothing: it runs after their page is delivered, and most calls stop at the
 * in-memory check without touching the database.
 */
export function sendWaitingEmailsSoon(now: number = Date.now()): void {
  if (now - lastAsked < LOCAL_GAP_MS) return;
  lastAsked = now;
  try {
    // Loaded only when needed, so a signed-in page never pulls the job code into its own path.
    after(async () => (await import('./jobs')).drainWaitingEmails());
  } catch {
    // Outside a request (a script or a test): nothing to piggyback on.
  }
}
