import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { GeneratedDataKey, KeyManagementPort } from '@visastack/services';

/**
 * Local/dev/test envelope-key provider (Commercial V1 SEC-03). Wraps a
 * generated 256-bit data key by encrypting it with a master key supplied at
 * construction time, using the same AES-256-GCM primitive field encryption
 * itself uses (Node's built-in `crypto`, OpenSSL-backed — not a hand-rolled
 * cipher).
 *
 * This is explicitly NOT a real KMS: the "master key" is just a secret this
 * process holds directly (from an environment variable in practice), so a
 * database dump alongside that one environment variable would be enough to
 * decrypt every protected field — precisely the property SEC-03 requires a
 * real deployment NOT to have. `assertNotCommercialMode` makes that
 * impossible to overlook: this adapter refuses to construct at all when
 * `DEPLOYMENT_MODE=commercial`, the same pattern this repo already uses for
 * `NullEmailPort`-class pilot-only adapters.
 */

const DEFAULT_KEY_VERSION = 'local-v1';
const NONCE_LENGTH = 12;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules — matches apps/web/src/lib/ai.ts and step-up.ts's own helper). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export interface LocalEnvelopeKeyProviderOptions {
  /** Base64-encoded 32-byte (256-bit) master key. Never logged, never persisted by this class. */
  readonly masterKeyBase64: string;
  readonly keyVersion?: string;
  /** Injectable for tests; defaults to reading `process.env.DEPLOYMENT_MODE`. */
  readonly deploymentMode?: string | undefined;
}

function assertNotCommercialMode(deploymentMode: string | undefined): void {
  if (deploymentMode === 'commercial') {
    throw new Error(
      'LocalEnvelopeKeyProvider must never be used in commercial mode — it is not a real KMS. ' +
        'Configure a real KeyManagementPort adapter before activating commercial mode.',
    );
  }
}

export class LocalEnvelopeKeyProvider implements KeyManagementPort {
  private readonly masterKey: Buffer;
  private readonly keyVersion: string;

  constructor(options: LocalEnvelopeKeyProviderOptions) {
    assertNotCommercialMode(options.deploymentMode ?? readEnv('DEPLOYMENT_MODE'));
    const masterKey = Buffer.from(options.masterKeyBase64, 'base64');
    if (masterKey.length !== 32) {
      throw new Error(
        'LocalEnvelopeKeyProvider master key must decode to exactly 32 bytes (AES-256)',
      );
    }
    this.masterKey = masterKey;
    this.keyVersion = options.keyVersion ?? DEFAULT_KEY_VERSION;
  }

  currentKeyVersion(): string {
    return this.keyVersion;
  }

  async generateDataKey(): Promise<GeneratedDataKey> {
    const plaintextDataKey = randomBytes(32);
    return {
      keyVersion: this.keyVersion,
      plaintextDataKey,
      wrappedDataKey: this.wrap(plaintextDataKey),
    };
  }

  async unwrapDataKey(keyVersion: string, wrappedDataKey: Uint8Array): Promise<Uint8Array> {
    if (keyVersion !== this.keyVersion) {
      throw new Error(
        `LocalEnvelopeKeyProvider is configured for key version "${this.keyVersion}" and cannot unwrap "${keyVersion}"`,
      );
    }
    return this.unwrap(Buffer.from(wrappedDataKey));
  }

  private wrap(plaintext: Buffer): Uint8Array {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // nonce || tag || ciphertext — self-contained, so unwrap needs nothing but this blob and the master key.
    return Buffer.concat([nonce, tag, ciphertext]);
  }

  private unwrap(wrapped: Buffer): Uint8Array {
    if (wrapped.length < NONCE_LENGTH + 16) {
      throw new Error('wrapped data key is too short to contain a nonce and auth tag');
    }
    const nonce = wrapped.subarray(0, NONCE_LENGTH);
    const tag = wrapped.subarray(NONCE_LENGTH, NONCE_LENGTH + 16);
    const ciphertext = wrapped.subarray(NONCE_LENGTH + 16);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
