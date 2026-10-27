import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S26: the real key service must fail closed. A half-set-up environment never falls back to the
 * local key, the gate stays false until the service has proved itself, and the self-test only
 * ever says yes after a real round trip.
 */

const KEYS = [
  'KMS_PROVIDER',
  'KMS_KEY_ID',
  'KMS_AWS_REGION',
  'AWS_ENDPOINT_URL',
  'KMS_LOCAL_MASTER_KEY_BASE64',
  'DEPLOYMENT_MODE',
] as const;
const saved: Record<string, string | undefined> = {};
const LOCAL_KEY = Buffer.alloc(32, 7).toString('base64');

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) setEnv(key, undefined);
  vi.resetModules();
});
afterEach(() => {
  for (const key of KEYS) setEnv(key, saved[key]);
});

describe('createKeyManagementPort with the real key service', () => {
  it('returns no port, never the local key, when the key id or region is missing', async () => {
    setEnv('KMS_PROVIDER', 'aws_kms');
    setEnv('KMS_LOCAL_MASTER_KEY_BASE64', LOCAL_KEY);
    const { createKeyManagementPort } = await import('./providers');
    expect(createKeyManagementPort()).toBeUndefined();
    setEnv('KMS_KEY_ID', 'alias/visastack');
    expect(createKeyManagementPort()).toBeUndefined();
  });

  it('builds the key service port once everything is present, with the local key only as legacy help', async () => {
    setEnv('KMS_PROVIDER', 'aws_kms');
    setEnv('KMS_KEY_ID', 'alias/visastack');
    setEnv('KMS_AWS_REGION', 'us-east-1');
    setEnv('DEPLOYMENT_MODE', 'commercial');
    const { createKeyManagementPort } = await import('./providers');
    const port = createKeyManagementPort();
    expect(port?.currentKeyVersion()).toBe('aws-kms-v1');
    // Commercial mode still refuses the plain local provider.
    setEnv('KMS_PROVIDER', 'local');
    setEnv('KMS_LOCAL_MASTER_KEY_BASE64', LOCAL_KEY);
    expect(() => createKeyManagementPort()).toThrow(/commercial mode/);
  });

  it('keeps the local provider as it was, and rejects an unknown provider name', async () => {
    setEnv('KMS_LOCAL_MASTER_KEY_BASE64', LOCAL_KEY);
    const { createKeyManagementPort } = await import('./providers');
    expect(createKeyManagementPort()?.currentKeyVersion()).toBe('local-v1');
    setEnv('KMS_PROVIDER', 'mystery_kms');
    expect(() => createKeyManagementPort()).toThrow(/unsupported KMS_PROVIDER/);
  });
});

describe('the key service self-test and the readiness gate', () => {
  it('is false until a run has passed, remembers the answer, and fails closed on a failed run', async () => {
    const selfTest = vi.fn();
    vi.doMock('./providers', () => ({
      createKeyManagementPort: () => ({ selfTest }),
    }));
    const { runKmsSelfTest, kmsSelfTestPassed } = await import('./kms-self-test');
    expect(kmsSelfTestPassed()).toBe(false);
    selfTest.mockResolvedValue(true);
    expect(await runKmsSelfTest(1_000)).toBe(true);
    expect(kmsSelfTestPassed()).toBe(true);
    selfTest.mockResolvedValue(false);
    // A pass is remembered for five minutes: no second call to the key service.
    expect(await runKmsSelfTest(1_000 + 60_000)).toBe(true);
    expect(selfTest).toHaveBeenCalledTimes(1);
    expect(await runKmsSelfTest(1_000 + 6 * 60_000)).toBe(false);
    expect(kmsSelfTestPassed()).toBe(false);
    // A failure is remembered only briefly, so one blip does not hold readiness down.
    selfTest.mockResolvedValue(true);
    expect(await runKmsSelfTest(1_000 + 6 * 60_000 + 10_000)).toBe(false);
    expect(await runKmsSelfTest(1_000 + 6 * 60_000 + 40_000)).toBe(true);
  });

  it('shares one call between overlapping runs, and reports no instead of throwing', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const selfTest = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    vi.doMock('./providers', () => ({ createKeyManagementPort: () => ({ selfTest }) }));
    const { runKmsSelfTest } = await import('./kms-self-test');
    const both = Promise.all([runKmsSelfTest(5_000), runKmsSelfTest(5_000)]);
    resolve(true);
    expect(await both).toEqual([true, true]);
    expect(selfTest).toHaveBeenCalledTimes(1);

    vi.resetModules();
    vi.doMock('./providers', () => ({
      createKeyManagementPort: () => {
        throw new Error('the local key refuses commercial mode');
      },
    }));
    const again = await import('./kms-self-test');
    await expect(again.runKmsSelfTest(9_000)).resolves.toBe(false);
  });

  it('answers no when there is no port, or a port that cannot test itself (the local key)', async () => {
    vi.doMock('./providers', () => ({ createKeyManagementPort: () => ({}) }));
    const { runKmsSelfTest } = await import('./kms-self-test');
    expect(await runKmsSelfTest()).toBe(false);
  });

  it('satisfies the realKeyManagement gate only with the full configuration AND a passed self-test', async () => {
    setEnv('KMS_PROVIDER', 'aws_kms');
    setEnv('KMS_KEY_ID', 'alias/visastack');
    setEnv('KMS_AWS_REGION', 'us-east-1');
    const passed = { value: false };
    vi.doMock('./kms-self-test', () => ({ kmsSelfTestPassed: () => passed.value }));
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const gate = () =>
      evaluateCommercialReadiness({ databaseReady: true }).gates.find(
        (g) => g.key === 'realKeyManagement',
      )?.satisfied;
    expect(gate()).toBe(false);
    passed.value = true;
    expect(gate()).toBe(true);
    setEnv('AWS_ENDPOINT_URL', 'http://localhost:4566');
    expect(gate()).toBe(false);
    setEnv('AWS_ENDPOINT_URL', undefined);
    setEnv('KMS_KEY_ID', undefined);
    expect(gate()).toBe(false);
    setEnv('KMS_KEY_ID', 'alias/visastack');
    setEnv('KMS_PROVIDER', 'local');
    expect(gate()).toBe(false);
  });
});
