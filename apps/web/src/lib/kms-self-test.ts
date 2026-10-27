import 'server-only';
import { createKeyManagementPort } from './providers';

/**
 * Whether the configured key service really works: it wraps and opens a throwaway key with the
 * configured key id and credentials (S26). Run when readiness is evaluated and remembered, so a
 * busy status page does not call the key service each time. Fail-closed and never throwing:
 * until a run has passed, or after one fails (including a port that cannot even be built), the
 * answer is no. A pass is remembered for five minutes; a failure only for thirty seconds, so one
 * blip does not hold readiness down. Overlapping runs share one call. The synchronous readiness
 * gates read the last answer; they never call out themselves.
 */

const REMEMBER_PASS_MS = 5 * 60 * 1000;
const REMEMBER_FAIL_MS = 30 * 1000;
let last: { readonly at: number; readonly ok: boolean } | null = null;
let inFlight: Promise<boolean> | null = null;

interface SelfTestable {
  selfTest(): Promise<boolean>;
}

function canSelfTest(port: unknown): port is SelfTestable {
  return typeof (port as Partial<SelfTestable> | undefined)?.selfTest === 'function';
}

async function attempt(): Promise<boolean> {
  try {
    const port = createKeyManagementPort();
    return canSelfTest(port) ? await port.selfTest() : false;
  } catch {
    // For example the local key refusing commercial mode, or an unknown provider name.
    return false;
  }
}

export async function runKmsSelfTest(now: number = Date.now()): Promise<boolean> {
  if (last && now - last.at < (last.ok ? REMEMBER_PASS_MS : REMEMBER_FAIL_MS)) return last.ok;
  if (!inFlight) {
    inFlight = attempt()
      .then((ok) => {
        last = { at: now, ok };
        return ok;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * The answer of the latest run; false until one has passed, and false again once a pass is older
 * than it is trusted for, so a warm instance cannot keep reporting a pass after access is lost.
 */
export function kmsSelfTestPassed(now: number = Date.now()): boolean {
  return last?.ok === true && now - last.at < REMEMBER_PASS_MS;
}
