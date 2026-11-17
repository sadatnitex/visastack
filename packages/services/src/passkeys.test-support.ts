import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from './passkeys';

/**
 * A software passkey for tests: a real P-256 key that answers WebAuthn challenges the way a
 * phone or laptop would (packed "none" attestation, user present and verified flags, a signature
 * counter). It lets tests prove the real verification code, not a mock of it.
 */

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

export interface SoftPasskeyOptions {
  readonly origin: string;
  readonly rpID: string;
  /** Start counting from here; 0 means a passkey that does not count (many synced ones). */
  readonly counter?: number;
  /** Clear the "user verified" flag, as a key without a PIN or fingerprint would. */
  readonly withoutUserVerification?: boolean;
}

export class SoftPasskey {
  readonly credentialId: Buffer = randomBytes(32);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private counter: number;

  constructor(private readonly options: SoftPasskeyOptions) {
    this.counter = options.counter ?? 0;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** Set the next counter value by hand, for example to make it go backwards. */
  setCounter(value: number): void {
    this.counter = value;
  }

  private flags(attested: boolean): number {
    let flags = 0x01; // user present
    if (!this.options.withoutUserVerification) flags |= 0x04; // user verified
    if (attested) flags |= 0x40; // attested credential data follows
    return flags;
  }

  private authData(attested: boolean): Buffer {
    const rpIdHash = sha256(this.options.rpID);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter >>> 0);
    const head = Buffer.concat([rpIdHash, Buffer.from([this.flags(attested)]), counter]);
    if (!attested) return head;
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([
      head,
      Buffer.alloc(16), // aaguid
      idLength,
      this.credentialId,
      Buffer.from(isoCBOR.encode(cose)),
    ]);
  }

  private clientData(type: string, challenge: string, origin?: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin ?? this.options.origin,
        crossOrigin: false,
      }),
    );
  }

  /** Answer a registration challenge (the options' `challenge`). */
  register(challenge: string, origin?: string): RegistrationResponseJSON {
    const clientDataJSON = this.clientData('webauthn.create', challenge, origin);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(this.authData(true))],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /** Answer a confirmation challenge. Each answer moves a counting passkey on by one. */
  confirm(challenge: string, origin?: string): AuthenticationResponseJSON {
    if (this.counter > 0) this.counter += 1;
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const authenticatorData = this.authData(false);
    const signer = createSign('SHA256');
    signer.update(Buffer.concat([authenticatorData, sha256(clientDataJSON)]));
    const signature = signer.sign(this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
    };
  }
}
