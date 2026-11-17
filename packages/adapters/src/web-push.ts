import {
  type KeyObject,
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Standard Web Push with no third-party package: message encryption (RFC 8291, aes128gcm from
 * RFC 8188) and server identification (VAPID, RFC 8292), both built from node:crypto. The
 * RFC 8291 section 5 example is reproduced byte for byte in the tests.
 *
 * The private key is read once into a KeyObject and never logged, printed or placed in an
 * error message: every error this module raises names the problem, never a value.
 */

const RECORD_SIZE = 4096;
const P256_POINT_LENGTH = 65;
const AUTH_SECRET_LENGTH = 16;
const SALT_LENGTH = 16;
/** One push message at most this long before encryption (the standard allows 4078 bytes). */
const MAX_PLAINTEXT = 3000;
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;
const SEND_TIMEOUT_MS = 5000;

/**
 * Push services a subscription may point at. The server posts to the address the browser gave,
 * so only the real push services are accepted: anything else could make the server call an
 * address of an attacker's choosing.
 */
const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
];
const PUSH_SERVICE_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

export function b64urlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('not base64url');
  return Buffer.from(value, 'base64url');
}

export function b64urlEncode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

/** A browser subscription as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** True when the address is an https address of a known push service on the default port. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}

/**
 * Checks a subscription's shape: an allowed endpoint, a P-256 public key in uncompressed form
 * and a 16-byte auth secret. Returns null when anything is off.
 */
export function parsePushSubscription(input: unknown): PushSubscriptionInput | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { endpoint?: unknown; keys?: unknown };
  if (typeof candidate.endpoint !== 'string' || !isAllowedPushEndpoint(candidate.endpoint)) {
    return null;
  }
  const keys = candidate.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  try {
    const point = b64urlDecode(keys.p256dh);
    const auth = b64urlDecode(keys.auth);
    if (point.length !== P256_POINT_LENGTH || point[0] !== 0x04) return null;
    if (auth.length !== AUTH_SECRET_LENGTH) return null;
    // Refuses a point that is not on the curve.
    createPublicKey({ key: rawPointToJwk(point), format: 'jwk' });
  } catch {
    return null;
  }
  return { endpoint: candidate.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function rawPointToJwk(point: Buffer): { kty: 'EC'; crv: 'P-256'; x: string; y: string } {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(point.subarray(1, 33)),
    y: b64urlEncode(point.subarray(33, 65)),
  };
}

export interface EncryptOptions {
  /** Test only: a fixed sender key pair (RFC 8291 example). Never set in production. */
  readonly senderPrivateKey?: Buffer;
  /** Test only: a fixed salt (RFC 8291 example). Never set in production. */
  readonly salt?: Buffer;
}

/** RFC 8291: encrypts one message for one subscription as a single aes128gcm record. */
export function encryptPushPayload(
  plaintext: Uint8Array,
  receiverPublicKey: Buffer,
  authSecret: Buffer,
  options: EncryptOptions = {},
): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('push message too long');
  if (receiverPublicKey.length !== P256_POINT_LENGTH || receiverPublicKey[0] !== 0x04) {
    throw new Error('receiver key is not an uncompressed P-256 point');
  }
  if (authSecret.length !== AUTH_SECRET_LENGTH) throw new Error('auth secret has the wrong length');

  const ecdh = createECDH('prime256v1');
  if (options.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
  else ecdh.generateKeys();
  const senderPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(receiverPublicKey);
  const salt = options.salt ?? randomBytes(SALT_LENGTH);
  if (salt.length !== SALT_LENGTH) throw new Error('salt has the wrong length');

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    receiverPublicKey,
    senderPublicKey,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12),
  );

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // A single record: the content, then the last-record delimiter 0x02, no padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(SALT_LENGTH + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_LENGTH);
  header.writeUInt8(senderPublicKey.length, SALT_LENGTH + 4);
  return Buffer.concat([header, senderPublicKey, body]);
}

/** The server's identity for push services (VAPID). Build once from the configured keys. */
export interface VapidIdentity {
  readonly publicKey: string;
  readonly subject: string;
  readonly privateKey: KeyObject;
}

/**
 * Reads and checks the VAPID keys: the public key is a 65-byte P-256 point, the private key a
 * 32-byte scalar, and the two belong together. The subject is a mailto: or https: address.
 * Returns null when anything is missing or wrong, never echoing a value.
 */
export function createVapidIdentity(input: {
  readonly publicKey: string | undefined;
  readonly privateKey: string | undefined;
  readonly subject: string | undefined;
}): VapidIdentity | null {
  const publicKey = input.publicKey?.trim();
  const privateKey = input.privateKey?.trim();
  const subject = input.subject?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject)) {
    return null;
  }
  try {
    const point = b64urlDecode(publicKey);
    const raw = b64urlDecode(privateKey);
    if (point.length !== P256_POINT_LENGTH || point[0] !== 0x04) return null;
    // Some tools drop leading zero bytes from the private scalar: put them back.
    if (raw.length === 0 || raw.length > 32) return null;
    const scalar = Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(scalar);
    const derived = ecdh.getPublicKey();
    if (!timingSafeEqual(derived, point)) return null;
    const key = createPrivateKey({
      key: { ...rawPointToJwk(point), d: b64urlEncode(scalar) },
      format: 'jwk',
    });
    return { publicKey: b64urlEncode(point), subject, privateKey: key };
  } catch {
    return null;
  }
}

/** RFC 8292: a signed token naming the push service's origin, valid for twelve hours. */
export function vapidAuthorization(
  identity: VapidIdentity,
  endpoint: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + JWT_LIFETIME_SECONDS,
        sub: identity.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: identity.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${signingInput}.${b64urlEncode(signature)}, k=${identity.publicKey}`;
}

/** What the push service said, reduced to what the caller acts on. */
export type PushSendOutcome =
  | { readonly kind: 'sent' }
  /** The subscription no longer exists (404 or 410): forget it. */
  | { readonly kind: 'gone' }
  /** Anything else (refused, unreachable, too slow): count a failure. */
  | { readonly kind: 'failed'; readonly status: number | null };

export type FetchLike = (url: string, init: RequestInit) => Promise<{ readonly status: number }>;

export interface WebPushSenderOptions {
  readonly identity: VapidIdentity;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * Sends one encrypted message. Redirects are not followed, the request is limited to five
 * seconds and the address is checked against the push-service list again before sending.
 */
export class WebPushSender {
  readonly #identity: VapidIdentity;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: WebPushSenderOptions) {
    this.#identity = options.identity;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  }

  async send(
    subscription: PushSubscriptionInput,
    message: Uint8Array,
    options: { readonly ttlSeconds: number; readonly topic: string },
  ): Promise<PushSendOutcome> {
    if (!isAllowedPushEndpoint(subscription.endpoint)) return { kind: 'gone' };
    let body: Buffer;
    try {
      body = encryptPushPayload(
        message,
        b64urlDecode(subscription.keys.p256dh),
        b64urlDecode(subscription.keys.auth),
      );
    } catch {
      return { kind: 'gone' };
    }
    try {
      const response = await this.#fetch(subscription.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {
          Authorization: vapidAuthorization(this.#identity, subscription.endpoint),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(Math.max(0, Math.floor(options.ttlSeconds))),
          Urgency: 'normal',
          Topic: options.topic,
        },
        body: new Uint8Array(body),
      });
      if (response.status >= 200 && response.status < 300) return { kind: 'sent' };
      if (response.status === 404 || response.status === 410) return { kind: 'gone' };
      return { kind: 'failed', status: response.status };
    } catch {
      return { kind: 'failed', status: null };
    }
  }
}
