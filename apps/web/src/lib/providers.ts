import 'server-only';
import {
  BasicSafetyScanner,
  BuiltinContentLimitsChecker,
  BuiltinPreviewRenderer,
  ClamAvScanner,
  ConsoleObservabilityPort,
  DeterministicTextExtractor,
  LocalEnvelopeKeyProvider,
  NullEmailPort,
  NullPaymentPort,
  ResendEmailPort,
} from '@visastack/adapters';
import {
  type BlobStore,
  type ContentLimitsPort,
  type DocumentConverterPort,
  type EmailPort,
  type IdentityPort,
  type KeyManagementPort,
  type MalwareScannerPort,
  type ObservabilityPort,
  type PaymentPort,
  type PreviewRendererPort,
  loadUploadQuotaConfig,
} from '@visastack/services';
import { NeonIdentityPort, WorkosIdentityPort } from './identity-provider';
import { selectedIdentityProvider } from './identity-selection';

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
  IDENTITY_PROVIDER: ['workos', 'neon_auth'],
  STORAGE_PROVIDER: ['vercel_blob', 'neon', 'r2'],
  DATABASE_PROVIDER: ['neon'],
  MALWARE_SCANNER_PROVIDER: ['builtin', 'clamav', 'github_clamav'],
  DOCUMENT_CONVERTER_PROVIDER: ['builtin'],
  PREVIEW_RENDERER_PROVIDER: ['builtin'],
  CONTENT_LIMITS_PROVIDER: ['builtin'],
  AI_PROVIDER: ['openai'],
  JOB_PROVIDER: ['neon'],
  EMAIL_PROVIDER: ['none', 'resend'],
  OBSERVABILITY_PROVIDER: ['console'],
  PAYMENT_PROVIDER: ['none'],
  KMS_PROVIDER: ['local'],
} as const satisfies Record<string, readonly string[]>;

type KnownProviderVar = keyof typeof KNOWN_PROVIDERS;

/**
 * Fails closed when `envVar` is SET to a value this deployment doesn't
 * implement. Leaving the var unset is never an error here (most
 * environments — dev, test, PR preview, and the pilot itself — legitimately
 * leave it unset and get the pilot default below); this only catches a
 * recognized-but-wrong value, e.g. a typo or a provider planned but not yet
 * built.
 *
 * A blank string is treated the same as unset (Codex review, PR-E1): every
 * optional `*_PROVIDER` line in `.env.example` is declared present but empty
 * (`IDENTITY_PROVIDER=`, etc.), so the standard `cp .env.example .env.local`
 * workflow sets each one to `''`, not `undefined`, in `process.env`. Before
 * `validateProviderEnv()` gained a real caller (finding #36) that distinction
 * was inert; wiring it into the readiness route made it live — without this,
 * every freshly-copied local environment reports readiness `degraded` on the
 * very first optional provider var, even with DB and WorkOS both genuinely
 * configured.
 *
 * The thrown message never echoes the offending value itself (Codex review,
 * PR-E1, round 2): `/api/health/ready` copies this message into its
 * (verbose-only, but still unauthenticated) response body, and `*_PROVIDER`
 * vars hold free-form operator input — nothing stops an accidentally pasted
 * credential or internal identifier from landing there. Naming the var and
 * the supported values is enough to act on; both are static, never secret.
 */
function checkKnownProvider(envVar: KnownProviderVar): void {
  const value = readEnv(envVar);
  if (value === undefined || value === '') return;
  const supported = KNOWN_PROVIDERS[envVar];
  if (!(supported as readonly string[]).includes(value)) {
    throw new Error(
      `unsupported ${envVar} value — this deployment implements: ${supported.join(', ')}`,
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
 * Identity provider: WorkOS AuthKit by default (master directive §7 "PR 11"
 * pilot provider list), or Neon Auth when `IDENTITY_PROVIDER=neon_auth` (phase 1:
 * sign-in pieces only; account linking is phase 2, see
 * docs/commercial-v1/neon-auth-migration-plan.md). See `IdentityPort`'s own doc comment (ports.ts) for what is and isn't
 * wired through it yet.
 */
export function createIdentityPort(): IdentityPort {
  checkKnownProvider('IDENTITY_PROVIDER');
  return selectedIdentityProvider(readEnv) === 'neon_auth'
    ? new NeonIdentityPort()
    : new WorkosIdentityPort();
}

/**
 * The structural-only safety scanner (ADR-0011) by default, or a real
 * ClamAV engine (SEC-05/EVI-02) when `MALWARE_SCANNER_PROVIDER=clamav` is
 * explicitly set. `commercial-readiness.ts`'s `realMalwareScanner` gate
 * checks the same env var this function reads, so the two can never
 * disagree about whether a real scanner is actually configured.
 */
export function createMalwareScanner(blobStore: BlobStore): MalwareScannerPort {
  checkKnownProvider('MALWARE_SCANNER_PROVIDER');
  if (readEnv('MALWARE_SCANNER_PROVIDER') === 'github_clamav') {
    if (!readEnv('GITHUB_INTAKE_DISPATCH_TOKEN'))
      throw new Error('github_clamav requires GITHUB_INTAKE_DISPATCH_TOKEN');
    // Existing synchronous branding checks remain structural. Document intake
    // dispatches instead of using this checker; the runner constructs ClamAvScanner.
    return new BasicSafetyScanner({ blobStore });
  }
  if (readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav') {
    const socketPath = readEnv('CLAMAV_SOCKET_PATH');
    const host = readEnv('CLAMAV_HOST');
    const portRaw = readEnv('CLAMAV_PORT');
    if (!socketPath && !(host && portRaw)) {
      throw new Error(
        'MALWARE_SCANNER_PROVIDER=clamav requires CLAMAV_SOCKET_PATH, or both CLAMAV_HOST and CLAMAV_PORT',
      );
    }
    const maxAgeHoursRaw = readEnv('CLAMAV_MAX_SIGNATURE_AGE_HOURS');
    const engineVersion = readEnv('CLAMAV_ENGINE_VERSION');
    const databaseDirectory = readEnv('CLAMAV_DATABASE_DIRECTORY');
    return new ClamAvScanner({
      blobStore,
      ...(socketPath ? { socketPath } : {}),
      ...(host ? { host } : {}),
      ...(portRaw ? { port: Number(portRaw) } : {}),
      ...(engineVersion ? { engineVersion } : {}),
      ...(databaseDirectory ? { databaseDirectory } : {}),
      ...(maxAgeHoursRaw ? { maxSignatureAgeMs: Number(maxAgeHoursRaw) * 60 * 60 * 1000 } : {}),
    });
  }
  return new BasicSafetyScanner({ blobStore });
}

/** The deterministic, bounded document-to-text converter — the only `DocumentConverterPort` implementation today. */
export function createDocumentConverter(blobStore: BlobStore): DocumentConverterPort {
  checkKnownProvider('DOCUMENT_CONVERTER_PROVIDER');
  return new DeterministicTextExtractor({ blobStore });
}

/**
 * The safe preview renderer (EVI-02/EVI-06), the only `PreviewRendererPort`
 * implementation today, matching `createDocumentConverter`'s "builtin,
 * always active" shape: no external account, no configuration branch.
 * Shares `maxPdfPages` with `createContentLimitsChecker` below (same
 * `loadUploadQuotaConfig()` source) so a render at serve time re-checks the
 * same page-count limit intake already enforced, using the same number an
 * operator override would change for both, never a second independently
 * drifting constant.
 */
export function createPreviewRenderer(): PreviewRendererPort {
  checkKnownProvider('PREVIEW_RENDERER_PROVIDER');
  const { maxPdfPages } = loadUploadQuotaConfig();
  return new BuiltinPreviewRenderer({ maxPdfPages });
}

/**
 * The content-limits checker (EVI-01's "50 PDF pages, 40 megapixels per
 * image"), the only `ContentLimitsPort` implementation today, same
 * "builtin, always active" shape as `createPreviewRenderer`. Reads its
 * limits from the same `loadUploadQuotaConfig()` the upload-size checks
 * use, so an operator overriding `QUOTA_MAX_PDF_PAGES`/
 * `QUOTA_MAX_IMAGE_MEGAPIXELS` changes both what `quotas.ts` reports and
 * what this checker enforces from the one place.
 */
export function createContentLimitsChecker(blobStore: BlobStore): ContentLimitsPort {
  checkKnownProvider('CONTENT_LIMITS_PROVIDER');
  const { maxPdfPages, maxImageMegapixels } = loadUploadQuotaConfig();
  return new BuiltinContentLimitsChecker({
    blobStore,
    config: { maxPdfPages, maxImageMegapixels },
  });
}

/**
 * `NullEmailPort` (pilot default, matches Payment's explicit "no payment
 * provider") unless `EMAIL_PROVIDER=resend` is explicitly set (NTF-03, Part
 * 5 §5), in which case a real Resend adapter is constructed instead.
 * `commercial-readiness.ts`'s `realEmailProvider` gate checks the same env
 * vars this function reads, so the two can never disagree about whether a
 * real provider is actually configured -- same pairing as
 * `createMalwareScanner`/`realMalwareScanner` above.
 */
export function createEmailPort(): EmailPort {
  checkKnownProvider('EMAIL_PROVIDER');
  if (readEnv('EMAIL_PROVIDER') === 'resend') {
    const apiKey = readEnv('RESEND_API_KEY');
    const from = readEnv('RESEND_FROM_ADDRESS');
    if (!apiKey || !from) {
      throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY and RESEND_FROM_ADDRESS');
    }
    return new ResendEmailPort({ apiKey, from });
  }
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

/**
 * Envelope-key provider for protected-field encryption (Commercial V1
 * SEC-03). `local` (`LocalEnvelopeKeyProvider`, @visastack/adapters) is the
 * only implementation today and is explicitly NOT a real KMS, so it refuses
 * to construct at all once `DEPLOYMENT_MODE=commercial` (its own
 * `assertNotCommercialMode` guard), so this function can never hand back a
 * fake-KMS port on a real commercial deployment.
 *
 * Unlike this file's other `create*Port()` functions, this one returns
 * `undefined` rather than always constructing a port, matching
 * `createAiExtractor`'s (./ai.ts) shape rather than e.g.
 * `createEmailPort`'s: most profile fields are STANDARD sensitivity and
 * must keep saving even where no master key has been configured yet.
 * `editFact` (packages/services/src/profile.ts) is the one place that
 * actually decides a port is required, failing loudly
 * (`encryption_unavailable`) only when the specific field being written is
 * SENSITIVE/RESTRICTED and no port was supplied.
 */
export function createKeyManagementPort(): KeyManagementPort | undefined {
  checkKnownProvider('KMS_PROVIDER');
  const masterKeyBase64 = readEnv('KMS_LOCAL_MASTER_KEY_BASE64');
  if (!masterKeyBase64) return undefined;
  return new LocalEnvelopeKeyProvider({ masterKeyBase64 });
}

export { createStorage } from './storage';
export { createAiExtractor } from './ai';
