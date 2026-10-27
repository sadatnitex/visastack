import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { type DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import { AwsKmsKeyProvider, type KmsClientLike } from './aws-kms-key-provider';
import { LocalEnvelopeKeyProvider } from './key-management';

/**
 * A stand-in for AWS KMS. Like the real service it binds the ciphertext to the key id and the
 * encryption context, so a wrong context or key id fails to open; it also records what it was
 * asked, so a test can prove the master key never leaves it and nothing readable is logged.
 */
class FakeKms implements KmsClientLike {
  readonly calls: Array<{ kind: 'encrypt' | 'decrypt'; context: Record<string, string> }> = [];
  failNext = false;
  private readonly master = randomBytes(32);

  async send(command: EncryptCommand | DecryptCommand): Promise<unknown> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('AccessDeniedException');
    }
    const input = command.input;
    const aad = Buffer.from(JSON.stringify([input.KeyId, input.EncryptionContext]));
    if (command instanceof EncryptCommand) {
      this.calls.push({ kind: 'encrypt', context: { ...input.EncryptionContext } });
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.master, nonce);
      cipher.setAAD(aad);
      const body = Buffer.concat([
        cipher.update(Buffer.from(command.input.Plaintext as Uint8Array)),
        cipher.final(),
      ]);
      return { CiphertextBlob: Buffer.concat([nonce, cipher.getAuthTag(), body]) };
    }
    this.calls.push({ kind: 'decrypt', context: { ...input.EncryptionContext } });
    const blob = Buffer.from((command as DecryptCommand).input.CiphertextBlob as Uint8Array);
    const decipher = createDecipheriv('aes-256-gcm', this.master, blob.subarray(0, 12));
    decipher.setAAD(aad);
    decipher.setAuthTag(blob.subarray(12, 28));
    return { Plaintext: Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]) };
  }
}

const KEY_ID = 'arn:aws:kms:us-east-1:111122223333:key/abcd-1234';

describe('AwsKmsKeyProvider', () => {
  it('wraps and opens a data key through KMS, recording which key wrapped it', async () => {
    const kms = new FakeKms();
    const provider = new AwsKmsKeyProvider({ keyId: KEY_ID, client: kms });
    const generated = await provider.generateDataKey();
    expect(generated.keyVersion).toBe('aws-kms-v1');
    expect(generated.wrappingKeyId).toBe(`aws-kms:${KEY_ID}`);
    expect(generated.plaintextDataKey).toHaveLength(32);
    // What is stored is KMS's ciphertext, never the data key.
    expect(
      Buffer.from(generated.wrappedDataKey).includes(Buffer.from(generated.plaintextDataKey)),
    ).toBe(false);
    const opened = await provider.unwrapDataKey(
      generated.keyVersion,
      generated.wrappedDataKey,
      generated.wrappingKeyId,
    );
    expect(Buffer.from(opened).equals(Buffer.from(generated.plaintextDataKey))).toBe(true);
  });

  it('binds every call to the purpose and the data key version', async () => {
    const kms = new FakeKms();
    const provider = new AwsKmsKeyProvider({ keyId: KEY_ID, client: kms });
    const generated = await provider.generateDataKey();
    await provider.unwrapDataKey('aws-kms-v1', generated.wrappedDataKey, generated.wrappingKeyId);
    expect(kms.calls.map((call) => call.kind)).toEqual(['encrypt', 'decrypt']);
    for (const call of kms.calls) {
      expect(call.context).toEqual({ purpose: 'visastack:data-key', keyVersion: 'aws-kms-v1' });
    }
  });

  it('refuses a wrapped key presented under a different version or a different KMS key', async () => {
    const provider = new AwsKmsKeyProvider({ keyId: KEY_ID, client: new FakeKms() });
    const generated = await provider.generateDataKey();
    await expect(
      provider.unwrapDataKey('aws-kms-v2', generated.wrappedDataKey, generated.wrappingKeyId),
    ).rejects.toThrow();
    await expect(
      provider.unwrapDataKey('aws-kms-v1', generated.wrappedDataKey, 'aws-kms:another-key'),
    ).rejects.toThrow('different KMS key');
  });

  it('opens keys still wrapped by the local key only while a legacy local key is configured', async () => {
    const masterKeyBase64 = randomBytes(32).toString('base64');
    const local = new LocalEnvelopeKeyProvider({ masterKeyBase64, deploymentMode: 'pilot' });
    const legacyKey = await local.generateDataKey();
    const withLegacy = new AwsKmsKeyProvider({
      keyId: KEY_ID,
      client: new FakeKms(),
      legacyLocalMasterKeyBase64: masterKeyBase64,
    });
    const opened = await withLegacy.unwrapDataKey('local-v1', legacyKey.wrappedDataKey, null);
    expect(Buffer.from(opened).equals(Buffer.from(legacyKey.plaintextDataKey))).toBe(true);
    const without = new AwsKmsKeyProvider({ keyId: KEY_ID, client: new FakeKms() });
    await expect(without.unwrapDataKey('local-v1', legacyKey.wrappedDataKey, null)).rejects.toThrow(
      'no legacy local key',
    );
  });

  it('re-wraps an existing data key without changing it', async () => {
    const masterKeyBase64 = randomBytes(32).toString('base64');
    const local = new LocalEnvelopeKeyProvider({ masterKeyBase64, deploymentMode: 'pilot' });
    const old = await local.generateDataKey();
    const provider = new AwsKmsKeyProvider({
      keyId: KEY_ID,
      client: new FakeKms(),
      legacyLocalMasterKeyBase64: masterKeyBase64,
    });
    const plain = await provider.unwrapDataKey('local-v1', old.wrappedDataKey, null);
    const moved = await provider.rewrapDataKey('local-v1', plain);
    expect(moved.wrappingKeyId).toBe(`aws-kms:${KEY_ID}`);
    const again = await provider.unwrapDataKey(
      'local-v1',
      moved.wrappedDataKey,
      moved.wrappingKeyId,
    );
    expect(Buffer.from(again).equals(Buffer.from(old.plaintextDataKey))).toBe(true);
  });

  it('keeps the legacy local key from ever wrapping anything new', async () => {
    const provider = new AwsKmsKeyProvider({
      keyId: KEY_ID,
      client: new FakeKms(),
      legacyLocalMasterKeyBase64: randomBytes(32).toString('base64'),
    });
    const generated = await provider.generateDataKey();
    expect(generated.wrappingKeyId?.startsWith('aws-kms:')).toBe(true);
  });

  it('self-test passes with a working key service and fails closed when it is refused', async () => {
    const kms = new FakeKms();
    const provider = new AwsKmsKeyProvider({ keyId: KEY_ID, client: kms });
    expect(await provider.selfTest()).toBe(true);
    kms.failNext = true;
    expect(await provider.selfTest()).toBe(false);
  });

  it('needs a key id', () => {
    expect(() => new AwsKmsKeyProvider({ keyId: '  ', client: new FakeKms() })).toThrow();
  });

  it('shows no key material in an error from the key service', async () => {
    const kms = new FakeKms();
    const provider = new AwsKmsKeyProvider({ keyId: KEY_ID, client: kms });
    kms.failNext = true;
    const error = await provider.generateDataKey().catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toMatch(/[A-Za-z0-9+/]{40,}/);
  });
});
