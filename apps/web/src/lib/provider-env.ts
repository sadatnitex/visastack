import 'server-only';
import { PAYMENT_PROVIDER_KEYS } from './payment-providers';

/**
 * The provider names this deployment implements, and the checks that read them. Kept apart from
 * `./providers` so the heavy document and image factories (`./providers-media`) can use the same
 * check without pulling the rest of the registry in, and the other way round.
 */

export function readEnv(name: string): string | undefined {
  return process.env[name];
}

export const KNOWN_PROVIDERS = {
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

export type KnownProviderVar = keyof typeof KNOWN_PROVIDERS;

/**
 * Fails closed when `envVar` is SET to a value this deployment doesn't
 * implement. Leaving the var unset is never an error here (most
 * environments - dev, test, PR preview, and the pilot itself - legitimately
 * leave it unset and get the pilot default below); this only catches a
 * recognized-but-wrong value, e.g. a typo or a provider planned but not yet
 * built.
 *
 * A blank string is treated the same as unset (Codex review, PR-E1): every
 * optional `*_PROVIDER` line in `.env.example` is declared present but empty
 * (`IDENTITY_PROVIDER=`, etc.), so the standard `cp .env.example .env.local`
 * workflow sets each one to `''`, not `undefined`, in `process.env`. Before
 * `validateProviderEnv()` gained a real caller (finding #36) that distinction
 * was inert; wiring it into the readiness route made it live - without this,
 * every freshly-copied local environment reports readiness `degraded` on the
 * very first optional provider var, even with DB and WorkOS both genuinely
 * configured.
 *
 * The thrown message never echoes the offending value itself (Codex review,
 * PR-E1, round 2): `/api/health/ready` copies this message into its
 * (verbose-only, but still unauthenticated) response body, and `*_PROVIDER`
 * vars hold free-form operator input - nothing stops an accidentally pasted
 * credential or internal identifier from landing there. Naming the var and
 * the supported values is enough to act on; both are static, never secret.
 */
export function checkKnownProvider(envVar: KnownProviderVar): void {
  const value = readEnv(envVar);
  if (value === undefined || value === '') return;
  const supported = KNOWN_PROVIDERS[envVar];
  if (!(supported as readonly string[]).includes(value)) {
    throw new Error(
      `unsupported ${envVar} value - this deployment implements: ${supported.join(', ')}`,
    );
  }
}
