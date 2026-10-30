import {
  BasicSafetyScanner,
  ConsoleObservabilityPort,
  DeterministicTextExtractor,
  NullEmailPort,
  ResendEmailPort,
} from '@visastack/adapters';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The central provider registry (master directive §7 "PR 11"): every
 * `*_PROVIDER` var is optional (pilot default applies when unset) but fails
 * loudly the moment it's SET to a value this deployment doesn't implement —
 * never a silent fallback to the hardcoded default.
 */

const ENV_KEYS = [
  'IDENTITY_PROVIDER',
  'STORAGE_PROVIDER',
  'DATABASE_PROVIDER',
  'MALWARE_SCANNER_PROVIDER',
  'CLAMAV_SOCKET_PATH',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'DOCUMENT_CONVERTER_PROVIDER',
  'AI_PROVIDER',
  'JOB_PROVIDER',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'OBSERVABILITY_PROVIDER',
  'PAYMENT_PROVIDER',
  'PAYMENT_PROVIDERS',
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWORD',
  'SSLCOMMERZ_MODE',
  'PAYMENT_RESULT_SIGNING_SECRET',
  'KMS_PROVIDER',
  'KMS_LOCAL_MASTER_KEY_BASE64',
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  for (const key of ENV_KEYS) unsetEnv(key);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
});

describe('validateProviderEnv', () => {
  // The first dynamic import in this file pulls in ./providers ->
  // @visastack/adapters (including the OpenAI SDK transform),
  // fast in isolation but able to approach the 5s default under full
  // monorepo test-suite contention — same documented cause as ai.test.ts's,
  // step-up.test.ts's, and commercial-readiness.test.ts's own first tests.
  it('passes when every *_PROVIDER var is left unset (the pilot default)', async () => {
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  }, 15_000);

  it('passes when every var is explicitly set to its supported value', async () => {
    setEnv('IDENTITY_PROVIDER', 'neon_auth');
    setEnv('STORAGE_PROVIDER', 'vercel_blob');
    setEnv('DATABASE_PROVIDER', 'neon');
    setEnv('MALWARE_SCANNER_PROVIDER', 'builtin');
    setEnv('DOCUMENT_CONVERTER_PROVIDER', 'builtin');
    setEnv('AI_PROVIDER', 'openai');
    setEnv('JOB_PROVIDER', 'neon');
    setEnv('EMAIL_PROVIDER', 'none');
    setEnv('OBSERVABILITY_PROVIDER', 'console');
    setEnv('PAYMENT_PROVIDER', 'none');
    setEnv('KMS_PROVIDER', 'local');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  });

  it('fails closed, naming the offending var, when one names a provider this deployment does not implement', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'windows-defender');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).toThrow(/MALWARE_SCANNER_PROVIDER/);
  });

  it('accepts clamav as a supported MALWARE_SCANNER_PROVIDER value (SEC-05)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  });

  it('rejects an unsupported DATABASE_PROVIDER even though no port constructs anything from it', async () => {
    setEnv('DATABASE_PROVIDER', 'supabase');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).toThrow(/DATABASE_PROVIDER/);
  });

  it('treats every *_PROVIDER var set to a blank string as unset, matching the standard cp .env.example .env.local workflow (Codex review, PR-E1)', async () => {
    for (const key of ENV_KEYS) setEnv(key, '');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  });

  it('never echoes the offending value itself, only the var name and supported list (Codex review, PR-E1, round 2)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'sk_live_accidentally_pasted_secret');
    const { validateProviderEnv } = await import('./providers');
    let thrown: unknown;
    try {
      validateProviderEnv();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('MALWARE_SCANNER_PROVIDER');
    expect(message).toContain('builtin');
    expect(message).not.toContain('sk_live_accidentally_pasted_secret');
  });
});

describe('PAYMENT_PROVIDERS (S19 step 0)', () => {
  it('rejects a provider name this deployment does not have, without echoing it', async () => {
    setEnv('PAYMENT_PROVIDERS', 'sslcommerz, sk_live_accidentally_pasted_secret');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).toThrow(/PAYMENT_PROVIDERS/);
    expect(() => validateProviderEnv()).toThrow(/none, sslcommerz/);
    expect(() => validateProviderEnv()).not.toThrow(/sk_live/);
    setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
    setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
    setEnv('SSLCOMMERZ_MODE', 'sandbox');
    for (const fine of ['sslcommerz', ' sslcommerz , none ', 'none', '', 'none,']) {
      setEnv('PAYMENT_PROVIDERS', fine);
      expect(() => validateProviderEnv(), fine).not.toThrow();
    }
  });

  it('rejects a list that is set but names no provider at all, instead of quietly switching payments off (round 2)', async () => {
    const { validateProviderEnv } = await import('./providers');
    for (const empty of [',', ' , ,', ',,']) {
      setEnv('PAYMENT_PROVIDERS', empty);
      expect(() => validateProviderEnv(), JSON.stringify(empty)).toThrow(
        /PAYMENT_PROVIDERS is set but names no provider/,
      );
    }
  });

  it('chooses SSLCOMMERZ through the list as through the single setting, and "none" turns it off', async () => {
    setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
    setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
    setEnv('SSLCOMMERZ_MODE', 'live');
    setEnv('PAYMENT_PROVIDERS', 'sslcommerz');
    const { paymentMode, paymentPorts } = await import('./providers');
    expect(paymentPorts().forProvider('sslcommerz')?.mode).toBe('LIVE');
    expect(paymentMode()).toBe('LIVE');
    setEnv('PAYMENT_PROVIDER', 'sslcommerz');
    setEnv('PAYMENT_PROVIDERS', 'none');
    expect(paymentPorts().configured()).toEqual([]);
    expect(paymentMode()).toBeNull();
  });
});

describe('a chosen payment provider with incomplete settings (S19 step 0 round 2)', () => {
  const configure = (mode = 'sandbox') => {
    setEnv('PAYMENT_PROVIDER', 'sslcommerz');
    setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
    setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
    setEnv('SSLCOMMERZ_MODE', mode);
  };

  it('fails readiness, naming the provider and each missing setting, never a value', async () => {
    const { validateProviderEnv, paymentPorts, incompletePaymentSettings } = await import(
      './providers'
    );
    for (const missing of ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_MODE']) {
      configure();
      unsetEnv(missing);
      expect(() => validateProviderEnv(), missing).toThrow(
        new RegExp(`payment provider sslcommerz is chosen .*: ${missing}$`),
      );
      expect(() => validateProviderEnv(), missing).not.toThrow(/synthetic-password|store-1/);
      expect(paymentPorts().configured(), missing).toEqual([]);
      expect(incompletePaymentSettings(), missing).toEqual([
        { key: 'sslcommerz', name: 'SSLCOMMERZ', missing: [missing] },
      ]);
    }
    for (const mode of ['', 'production', 'LIVE', 'true', 'sk_live_pasted']) {
      configure(mode);
      expect(() => validateProviderEnv(), mode).toThrow(/SSLCOMMERZ_MODE/);
      if (mode !== '') expect(() => validateProviderEnv(), mode).not.toThrow(new RegExp(mode));
    }
    // Through the list as well.
    configure();
    unsetEnv('PAYMENT_PROVIDER');
    setEnv('PAYMENT_PROVIDERS', 'sslcommerz');
    unsetEnv('SSLCOMMERZ_STORE_PASSWORD');
    expect(() => validateProviderEnv()).toThrow(/SSLCOMMERZ_STORE_PASSWORD/);
  });

  it('passes readiness once complete, and with nothing chosen whatever settings are present', async () => {
    const { validateProviderEnv, incompletePaymentSettings } = await import('./providers');
    configure('live');
    expect(() => validateProviderEnv()).not.toThrow();
    expect(incompletePaymentSettings()).toEqual([]);
    unsetEnv('PAYMENT_PROVIDER');
    unsetEnv('SSLCOMMERZ_MODE');
    expect(() => validateProviderEnv()).not.toThrow();
    expect(incompletePaymentSettings()).toEqual([]);
  });

  it('fails readiness when the payment result signing secret is set but too short, without showing it', async () => {
    const { validateProviderEnv } = await import('./providers');
    setEnv('PAYMENT_RESULT_SIGNING_SECRET', 'short-pasted-value');
    expect(() => validateProviderEnv()).toThrow(/PAYMENT_RESULT_SIGNING_SECRET is set but shorter/);
    expect(() => validateProviderEnv()).not.toThrow(/short-pasted-value/);
    setEnv('PAYMENT_RESULT_SIGNING_SECRET', 'x'.repeat(32));
    expect(() => validateProviderEnv()).not.toThrow();
  });
});

describe('createIdentityPort', () => {
  it('returns the Neon identity port, the only sign-in system, when IDENTITY_PROVIDER is unset', async () => {
    const { createIdentityPort } = await import('./providers');
    const { NeonIdentityPort } = await import('./identity-provider');
    expect(createIdentityPort()).toBeInstanceOf(NeonIdentityPort);
  });

  it('returns the Neon identity port when IDENTITY_PROVIDER is neon_auth', async () => {
    setEnv('IDENTITY_PROVIDER', 'neon_auth');
    const { createIdentityPort } = await import('./providers');
    const { NeonIdentityPort } = await import('./identity-provider');
    expect(createIdentityPort()).toBeInstanceOf(NeonIdentityPort);
  });

  it('refuses a leftover workos setting, or any other value, instead of guessing', async () => {
    for (const value of ['workos', 'okta']) {
      setEnv('IDENTITY_PROVIDER', value);
      const { createIdentityPort } = await import('./providers');
      expect(() => createIdentityPort(), value).toThrow(/IDENTITY_PROVIDER/);
    }
  });
});

describe('createMalwareScanner / createDocumentConverter', () => {
  it('construct the built-in structural adapters by default', async () => {
    const { createMalwareScanner, createDocumentConverter } = await import('./providers');
    expect(createMalwareScanner({} as never)).toBeInstanceOf(BasicSafetyScanner);
    expect(createDocumentConverter({} as never)).toBeInstanceOf(DeterministicTextExtractor);
  });

  it('reject an unrecognized MALWARE_SCANNER_PROVIDER / DOCUMENT_CONVERTER_PROVIDER', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'windows-defender');
    setEnv('DOCUMENT_CONVERTER_PROVIDER', 'libreoffice');
    const { createMalwareScanner, createDocumentConverter } = await import('./providers');
    expect(() => createMalwareScanner({} as never)).toThrow(/MALWARE_SCANNER_PROVIDER/);
    expect(() => createDocumentConverter({} as never)).toThrow(/DOCUMENT_CONVERTER_PROVIDER/);
  });

  it('constructs a real ClamAvScanner when MALWARE_SCANNER_PROVIDER=clamav with a socket path configured (SEC-05)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    setEnv('CLAMAV_SOCKET_PATH', '/var/run/clamav/clamd.ctl');
    const { createMalwareScanner } = await import('./providers');
    const { ClamAvScanner } = await import('@visastack/adapters');
    expect(createMalwareScanner({} as never)).toBeInstanceOf(ClamAvScanner);
  });

  it('constructs a real ClamAvScanner from CLAMAV_HOST/CLAMAV_PORT too, not just a socket path', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    setEnv('CLAMAV_HOST', 'clamav.internal');
    setEnv('CLAMAV_PORT', '3310');
    const { createMalwareScanner } = await import('./providers');
    const { ClamAvScanner } = await import('@visastack/adapters');
    expect(createMalwareScanner({} as never)).toBeInstanceOf(ClamAvScanner);
  });

  it('fails loudly when clamav is selected but no connection is configured, rather than silently falling back', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    const { createMalwareScanner } = await import('./providers');
    expect(() => createMalwareScanner({} as never)).toThrow(/CLAMAV_SOCKET_PATH|CLAMAV_HOST/);
  });
});

describe('createKeyManagementPort', () => {
  it('returns undefined when no master key is configured, so STANDARD fields keep saving', async () => {
    const { createKeyManagementPort } = await import('./providers');
    expect(createKeyManagementPort()).toBeUndefined();
  });

  it('constructs a real LocalEnvelopeKeyProvider once a master key is configured', async () => {
    setEnv('KMS_LOCAL_MASTER_KEY_BASE64', Buffer.alloc(32, 7).toString('base64'));
    const { createKeyManagementPort } = await import('./providers');
    const { LocalEnvelopeKeyProvider } = await import('@visastack/adapters');
    expect(createKeyManagementPort()).toBeInstanceOf(LocalEnvelopeKeyProvider);
  });

  it('rejects an unrecognized KMS_PROVIDER instead of silently using the local provider anyway', async () => {
    setEnv('KMS_PROVIDER', 'aws-kms');
    const { createKeyManagementPort } = await import('./providers');
    expect(() => createKeyManagementPort()).toThrow(/KMS_PROVIDER/);
  });
});

describe('createEmailPort / createObservabilityPort / paymentPorts', () => {
  it('construct the pilot Null/Console adapters by default, and no payment provider', async () => {
    const { createEmailPort, createObservabilityPort, paymentPorts } = await import('./providers');
    expect(createEmailPort()).toBeInstanceOf(NullEmailPort);
    expect(createObservabilityPort()).toBeInstanceOf(ConsoleObservabilityPort);
    expect(paymentPorts().configured()).toEqual([]);
  });

  it('reject an unrecognized provider for each', async () => {
    setEnv('EMAIL_PROVIDER', 'sendgrid');
    setEnv('OBSERVABILITY_PROVIDER', 'datadog');
    setEnv('PAYMENT_PROVIDER', 'stripe');
    const { createEmailPort, createObservabilityPort, validateProviderEnv, paymentPorts } =
      await import('./providers');
    expect(() => createEmailPort()).toThrow(/EMAIL_PROVIDER/);
    expect(() => createObservabilityPort()).toThrow(/OBSERVABILITY_PROVIDER/);
    // Building the payment ports never throws, even beside an unknown observability provider;
    // the unknown payment provider is the readiness check's to report.
    expect(paymentPorts().configured()).toEqual([]);
    unsetEnv('EMAIL_PROVIDER');
    unsetEnv('OBSERVABILITY_PROVIDER');
    expect(() => validateProviderEnv()).toThrow(/PAYMENT_PROVIDER/);
  });

  describe('online payments (S11)', () => {
    const configure = (mode = 'sandbox') => {
      setEnv('PAYMENT_PROVIDER', 'sslcommerz');
      setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
      setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
      setEnv('SSLCOMMERZ_MODE', mode);
    };

    it('stays off with nothing set: no port, no mode, no live switch', async () => {
      const { paymentPorts, paymentMode } = await import('./providers');
      expect(paymentPorts().configured()).toEqual([]);
      expect(paymentMode()).toBeNull();
      // Credentials alone, without choosing the provider, switch nothing on.
      setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
      setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
      setEnv('SSLCOMMERZ_MODE', 'live');
      expect(paymentPorts().configured()).toEqual([]);
      expect(paymentMode()).toBeNull();
    });

    it('builds the SSLCOMMERZ port only when the provider and all three settings are present', async () => {
      configure();
      const { paymentPortFor, paymentMode } = await import('./providers');
      const port = paymentPortFor('sslcommerz');
      expect(port?.configured).toBe(true);
      expect(port?.provider).toBe('sslcommerz');
      expect(paymentMode()).toBe('TEST');
    });

    it('keeps a half-set or invalid configuration off, never falling back to live', async () => {
      const { paymentPortFor, paymentMode } = await import('./providers');
      for (const missing of [
        'SSLCOMMERZ_STORE_ID',
        'SSLCOMMERZ_STORE_PASSWORD',
        'SSLCOMMERZ_MODE',
      ]) {
        configure('live');
        unsetEnv(missing);
        expect(paymentPortFor('sslcommerz'), missing).toBeNull();
        expect(paymentMode(), missing).toBeNull();
      }
      for (const mode of ['', 'production', 'LIVE', 'true']) {
        configure(mode);
        expect(paymentPortFor('sslcommerz'), mode).toBeNull();
      }
    });
  });

  it('constructs a real ResendEmailPort once EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM_ADDRESS are all configured (NTF-03)', async () => {
    setEnv('EMAIL_PROVIDER', 'resend');
    setEnv('RESEND_API_KEY', 're_test_key');
    setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
    const { createEmailPort } = await import('./providers');
    expect(createEmailPort()).toBeInstanceOf(ResendEmailPort);
  });

  it('refuses EMAIL_PROVIDER=resend without both RESEND_API_KEY and RESEND_FROM_ADDRESS, rather than constructing a half-configured adapter', async () => {
    setEnv('EMAIL_PROVIDER', 'resend');
    const { createEmailPort } = await import('./providers');
    expect(() => createEmailPort()).toThrow(/RESEND_API_KEY|RESEND_FROM_ADDRESS/);
  });
});
