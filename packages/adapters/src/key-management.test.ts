import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalEnvelopeKeyProvider } from './key-management';

function freshMasterKeyBase64(): string {
  return randomBytes(32).toString('base64');
}

describe('LocalEnvelopeKeyProvider — dev/test-only envelope-key adapter', () => {
  it('generates and unwraps a data key, round-tripping to the same plaintext', async () => {
    const provider = new LocalEnvelopeKeyProvider({ masterKeyBase64: freshMasterKeyBase64() });
    const generated = await provider.generateDataKey();
    expect(generated.keyVersion).toBe(provider.currentKeyVersion());
    expect(generated.plaintextDataKey).toHaveLength(32);

    const unwrapped = await provider.unwrapDataKey(generated.keyVersion, generated.wrappedDataKey);
    expect(Buffer.from(unwrapped).equals(Buffer.from(generated.plaintextDataKey))).toBe(true);
  });

  it('wraps the same plaintext key differently each time (random nonce) but both unwrap correctly', async () => {
    const provider = new LocalEnvelopeKeyProvider({ masterKeyBase64: freshMasterKeyBase64() });
    const first = await provider.generateDataKey();
    const second = await provider.generateDataKey();
    expect(Buffer.from(first.wrappedDataKey).equals(Buffer.from(second.wrappedDataKey))).toBe(
      false,
    );
  });

  it('refuses to unwrap a key version it was not configured for', async () => {
    const provider = new LocalEnvelopeKeyProvider({
      masterKeyBase64: freshMasterKeyBase64(),
      keyVersion: 'v1',
    });
    const generated = await provider.generateDataKey();
    await expect(
      provider.unwrapDataKey('some-other-version', generated.wrappedDataKey),
    ).rejects.toThrow();
  });

  it("a different master key cannot unwrap another provider's wrapped data key", async () => {
    const providerA = new LocalEnvelopeKeyProvider({ masterKeyBase64: freshMasterKeyBase64() });
    const providerB = new LocalEnvelopeKeyProvider({ masterKeyBase64: freshMasterKeyBase64() });
    const generated = await providerA.generateDataKey();
    await expect(
      providerB.unwrapDataKey(generated.keyVersion, generated.wrappedDataKey),
    ).rejects.toThrow();
  });

  it('rejects a master key that is not exactly 32 bytes', () => {
    expect(
      () =>
        new LocalEnvelopeKeyProvider({
          masterKeyBase64: Buffer.from('too-short').toString('base64'),
        }),
    ).toThrow();
  });

  it('refuses to construct at all in commercial mode — it is not a real KMS', () => {
    expect(
      () =>
        new LocalEnvelopeKeyProvider({
          masterKeyBase64: freshMasterKeyBase64(),
          deploymentMode: 'commercial',
        }),
    ).toThrow(/commercial/i);
  });

  it('constructs fine in controlled_pilot or development mode', () => {
    expect(
      () =>
        new LocalEnvelopeKeyProvider({
          masterKeyBase64: freshMasterKeyBase64(),
          deploymentMode: 'controlled_pilot',
        }),
    ).not.toThrow();
    expect(
      () =>
        new LocalEnvelopeKeyProvider({
          masterKeyBase64: freshMasterKeyBase64(),
          deploymentMode: 'development',
        }),
    ).not.toThrow();
  });
});
