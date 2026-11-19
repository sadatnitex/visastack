import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessSignals } from './readiness-signals';

/**
 * Owner decision, 19 Nov 2026 (exact words): "dont conplciate. we will publicly use it with all
 * things open state, stop telling madeup details etc, the site must be ready and live with all
 * that's requires being open, witthiut any other security neasures". With every owner deferral
 * set, real personal data switches on in the controlled pilot (no change of deployment mode), the
 * AI data mode follows it, and unsetting the deferrals rolls all of it back.
 */

/** Every owner deferral the 19 Nov decision needs, with its register id. */
const DEFERRALS: Record<string, string> = {
  COMMERCIAL_READINESS_DEFER_REAL_MALWARE_SCANNER: 'H29',
  COMMERCIAL_READINESS_DEFER_REAL_KEY_MANAGEMENT: 'H33',
  COMMERCIAL_READINESS_DEFER_INCIDENT_OWNER: 'H34',
  COMMERCIAL_READINESS_DEFER_TERMS_AND_PRIVACY_NOTICE: 'H35',
  COMMERCIAL_READINESS_DEFER_BACKUP_RESTORE_VERIFICATION: 'H36',
  COMMERCIAL_READINESS_DEFER_AUTHENTICATED_PRODUCTION_E2E: 'H37',
  COMMERCIAL_READINESS_DEFER_TENANT_ISOLATION_SUITE: 'H38',
  COMMERCIAL_READINESS_DEFER_PERMISSION_MATRIX: 'H39',
  COMMERCIAL_READINESS_DEFER_EXTERNAL_OBJECT_DELETION_VERIFICATION: 'H40',
  COMMERCIAL_READINESS_DEFER_NO_CRITICAL_HIGH_FINDINGS: 'H41',
  COMMERCIAL_READINESS_DEFER_PRIVACY_CONSENT_CONFIGURATION: 'H42',
};

/** The live settings production already has (sign-in, private storage, step-up). */
const LIVE: Record<string, string> = {
  VERCEL_ENV: 'production',
  NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth',
  NEON_AUTH_COOKIE_SECRET: 'x'.repeat(64),
  BLOB_READ_WRITE_TOKEN: 'x',
  STEP_UP_SIGNING_SECRET: 'x',
};

/** Stands in for the database read: resolves to (and remembers) `fromDatabase`, after `delayMs`. */
const fromDatabase: { value: ReadinessSignals; delayMs: number } = {
  value: { aiProvider: { kind: 'none_active' }, scannerEvidenceFresh: false },
  delayMs: 0,
};
const read = vi.fn(
  () =>
    new Promise<ReadinessSignals>((resolve) =>
      setTimeout(() => {
        remembered.value = fromDatabase.value;
        resolve(fromDatabase.value);
      }, fromDatabase.delayMs),
    ),
);

const remembered: { value: ReadinessSignals } = {
  value: { aiProvider: { kind: 'none_active' }, scannerEvidenceFresh: false },
};

async function load() {
  vi.resetModules();
  vi.doMock('./readiness-signals', () => ({
    rememberedReadinessSignals: () => remembered.value,
    readReadinessSignals: read,
  }));
  const wording = await import('./real-data-wording');
  const { currentAiDataMode } = await import('./ai-data-rule');
  const { getPlatformCapabilities } = await import('./capabilities');
  return {
    ...wording,
    aiMode: currentAiDataMode,
    capability: () => getPlatformCapabilities().realApplicantData,
  };
}

function stub(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

beforeEach(() => {
  // A clean slate: no deployment mode, no beta switch, no attestation and no deferral.
  for (const name of [
    'DEPLOYMENT_MODE',
    'PUBLIC_BETA_OPEN',
    'HOSTING_PLATFORM',
    'MALWARE_SCANNER_PROVIDER',
    'KMS_PROVIDER',
    'AI_ENABLED',
    ...Object.keys(DEFERRALS),
  ]) {
    vi.stubEnv(name, undefined);
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('COMMERCIAL_READINESS_')) vi.stubEnv(name, undefined);
  }
  remembered.value = { aiProvider: { kind: 'none_active' }, scannerEvidenceFresh: false };
  fromDatabase.value = { aiProvider: { kind: 'none_active' }, scannerEvidenceFresh: false };
  fromDatabase.delayMs = 0;
  read.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('./readiness-signals');
  vi.resetModules();
});

describe('real personal data after the owner decision of 19 Nov 2026', () => {
  it('stays off where CI runs (controlled pilot, no deferral settings): made-up wording and AI mode', async () => {
    stub({ ...LIVE, DEPLOYMENT_MODE: 'controlled_pilot' });
    const m = await load();
    expect(m.capability()).toBe('disabled');
    expect(m.realDataOpen()).toBe(false);
    expect(m.ownDetailsWelcome()).toBe(false);
    expect(m.aiMode()).toBe('synthetic_only');
  }, 20_000);

  it('switches on in the controlled pilot with every deferral set, without commercial mode', async () => {
    stub({ ...LIVE, ...DEFERRALS, DEPLOYMENT_MODE: 'controlled_pilot' });
    const m = await load();
    expect(m.capability()).toBe('available');
    expect(m.realDataOpen()).toBe(true);
    expect(m.ownDetailsWelcome()).toBe(true);
    expect(m.aiMode()).toBe('real_applicant_data');
  }, 20_000);

  it('rolls back when the deferral settings are unset again', async () => {
    stub({ ...LIVE, ...DEFERRALS, DEPLOYMENT_MODE: 'controlled_pilot' });
    expect((await load()).realDataOpen()).toBe(true);
    for (const name of Object.keys(DEFERRALS)) vi.stubEnv(name, undefined);
    const m = await load();
    expect(m.capability()).toBe('disabled');
    expect(m.realDataOpen()).toBe(false);
    expect(m.aiMode()).toBe('synthetic_only');
  }, 20_000);

  it('stays off when any one deferral is missing or carries the wrong register id', async () => {
    for (const [name, id] of Object.entries(DEFERRALS)) {
      vi.unstubAllEnvs();
      stub({ ...LIVE, ...DEFERRALS, DEPLOYMENT_MODE: 'controlled_pilot' });
      vi.stubEnv(name, undefined);
      expect((await load()).realDataOpen()).toBe(false);
      vi.stubEnv(name, id === 'H01' ? 'H29' : 'H01');
      expect((await load()).realDataOpen()).toBe(false);
    }
  }, 60_000);

  it('never switches on for local development or tests, whatever is set', async () => {
    stub({ ...LIVE, ...DEFERRALS, DEPLOYMENT_MODE: 'development' });
    const m = await load();
    expect(m.capability()).toBe('disabled');
    expect(m.realDataOpen()).toBe(false);
  }, 20_000);

  it('never guesses unknown database facts: the words stay closed until they are read', async () => {
    stub({ ...LIVE, ...DEFERRALS, DEPLOYMENT_MODE: 'controlled_pilot' });
    remembered.value = { aiProvider: { kind: 'unknown' }, scannerEvidenceFresh: false };
    const m = await load();
    expect(m.capability()).toBe('disabled');
    expect(m.realDataOpen()).toBe(false);
    expect(m.ownDetailsWelcome()).toBe(false);
    // No database address: nothing to read, still closed.
    expect(await m.resolveRealDataOpen()).toBe(false);
    expect(read).not.toHaveBeenCalled();
  }, 20_000);

  it('reads the facts once when unknown, then follows them; a failing AI gate keeps the words closed', async () => {
    stub({
      ...LIVE,
      ...DEFERRALS,
      DEPLOYMENT_MODE: 'controlled_pilot',
      DATABASE_URL: 'postgresql://user:pass@db.placeholder.invalid/neondb',
    });
    remembered.value = { aiProvider: { kind: 'unknown' }, scannerEvidenceFresh: false };
    let m = await load();
    expect(await m.resolveRealDataOpen()).toBe(true);
    expect(await m.resolveOwnDetailsWelcome()).toBe(true);
    // Known now, so no second read.
    expect(read).toHaveBeenCalledTimes(1);
    remembered.value = { aiProvider: { kind: 'unknown' }, scannerEvidenceFresh: false };
    fromDatabase.value = {
      aiProvider: {
        kind: 'active',
        primary: { hasKey: true, termsRecorded: false },
        fallback: null,
      },
      scannerEvidenceFresh: false,
    };
    m = await load();
    expect(await m.resolveRealDataOpen()).toBe(false);
  }, 20_000);

  it('waits at most a moment for a slow read, then shows the closed words', async () => {
    stub({
      ...LIVE,
      ...DEFERRALS,
      DEPLOYMENT_MODE: 'controlled_pilot',
      DATABASE_URL: 'postgresql://user:pass@db.placeholder.invalid/neondb',
    });
    remembered.value = { aiProvider: { kind: 'unknown' }, scannerEvidenceFresh: false };
    const m = await load();
    fromDatabase.delayMs = m.REAL_DATA_FACTS_WAIT_MS + 2000;
    const started = Date.now();
    expect(await m.resolveRealDataOpen()).toBe(false);
    expect(Date.now() - started).toBeLessThan(m.REAL_DATA_FACTS_WAIT_MS + 1000);
  }, 20_000);

  it('welcomes own details during the open public beta even before real data is switched on', async () => {
    stub({ ...LIVE, DEPLOYMENT_MODE: 'controlled_pilot', PUBLIC_BETA_OPEN: 'true' });
    const m = await load();
    expect(m.realDataOpen()).toBe(false);
    expect(m.ownDetailsWelcome()).toBe(true);
  }, 20_000);
});
