import 'server-only';
import {
  AwsKmsKeyProvider,
  BasicSafetyScanner,
  BuiltinContentLimitsChecker,
  BuiltinPreviewRenderer,
  ClamAvScanner,
  ConsoleObservabilityPort,
  DeterministicTextExtractor,
  LocalEnvelopeKeyProvider,
  NullEmailPort,
  type PaymentProviderFailure,
  ResendEmailPort,
  SharpImageSanitizer,
} from '@visastack/adapters';
import {
  type BlobStore,
  type ContentLimitsPort,
  type DocumentConverterPort,
  type EmailPort,
  type IdentityPort,
  type ImageSanitizerPort,
  type KeyManagementPort,
  type MalwareScannerPort,
  type ObservabilityPort,
  type PaymentPort,
  type PaymentPortResolver,
  type PreviewRendererPort,
  loadUploadQuotaConfig,
} from '@visastack/services';
import { isClamAvConfigured } from './env';
import { NeonIdentityPort } from './identity-provider';
import {
  type IncompletePaymentProvider,
  type OverallPaymentMode,
  PAYMENT_PROVIDER_KEYS,
  type PaymentProviderKey,
  buildPaymentPorts,
  configuredPaymentProviders,
  currenciesByMode,
  incompletePaymentProviders,
  incompleteProviderMessage,
  overallPaymentMode,
  paymentProvidersSettingProblem,
} from './payment-providers';
import { paymentResultSigningProblem } from './payment-result';

/**
 * The central provider registry (master directive §7 "PR 11"): the one place
 * that maps every `*_PROVIDER` env var to the deployment's actual, recognized
 * implementation. Commercial provider activation is meant to be a
 * configuration act, not a business-logic edit — this module is what makes an
 * operator's env var either take effect or fail loudly, never silently no-op.
 *
 * `StoragePort` already has a real, independently-tested factory that reads
 * and validates its own `*_PROVIDER` var in place (`./storage`'s
 * `createStorage`), re-exported here rather than duplicated, so there is
 * exactly one place it constructs its adapter. AI adapters are built by
 * `./ai`'s `resolveAiExtractor` and its siblings from the database-managed
 * AI settings (or, on a fresh install, the environment).
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
  IDENTITY_PROVIDER: ['neon_auth'],
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
  // S19 step 0: every provider in the payment provider registry (today: sslcommerz).
  PAYMENT_PROVIDER: ['none', ...PAYMENT_PROVIDER_KEYS],
  KMS_PROVIDER: ['local', 'aws_kms'],
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
  // S19 step 0: the ordered list of payment providers. Like the vars above, the message names the
  // setting and the supported names only, never what was typed.
  const listProblem = paymentProvidersSettingProblem(process.env);
  if (listProblem !== null) throw new Error(listProblem);
  // A chosen provider with incomplete settings is off, and said so here: its name and the names of
  // the settings it lacks, never a value (S19 step 0 round 2).
  const incomplete = incompletePaymentProviders(process.env)[0];
  if (incomplete !== undefined) throw new Error(incompleteProviderMessage(incomplete));
  // The payment result signing secret, when set, must be long enough to be used.
  const signing = paymentResultSigningProblem(process.env);
  if (signing !== null) throw new Error(signing);
}

/**
 * Identity provider: Neon Auth, the only sign-in system (WorkOS retired in WP-P0). A leftover
 * `IDENTITY_PROVIDER` set to anything other than `neon_auth` is refused loudly rather than
 * ignored. See `IdentityPort`'s own doc comment (ports.ts) for what is wired through it.
 */
export function createIdentityPort(): IdentityPort {
  checkKnownProvider('IDENTITY_PROVIDER');
  return new NeonIdentityPort();
}

/**
 * The structural-only safety scanner (ADR-0011) by default, or a real
 * ClamAV engine (SEC-05/EVI-02) when `MALWARE_SCANNER_PROVIDER=clamav` is
 * explicitly set with its connection (`isClamAvConfigured`, the same check
 * the readiness gate and the capability registry use).
 *
 * With `github_clamav`, documents are scanned by the private scan runner,
 * not by this port: intake dispatches to it. The few small uploads that are
 * checked here synchronously (agency logos, photo proofs of payment, profile
 * photos) get the structural checker, so each is also re-encoded server side
 * (`createImageSanitizer` below, and the profile photo re-encoder) and only
 * image data is ever stored; a PDF proof is refused by the structural checker.
 */
export function createMalwareScanner(blobStore: BlobStore): MalwareScannerPort {
  checkKnownProvider('MALWARE_SCANNER_PROVIDER');
  if (readEnv('MALWARE_SCANNER_PROVIDER') === 'github_clamav') {
    if (!readEnv('GITHUB_INTAKE_DISPATCH_TOKEN'))
      throw new Error('github_clamav requires GITHUB_INTAKE_DISPATCH_TOKEN');
    return new BasicSafetyScanner({ blobStore });
  }
  if (readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav') {
    if (!isClamAvConfigured()) {
      throw new Error(
        'MALWARE_SCANNER_PROVIDER=clamav requires CLAMAV_SOCKET_PATH, or both CLAMAV_HOST and CLAMAV_PORT',
      );
    }
    const socketPath = readEnv('CLAMAV_SOCKET_PATH');
    const host = readEnv('CLAMAV_HOST');
    const portRaw = readEnv('CLAMAV_PORT');
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

/**
 * Server-side re-encoding for agency logos and photo proofs of payment (S27): a brand-new JPEG or
 * PNG written from the decoded pixels, so nothing from the upload but image data is stored.
 */
export function createImageSanitizer(): ImageSanitizerPort {
  return new SharpImageSanitizer();
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

/**
 * The payment mode (S29), across every configured provider since S19 step 0: LIVE only when every
 * one takes real money, TEST while all are in test mode (a test payment marks a real invoice paid,
 * so only the platform owner may make one, and it never reaches the accounting file), MIXED when
 * some are live and some are not, null when online payments are not configured. The one reading
 * every screen uses (Billing Rules, the status page, the platform overview), from
 * `configuredPaymentProviders` (payment-providers.ts).
 */
export function paymentMode(): OverallPaymentMode | null {
  return overallPaymentMode(configuredPaymentProviders(process.env));
}

/** The invoice currencies that take real money, and those that take only test payments. */
export function paymentCurrenciesByMode(): {
  readonly live: readonly string[];
  readonly test: readonly string[];
} {
  return currenciesByMode(process.env);
}

/** The chosen payment providers that are off because their settings are incomplete. */
export function incompletePaymentSettings(): readonly IncompletePaymentProvider[] {
  return incompletePaymentProviders(process.env);
}

/**
 * Each payment gateway failure, in fixed words, to the operational logs. Never throws, so building
 * the payment ports never does: an unknown `OBSERVABILITY_PROVIDER` is the readiness check's to
 * report, and the failures still reach the console log meanwhile.
 */
function paymentFailureRecorder(): (event: PaymentProviderFailure) => void {
  let observability: ObservabilityPort;
  try {
    observability = createObservabilityPort();
  } catch {
    observability = new ConsoleObservabilityPort();
  }
  // Fixed words only (which provider call, and why), so a wrong store setting or mode is visible
  // in the logs instead of looking like an ordinary outage.
  return (event) =>
    observability.record({
      name: 'payment_provider_failure',
      severity: 'warning',
      metadata: { operation: event.operation, reason: event.reason },
    });
}

/**
 * Every configured payment provider's port, as the resolver the services take (S19 step 0): a
 * payment starts on the provider that takes the invoice's currency, and a check or refund goes to
 * the provider the payment was made with. Empty (nothing can start) when none is configured. With
 * `refundsOnly`, only providers that can refund.
 */
export function paymentPorts(
  options: { readonly refundsOnly?: boolean } = {},
): PaymentPortResolver {
  return buildPaymentPorts(process.env, paymentFailureRecorder(), options);
}

/** One provider's port when it is chosen and fully configured, else null. Never throws. */
export function paymentPortFor(provider: PaymentProviderKey): PaymentPort | null {
  const configured = configuredPaymentProviders(process.env).find((p) => p.key === provider);
  return configured ? configured.entry.create(process.env, paymentFailureRecorder()) : null;
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
 * `undefined` rather than always constructing a port, unlike e.g.
 * `createEmailPort`: most profile fields are STANDARD sensitivity and
 * must keep saving even where no master key has been configured yet.
 * `editFact` (packages/services/src/profile.ts) is the one place that
 * actually decides a port is required, failing loudly
 * (`encryption_unavailable`) only when the specific field being written is
 * SENSITIVE/RESTRICTED and no port was supplied.
 */
export function createKeyManagementPort(): KeyManagementPort | undefined {
  checkKnownProvider('KMS_PROVIDER');
  if (readEnv('KMS_PROVIDER') === 'aws_kms') return createAwsKmsPort();
  const masterKeyBase64 = readEnv('KMS_LOCAL_MASTER_KEY_BASE64');
  if (!masterKeyBase64) return undefined;
  return new LocalEnvelopeKeyProvider({ masterKeyBase64 });
}

let awsKmsPort: { readonly signature: string; readonly port: KeyManagementPort } | undefined;

/**
 * The real key service (`KMS_PROVIDER=aws_kms`, S26). Needs `KMS_KEY_ID` and `KMS_AWS_REGION`;
 * the credentials are `KMS_AWS_ACCESS_KEY_ID` and `KMS_AWS_SECRET_ACCESS_KEY` (or the standard AWS
 * credential chain when both are absent). Anything missing returns no port at all,
 * never the local key, so a half-set-up environment fails closed (protected fields report
 * "encryption unavailable"). `KMS_LOCAL_MASTER_KEY_BASE64`, if still set, only opens data keys
 * the re-wrap job has not moved yet. One instance is reused while the settings do not change.
 */
function createAwsKmsPort(): KeyManagementPort | undefined {
  const keyId = readEnv('KMS_KEY_ID');
  const region = readEnv('KMS_AWS_REGION');
  if (!keyId || !region) return undefined;
  const legacy = readEnv('KMS_LOCAL_MASTER_KEY_BASE64');
  // Names of our own, not the AWS_* ones: the hosting platform reserves those for itself.
  const accessKeyId = readEnv('KMS_AWS_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('KMS_AWS_SECRET_ACCESS_KEY');
  const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
  const signature = `${keyId}|${region}|${accessKeyId ?? ''}|${legacy ? 'legacy' : 'none'}`;
  if (awsKmsPort?.signature === signature) return awsKmsPort.port;
  const port = new AwsKmsKeyProvider({
    keyId,
    region,
    ...(credentials ? { credentials } : {}),
    ...(legacy ? { legacyLocalMasterKeyBase64: legacy } : {}),
  });
  awsKmsPort = { signature, port };
  return port;
}

export { createStorage } from './storage';
