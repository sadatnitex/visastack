import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The database facts behind two commercial readiness gates (S27): read where readiness is
 * evaluated, remembered briefly for the synchronous checks, unknown otherwise.
 */

const mocks = vi.hoisted(() => ({
  loadAiProviderReadiness: vi.fn(),
  loadScannerEvidence: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  loadAiProviderReadiness: (...args: unknown[]) => mocks.loadAiProviderReadiness(...args),
  loadScannerEvidence: (...args: unknown[]) => mocks.loadScannerEvidence(...args),
}));

const signalsModule = await import('./readiness-signals');
const {
  READINESS_SIGNALS_TTL_MS,
  UNKNOWN_READINESS_SIGNALS,
  forgetReadinessSignals,
  readReadinessSignals,
  rememberedReadinessSignals,
} = signalsModule;

const db = {} as Parameters<typeof readReadinessSignals>[0];

beforeEach(() => {
  vi.clearAllMocks();
  forgetReadinessSignals();
  vi.stubEnv('MALWARE_SCANNER_PROVIDER', undefined);
  mocks.loadAiProviderReadiness.mockResolvedValue({
    kind: 'active',
    hasKey: true,
    termsRecorded: true,
  });
  mocks.loadScannerEvidence.mockResolvedValue({ verifiedAt: new Date(), engine: 'ClamAV 1.4' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readReadinessSignals', () => {
  it('is unknown, reads nothing and remembers nothing without a usable database', async () => {
    expect(await readReadinessSignals(undefined)).toEqual(UNKNOWN_READINESS_SIGNALS);
    expect(mocks.loadAiProviderReadiness).not.toHaveBeenCalled();
    expect(rememberedReadinessSignals()).toEqual(UNKNOWN_READINESS_SIGNALS);
  });

  it('reads the AI settings, and the scan runner proof only for the private scan runner', async () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(await readReadinessSignals(db, now)).toEqual({
      aiProvider: { kind: 'active', hasKey: true, termsRecorded: true },
      scannerEvidenceFresh: false,
    });
    expect(mocks.loadScannerEvidence).not.toHaveBeenCalled();

    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    expect((await readReadinessSignals(db, now)).scannerEvidenceFresh).toBe(true);
    expect(mocks.loadScannerEvidence).toHaveBeenCalledWith(db, new Date(now));

    mocks.loadScannerEvidence.mockResolvedValue(null);
    expect((await readReadinessSignals(db, now)).scannerEvidenceFresh).toBe(false);
  });

  it('remembers the latest read only while it is trusted, and forgets it on request', async () => {
    const now = Date.UTC(2026, 9, 29, 12);
    const read = await readReadinessSignals(db, now);
    expect(rememberedReadinessSignals(now + READINESS_SIGNALS_TTL_MS - 1)).toEqual(read);
    expect(rememberedReadinessSignals(now + READINESS_SIGNALS_TTL_MS)).toEqual(
      UNKNOWN_READINESS_SIGNALS,
    );
    // A clock that went backwards does not stretch the trust window.
    expect(rememberedReadinessSignals(now - 1)).toEqual(UNKNOWN_READINESS_SIGNALS);
    await readReadinessSignals(db, now);
    forgetReadinessSignals();
    expect(rememberedReadinessSignals(now)).toEqual(UNKNOWN_READINESS_SIGNALS);
  });
});
