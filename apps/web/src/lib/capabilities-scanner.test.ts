import type { Db } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S4: the scanner in the private worker (`MALWARE_SCANNER_PROVIDER=github_clamav`) counts as
 * available only while the worker's own recent verification record exists. Only the evidence
 * read is replaced; the capability decision runs for real.
 */
const services = vi.hoisted(() => ({ loadScannerEvidence: vi.fn() }));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  loadScannerEvidence: (...args: unknown[]) => services.loadScannerEvidence(...args),
  hasAnyAiProviderConfig: async () => false,
  getActiveAiProviderConfig: async () => undefined,
}));

const FAKE_DB = {} as unknown as Db;
const KEYS = ['MALWARE_SCANNER_PROVIDER', 'CLAMAV_SOCKET_PATH'] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  services.loadScannerEvidence.mockReset();
});
afterEach(() => {
  for (const key of KEYS) setEnv(key, saved[key]);
});

async function scanning(db: Db | undefined) {
  const { resolvePlatformCapabilities } = await import('./capabilities');
  return (await resolvePlatformCapabilities(db)).malwareScanning;
}

describe('malware scanning capability with the private worker', () => {
  it('is available only with a recent verification record', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    services.loadScannerEvidence.mockResolvedValue({ verifiedAt: new Date(), engine: 'ClamAV 1' });
    expect(await scanning(FAKE_DB)).toBe('available');
    services.loadScannerEvidence.mockResolvedValue(null);
    expect(await scanning(FAKE_DB)).toBe('unconfigured');
  });

  it('stays unconfigured when the database cannot be reached', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    expect(await scanning(undefined)).toBe('unconfigured');
    expect(services.loadScannerEvidence).not.toHaveBeenCalled();
  });

  it('never looks for evidence for another provider', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'builtin');
    services.loadScannerEvidence.mockResolvedValue({ verifiedAt: new Date(), engine: 'ClamAV 1' });
    expect(await scanning(FAKE_DB)).toBe('unconfigured');
    expect(services.loadScannerEvidence).not.toHaveBeenCalled();
  });

  it('keeps the direct engine setting as it was', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    setEnv('CLAMAV_SOCKET_PATH', '/var/run/clamav/clamd.ctl');
    expect(await scanning(FAKE_DB)).toBe('available');
  });
});
