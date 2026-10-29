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
    primary: { hasKey: true, termsRecorded: true },
    fallback: null,
  });
  mocks.loadScannerEvidence.mockResolvedValue({ verifiedAt: new Date(), engine: 'ClamAV 1.4' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readReadinessSignals', () => {
  it('is unknown, reads nothing and drops the remembered answer without a usable database', async () => {
    const now = Date.UTC(2026, 9, 29, 12);
    await readReadinessSignals(db, now);
    expect(rememberedReadinessSignals(now).aiProvider.kind).toBe('active');
    mocks.loadAiProviderReadiness.mockClear();
    expect(await readReadinessSignals(undefined, now)).toEqual(UNKNOWN_READINESS_SIGNALS);
    expect(mocks.loadAiProviderReadiness).not.toHaveBeenCalled();
    expect(rememberedReadinessSignals(now)).toEqual(UNKNOWN_READINESS_SIGNALS);
  });

  it('never remembers a read that was still running when the answer was forgotten', async () => {
    const now = Date.UTC(2026, 9, 29, 12);
    let finish: (value: unknown) => void = () => undefined;
    mocks.loadAiProviderReadiness.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const slow = readReadinessSignals(db, now);
    // An AI settings change lands while the old read is still out.
    forgetReadinessSignals();
    finish({ kind: 'active', primary: { hasKey: true, termsRecorded: true }, fallback: null });
    expect((await slow).aiProvider.kind).toBe('active');
    expect(rememberedReadinessSignals(now)).toEqual(UNKNOWN_READINESS_SIGNALS);
    // The same goes for a read with no usable database arriving in between.
    let finishAgain: (value: unknown) => void = () => undefined;
    mocks.loadAiProviderReadiness.mockReturnValueOnce(
      new Promise((resolve) => {
        finishAgain = resolve;
      }),
    );
    const again = readReadinessSignals(db, now);
    await readReadinessSignals(undefined, now);
    finishAgain({ kind: 'none_active' });
    await again;
    expect(rememberedReadinessSignals(now)).toEqual(UNKNOWN_READINESS_SIGNALS);
  });

  it('shares one read between overlapping evaluations on the same handle, and only there', async () => {
    const [first, second] = await Promise.all([readReadinessSignals(db), readReadinessSignals(db)]);
    expect(first).toBe(second);
    expect(mocks.loadAiProviderReadiness).toHaveBeenCalledTimes(1);
    // Another handle, or a caller's own clock, gets its own read with its own handle and time.
    const other = {} as Parameters<typeof readReadinessSignals>[0];
    const now = Date.UTC(2026, 9, 29, 12);
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    await Promise.all([
      readReadinessSignals(db),
      readReadinessSignals(other),
      readReadinessSignals(db, now),
    ]);
    expect(mocks.loadAiProviderReadiness).toHaveBeenCalledTimes(4);
    expect(mocks.loadAiProviderReadiness.mock.calls.slice(1).map(([handle]) => handle)).toEqual([
      db,
      other,
      db,
    ]);
    expect(mocks.loadScannerEvidence).toHaveBeenLastCalledWith(db, new Date(now));
    // A finished read is not reused.
    await readReadinessSignals(db);
    expect(mocks.loadAiProviderReadiness).toHaveBeenCalledTimes(5);
  });

  it('passes the providers the app can call, so the fallback rule matches the gateway', async () => {
    await readReadinessSignals(db, Date.UTC(2026, 9, 29, 12));
    const [, options] = mocks.loadAiProviderReadiness.mock.calls[0] ?? [];
    expect([...(options as { implementedProviders: Set<string> }).implementedProviders]).toEqual([
      'openai',
      'anthropic',
      'gemini',
    ]);
  });

  it('reads the AI settings, and the scan runner proof only for the private scan runner', async () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(await readReadinessSignals(db, now)).toEqual({
      aiProvider: {
        kind: 'active',
        primary: { hasKey: true, termsRecorded: true },
        fallback: null,
      },
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
