import 'server-only';
import {
  BasicSafetyScanner,
  ConsoleObservabilityPort,
  DeterministicTextExtractor,
  NullEmailPort,
  NullPaymentPort,
} from '@visastack/adapters';
import type {
  BlobStore,
  DocumentConverterPort,
  EmailPort,
  IdentityPort,
  MalwareScannerPort,
  ObservabilityPort,
  PaymentPort,
} from '@visastack/services';
import { WorkosIdentityPort } from './identity-provider';

/**
 * The central provider registry (master directive §7 "PR 11"): the one place
 * that maps every `*_PROVIDER` env var to the deployment's actual, recognized
 * implementation. Commercial provider activation is meant to be a
 * configuration act, not a business-logic edit — this module is what makes an
 * operator's env var either take effect or fail loudly, never silently no-op.
 *
 * Two ports (`StoragePort`, `AiExtractionPort`) already have a real,
 * independently-tested factory that reads and validates its own `*_PROVIDER`
 * var in place (`./storage`'s `createStorage`, `./ai`'s `createAiExtractor`)
 * — re-exported here rather than duplicated, so there is exactly one place
 * each actually constructs its adapter.
 *
 * `DATABASE_PROVIDER` and `JOB_PROVIDER` are validated here but have no
 * `create*` function: there is no `DatabasePort`/dedicated construction step
 * to perform. The database is Drizzle-over-Neon accessed directly
 * (`@visastack/db`); the job queue's real implementation is the existing
 * Postgres-native worker functions in `packages/services/src/jobs.ts`, which
 * satisfy `JobQueuePort`'s shape by construction (see `ports.ts`'s doc
 * comment) rather than by being built from a registry entry.
 */

function readEnv(name: string): string | undefined {
  return process.env[name];
}

const KNOWN_PROVIDERS = {
  IDENTITY_PROVIDER: ['workos'],
  STORAGE_PROVIDER: ['vercel_blob', 'neon'],
  DATABASE_PROVIDER: ['neon'],
  MALWARE_SCANNER_PROVIDER: ['builtin'],
  DOCUMENT_CONVERTER_PROVIDER: ['builtin'],
  AI_PROVIDER: ['openai'],
  JOB_PROVIDER: ['neon'],
  EMAIL_PROVIDER: ['none'],
  OBSERVABILITY_PROVIDER: ['console'],
  PAYMENT_PROVIDER: ['none'],
} as const satisfies Record<string, readonly string[]>;

type KnownProviderVar = keyof typeof KNOWN_PROVIDERS;

/**
 * Fails closed when `envVar` is SET to a value this deployment doesn't
 * implement. Leaving the var unset is never an error here (most
 * environments — dev, test, PR preview, and the pilot itself — legitimately
 * leave it unset and get the pilot default below); this only catches a
 * recognized-but-wrong value, e.g. a typo or a provider planned but not yet
 * built.
 */
function checkKnownProvider(envVar: KnownProviderVar): void {
  const value = readEnv(envVar);
  const supported = KNOWN_PROVIDERS[envVar];
  if (value !== undefined && !(supported as readonly string[]).includes(value)) {
    throw new Error(
      `unsupported ${envVar}=${JSON.stringify(value)} — this deployment implements: ${supported.join(', ')}`,
    );
  }
}

/**
 * Validates every `*_PROVIDER` var this deployment recognizes. Intended as a
 * single startup/readiness check (see the commercial readiness guard) —
 * throws on the first unrecognized value, naming exactly which var and what
 * this deployment actually supports.
 */
export function validateProviderEnv(): void {
  for (const envVar of Object.keys(KNOWN_PROVIDERS) as readonly KnownProviderVar[]) {
    checkKnownProvider(envVar);
  }
}

/**
 * Pilot and commercial-track identity provider: WorkOS AuthKit (master
 * directive §7 "PR 11" pilot provider list). The only implementation, so
 * this exists to validate the env var rather than to choose between adapters
 * — see `IdentityPort`'s own doc comment (ports.ts) for what is and isn't
 * wired through it yet.
 */
export function createIdentityPort(): IdentityPort {
  checkKnownProvider('IDENTITY_PROVIDER');
  return new WorkosIdentityPort();
}

/** The built-in structural safety scanner (ADR-0011) — the only `MalwareScannerPort` implementation today. */
export function createMalwareScanner(blobStore: BlobStore): MalwareScannerPort {
  checkKnownProvider('MALWARE_SCANNER_PROVIDER');
  return new BasicSafetyScanner({ blobStore });
}

/** The deterministic, bounded document-to-text converter — the only `DocumentConverterPort` implementation today. */
export function createDocumentConverter(blobStore: BlobStore): DocumentConverterPort {
  checkKnownProvider('DOCUMENT_CONVERTER_PROVIDER');
  return new DeterministicTextExtractor({ blobStore });
}

/** No email provider is configured for the pilot (master directive §7 "PR 11": matches Payment's explicit "no payment provider"). */
export function createEmailPort(): EmailPort {
  checkKnownProvider('EMAIL_PROVIDER');
  return new NullEmailPort();
}

/** The pilot's "internal alert dashboard": a structured JSON line to stdout, aggregated by Vercel's own log viewer. */
export function createObservabilityPort(): ObservabilityPort {
  checkKnownProvider('OBSERVABILITY_PROVIDER');
  return new ConsoleObservabilityPort();
}

/** No payment provider is configured — `PaymentPort.configured` is always `false` until one is built and registered here. */
export function createPaymentPort(): PaymentPort {
  checkKnownProvider('PAYMENT_PROVIDER');
  return new NullPaymentPort();
}

export { createStorage } from './storage';
export { createAiExtractor } from './ai';
