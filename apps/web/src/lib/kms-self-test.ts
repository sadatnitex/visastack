import 'server-only';
import { createKeyManagementPort } from './providers';

/**
 * Whether the configured key service really works: it wraps and opens a throwaway key with the
 * configured key id and credentials (S26). Run when readiness is evaluated, remembered for a few
 * minutes so a busy status page does not call the key service each time, and fail-closed: until
 * a run has passed, or after one fails, the answer is no. The synchronous readiness gates read
 * the last answer; they never call out themselves.
 */

const REMEMBER_MS = 5 * 60 * 1000;
let last: { readonly at: number; readonly ok: boolean } | null = null;

interface SelfTestable {
  selfTest(): Promise<boolean>;
}

function canSelfTest(port: unknown): port is SelfTestable {
  return typeof (port as Partial<SelfTestable> | undefined)?.selfTest === 'function';
}

export async function runKmsSelfTest(now: number = Date.now()): Promise<boolean> {
  if (last && now - last.at < REMEMBER_MS) return last.ok;
  const port = createKeyManagementPort();
  const ok = canSelfTest(port) ? await port.selfTest() : false;
  last = { at: now, ok };
  return ok;
}

/** The answer of the latest run; false until one has passed. */
export function kmsSelfTestPassed(): boolean {
  return last?.ok === true;
}

/** Test-only: forget the remembered answer. */
export function resetKmsSelfTestForTests(): void {
  last = null;
}
