import { randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import type { GeneratedDataKey, RewrappingKeyManagementPort } from '@visastack/services';
import { LocalEnvelopeKeyProvider } from './key-management';

/**
 * Real envelope-key provider backed by AWS KMS (S26, M18). The master key never leaves KMS: a
 * data key is wrapped with KMS `Encrypt` and opened with `Decrypt`, each call bound to an
 * encryption context naming the purpose and the data key's version, so a wrapped key copied
 * onto another version fails to open. Field encryption itself is unchanged (AES-256-GCM in
 * `protected-fields.ts`); only who holds the key that wraps the data keys changes.
 *
 * Keys wrapped before the move are wrapped by the local development key. While any remain, this
 * provider opens them with that key (`legacyLocalMasterKeyBase64`) and the re-wrap job moves
 * them to KMS without touching an encrypted value; once none remain, that setting is removed.
 */

export const AWS_KMS_KEY_VERSION = 'aws-kms-v1';
export const AWS_KMS_WRAPPING_PREFIX = 'aws-kms:';
const CONTEXT_PURPOSE = 'visastack:data-key';

/** The one method of the AWS client this provider uses, so tests can supply a stand-in. */
export interface KmsClientLike {
  send(command: EncryptCommand | DecryptCommand): Promise<unknown>;
}

export interface AwsKmsKeyProviderOptions {
  /** A KMS key id, key ARN or alias ARN. */
  readonly keyId: string;
  readonly region?: string;
  /** Injectable for tests; defaults to a real client using the standard AWS credential chain. */
  readonly client?: KmsClientLike;
  /** Base64 local master key, only to open data keys not yet moved to KMS. */
  readonly legacyLocalMasterKeyBase64?: string;
  readonly keyVersion?: string;
}

function encryptionContext(keyVersion: string): Record<string, string> {
  return { purpose: CONTEXT_PURPOSE, keyVersion };
}

export class AwsKmsKeyProvider implements RewrappingKeyManagementPort {
  private readonly client: KmsClientLike;
  private readonly keyId: string;
  private readonly keyVersion: string;
  private readonly legacy: LocalEnvelopeKeyProvider | undefined;

  constructor(options: AwsKmsKeyProviderOptions) {
    if (!options.keyId.trim()) throw new Error('AwsKmsKeyProvider needs a KMS key id');
    this.keyId = options.keyId.trim();
    this.keyVersion = options.keyVersion ?? AWS_KMS_KEY_VERSION;
    this.client =
      options.client ??
      new KMSClient({
        ...(options.region ? { region: options.region } : {}),
        // Fail fast: a stuck key service must not hold a request open.
        maxAttempts: 3,
      });
    // The local provider refuses commercial mode; here it is read-only migration help, so the
    // refusal is lifted for this one use and nothing new is ever wrapped with it.
    this.legacy = options.legacyLocalMasterKeyBase64
      ? new LocalEnvelopeKeyProvider({
          masterKeyBase64: options.legacyLocalMasterKeyBase64,
          deploymentMode: 'migration',
        })
      : undefined;
  }

  currentKeyVersion(): string {
    return this.keyVersion;
  }

  currentWrappingKeyId(): string {
    return `${AWS_KMS_WRAPPING_PREFIX}${this.keyId}`;
  }

  async generateDataKey(): Promise<GeneratedDataKey> {
    const plaintextDataKey = randomBytes(32);
    const wrapped = await this.wrap(this.keyVersion, plaintextDataKey);
    return {
      keyVersion: this.keyVersion,
      plaintextDataKey,
      wrappedDataKey: wrapped.wrappedDataKey,
      wrappingKeyId: wrapped.wrappingKeyId,
    };
  }

  async rewrapDataKey(
    keyVersion: string,
    plaintextDataKey: Uint8Array,
  ): Promise<{ readonly wrappedDataKey: Uint8Array; readonly wrappingKeyId: string }> {
    return this.wrap(keyVersion, plaintextDataKey);
  }

  async unwrapDataKey(
    keyVersion: string,
    wrappedDataKey: Uint8Array,
    wrappingKeyId?: string | null,
  ): Promise<Uint8Array> {
    if (wrappingKeyId?.startsWith(AWS_KMS_WRAPPING_PREFIX)) {
      // The recorded key id is checked too, so a row wrapped by a different KMS key never opens.
      const recorded = wrappingKeyId.slice(AWS_KMS_WRAPPING_PREFIX.length);
      if (recorded !== this.keyId) throw new Error('data key was wrapped by a different KMS key');
      const response = (await this.client.send(
        new DecryptCommand({
          CiphertextBlob: wrappedDataKey,
          KeyId: this.keyId,
          EncryptionContext: encryptionContext(keyVersion),
        }),
      )) as { Plaintext?: Uint8Array };
      if (!response.Plaintext || response.Plaintext.length !== 32) {
        throw new Error('KMS did not return a 256-bit data key');
      }
      return response.Plaintext;
    }
    if (!this.legacy) {
      throw new Error(
        'data key is wrapped by the local key and no legacy local key is configured to open it',
      );
    }
    return this.legacy.unwrapDataKey(keyVersion, wrappedDataKey);
  }

  /**
   * Wrap and open a throwaway key end to end: true only when the key service accepts the
   * configured key id with these credentials. Used once at readiness time; never throws.
   */
  async selfTest(): Promise<boolean> {
    try {
      const probe = randomBytes(32);
      const wrapped = await this.wrap('self-test', probe);
      const opened = await this.unwrapDataKey(
        'self-test',
        wrapped.wrappedDataKey,
        wrapped.wrappingKeyId,
      );
      return Buffer.from(opened).equals(probe);
    } catch {
      return false;
    }
  }

  private async wrap(
    keyVersion: string,
    plaintext: Uint8Array,
  ): Promise<{ readonly wrappedDataKey: Uint8Array; readonly wrappingKeyId: string }> {
    const response = (await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: plaintext,
        EncryptionContext: encryptionContext(keyVersion),
      }),
    )) as { CiphertextBlob?: Uint8Array };
    if (!response.CiphertextBlob) throw new Error('KMS did not return a wrapped key');
    return { wrappedDataKey: response.CiphertextBlob, wrappingKeyId: this.currentWrappingKeyId() };
  }
}
