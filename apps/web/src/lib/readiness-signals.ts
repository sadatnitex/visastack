import 'server-only';
import {
  type AiProviderReadinessState,
  type Db,
  loadAiProviderReadiness,
  loadScannerEvidence,
} from '@visastack/services';
import { readEnv } from './env';

/**
 * The database facts two commercial readiness gates need (S27): the AI provider settings for
 * `productionAiProvider`, and the private scan runner's own recent proof (S4) for
 * `realMalwareScanner` when the scanner is `github_clamav`.
 *
 * The gates themselves stay synchronous and free of I/O, because the capability registry
 * (`capabilities.ts`) evaluates them on ordinary requests. So these facts are read where
 * readiness is evaluated (`readiness.ts`, behind `/api/health/ready` and the admin page),
 * handed to the full guard directly, and remembered for the synchronous checks, exactly like
 * the key service self-test (`kms-self-test.ts`). Until a read has happened, or once the last
 * one is older than `READINESS_SIGNALS_TTL_MS`, the remembered answer is "unknown" and both
 * gates fail closed.
 */

export type AiProviderReadiness = AiProviderReadinessState | { readonly kind: 'unknown' };

export interface ReadinessSignals {
  readonly aiProvider: AiProviderReadiness;
  /** True only while the scan runner's newest verification record is recent (S4's 72-hour window). */
  readonly scannerEvidenceFresh: boolean;
}

/** Same trust window as a passing key service self-test. */
export const READINESS_SIGNALS_TTL_MS = 5 * 60 * 1000;

export const UNKNOWN_READINESS_SIGNALS: ReadinessSignals = {
  aiProvider: { kind: 'unknown' },
  scannerEvidenceFresh: false,
};

let remembered: { readonly at: number; readonly signals: ReadinessSignals } | null = null;
/** Bumped by every forget, so a read that started before it can never be remembered after it. */
let generation = 0;
/** Overlapping evaluations share one read (a busy status page polls readiness often). */
let inFlight: { readonly generation: number; readonly read: Promise<ReadinessSignals> } | null =
  null;

async function readBoth(db: Db, now: number): Promise<ReadinessSignals> {
  const [aiProvider, scannerEvidence] = await Promise.all([
    loadAiProviderReadiness(db),
    readEnv('MALWARE_SCANNER_PROVIDER') === 'github_clamav'
      ? loadScannerEvidence(db, new Date(now))
      : Promise.resolve(null),
  ]);
  return { aiProvider, scannerEvidenceFresh: scannerEvidence !== null };
}

/**
 * Read both facts from a connected, migrated database and remember them. With no usable
 * database the answer is unknown and the remembered one is dropped too. Never throws: both
 * readers already turn a failed or missing read into the not-satisfied answer.
 */
export function readReadinessSignals(
  db: Db | undefined,
  now: number = Date.now(),
): Promise<ReadinessSignals> {
  if (!db) {
    forgetReadinessSignals();
    return Promise.resolve(UNKNOWN_READINESS_SIGNALS);
  }
  if (inFlight && inFlight.generation === generation) return inFlight.read;
  const startedIn = generation;
  const read = readBoth(db, now)
    .then((signals) => {
      if (startedIn === generation) remembered = { at: now, signals };
      return signals;
    })
    .finally(() => {
      if (inFlight?.read === read) inFlight = null;
    });
  inFlight = { generation: startedIn, read };
  return read;
}

/** The latest read while it is trusted, otherwise unknown. */
export function rememberedReadinessSignals(now: number = Date.now()): ReadinessSignals {
  if (remembered && now - remembered.at >= 0 && now - remembered.at < READINESS_SIGNALS_TTL_MS) {
    return remembered.signals;
  }
  return UNKNOWN_READINESS_SIGNALS;
}

/**
 * Drop the remembered answer and disown any read still running (tests, a read with no usable
 * database, and this server right after an AI settings change).
 */
export function forgetReadinessSignals(): void {
  generation += 1;
  remembered = null;
  inFlight = null;
}
