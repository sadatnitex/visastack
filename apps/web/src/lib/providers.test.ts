import {
  BasicSafetyScanner,
  ConsoleObservabilityPort,
  DeterministicTextExtractor,
  NullEmailPort,
  NullPaymentPort,
} from '@visastack/adapters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The central provider registry (master directive §7 "PR 11"): every
 * `*_PROVIDER` var is optional (pilot default applies when unset) but fails
 * loudly the moment it's SET to a value this deployment doesn't implement —
 * never a silent fallback to the hardcoded default.
 *
 * `@workos-inc/authkit-nextjs` is mocked purely so `./providers` (which
 * imports `./identity-provider`) resolves outside a Next.js runtime — its
 * real `withAuth` behavior is exercised separately in
 * identity-provider.test.ts, never called by anything here.
 */
vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: vi.fn() }));

const ENV_KEYS = [
  'IDENTITY_PROVIDER',
  'STORAGE_PROVIDER',
  'DATABASE_PROVIDER',
  'MALWARE_SCANNER_PROVIDER',
  'DOCUMENT_CONVERTER_PROVIDER',
  'AI_PROVIDER',
  'JOB_PROVIDER',
  'EMAIL_PROVIDER',
  'OBSERVABILITY_PROVIDER',
  'PAYMENT_PROVIDER',
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
  it('passes when every *_PROVIDER var is left unset (the pilot default)', async () => {
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  });

  it('passes when every var is explicitly set to its supported value', async () => {
    setEnv('IDENTITY_PROVIDER', 'workos');
    setEnv('STORAGE_PROVIDER', 'vercel_blob');
    setEnv('DATABASE_PROVIDER', 'neon');
    setEnv('MALWARE_SCANNER_PROVIDER', 'builtin');
    setEnv('DOCUMENT_CONVERTER_PROVIDER', 'builtin');
    setEnv('AI_PROVIDER', 'openai');
    setEnv('JOB_PROVIDER', 'neon');
    setEnv('EMAIL_PROVIDER', 'none');
    setEnv('OBSERVABILITY_PROVIDER', 'console');
    setEnv('PAYMENT_PROVIDER', 'none');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).not.toThrow();
  });

  it('fails closed, naming the offending var, when one names a provider this deployment does not implement', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).toThrow(/MALWARE_SCANNER_PROVIDER/);
  });

  it('rejects an unsupported DATABASE_PROVIDER even though no port constructs anything from it', async () => {
    setEnv('DATABASE_PROVIDER', 'supabase');
    const { validateProviderEnv } = await import('./providers');
    expect(() => validateProviderEnv()).toThrow(/DATABASE_PROVIDER/);
  });
});

describe('createIdentityPort', () => {
  it('returns the WorkOS pilot/commercial-track identity port by default', async () => {
    const { createIdentityPort } = await import('./providers');
    const { WorkosIdentityPort } = await import('./identity-provider');
    expect(createIdentityPort()).toBeInstanceOf(WorkosIdentityPort);
  });

  it('throws for an unrecognized IDENTITY_PROVIDER instead of silently using WorkOS anyway', async () => {
    setEnv('IDENTITY_PROVIDER', 'okta');
    const { createIdentityPort } = await import('./providers');
    expect(() => createIdentityPort()).toThrow(/IDENTITY_PROVIDER/);
  });
});

describe('createMalwareScanner / createDocumentConverter', () => {
  it('construct the built-in structural adapters by default', async () => {
    const { createMalwareScanner, createDocumentConverter } = await import('./providers');
    expect(createMalwareScanner({} as never)).toBeInstanceOf(BasicSafetyScanner);
    expect(createDocumentConverter({} as never)).toBeInstanceOf(DeterministicTextExtractor);
  });

  it('reject an unrecognized MALWARE_SCANNER_PROVIDER / DOCUMENT_CONVERTER_PROVIDER', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    setEnv('DOCUMENT_CONVERTER_PROVIDER', 'libreoffice');
    const { createMalwareScanner, createDocumentConverter } = await import('./providers');
    expect(() => createMalwareScanner({} as never)).toThrow(/MALWARE_SCANNER_PROVIDER/);
    expect(() => createDocumentConverter({} as never)).toThrow(/DOCUMENT_CONVERTER_PROVIDER/);
  });
});

describe('createEmailPort / createObservabilityPort / createPaymentPort', () => {
  it('construct the pilot Null/Console adapters by default', async () => {
    const { createEmailPort, createObservabilityPort, createPaymentPort } = await import(
      './providers'
    );
    expect(createEmailPort()).toBeInstanceOf(NullEmailPort);
    expect(createObservabilityPort()).toBeInstanceOf(ConsoleObservabilityPort);
    expect(createPaymentPort()).toBeInstanceOf(NullPaymentPort);
  });

  it('reject an unrecognized provider for each', async () => {
    setEnv('EMAIL_PROVIDER', 'sendgrid');
    setEnv('OBSERVABILITY_PROVIDER', 'datadog');
    setEnv('PAYMENT_PROVIDER', 'stripe');
    const { createEmailPort, createObservabilityPort, createPaymentPort } = await import(
      './providers'
    );
    expect(() => createEmailPort()).toThrow(/EMAIL_PROVIDER/);
    expect(() => createObservabilityPort()).toThrow(/OBSERVABILITY_PROVIDER/);
    expect(() => createPaymentPort()).toThrow(/PAYMENT_PROVIDER/);
  });
});
