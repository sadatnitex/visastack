import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WebPushSender,
  b64urlDecode,
  b64urlEncode,
  createVapidIdentity,
  encryptPushPayload,
  isAllowedPushEndpoint,
  parsePushSubscription,
  vapidAuthorization,
} from './web-push';

// RFC 8291 section 5, every value as the RFC prints it.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** The receiving browser's side of RFC 8291, written independently of the sender code. */
function decrypt(message: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = message.subarray(0, 16);
  const idLength = message.readUInt8(20);
  const senderPublic = message.subarray(21, 21 + idLength);
  const ciphertext = message.subarray(21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  expect(padded[padded.length - 1]).toBe(0x02);
  return padded.subarray(0, padded.length - 1);
}

function freshVapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64urlEncode(ecdh.getPublicKey()),
    privateKey: b64urlEncode(ecdh.getPrivateKey()),
    subject: 'mailto:ops@example.invalid',
  };
}

describe('RFC 8291 message encryption', () => {
  it('reproduces the RFC 8291 section 5 example byte for byte', () => {
    const out = encryptPushPayload(
      Buffer.from(RFC.plaintext),
      b64urlDecode(RFC.uaPublic),
      b64urlDecode(RFC.authSecret),
      { senderPrivateKey: b64urlDecode(RFC.asPrivate), salt: b64urlDecode(RFC.salt) },
    );
    expect(b64urlEncode(out)).toBe(RFC.message);
  });

  it('decrypts the RFC example with the receiver key', () => {
    const plain = decrypt(
      b64urlDecode(RFC.message),
      b64urlDecode(RFC.uaPrivate),
      b64urlDecode(RFC.authSecret),
    );
    expect(plain.toString()).toBe(RFC.plaintext);
  });

  it('round trips with a fresh sender key and salt every time', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = Buffer.from('{"title":"VisaStack"}');
    const a = encryptPushPayload(text, ua.getPublicKey(), auth);
    const b = encryptPushPayload(text, ua.getPublicKey(), auth);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, ua.getPrivateKey(), auth).toString()).toBe(text.toString());
    expect(decrypt(b, ua.getPrivateKey(), auth).toString()).toBe(text.toString());
  });

  it('refuses a wrong-length auth secret, a bad point and an over-long message', () => {
    const point = b64urlDecode(RFC.uaPublic);
    expect(() => encryptPushPayload(Buffer.from('x'), point, Buffer.alloc(15))).toThrow();
    expect(() =>
      encryptPushPayload(Buffer.from('x'), point.subarray(1), Buffer.alloc(16)),
    ).toThrow();
    expect(() => encryptPushPayload(Buffer.alloc(3001), point, Buffer.alloc(16))).toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token for the push service origin that verifies with the public key', () => {
    const keys = freshVapid();
    const identity = createVapidIdentity(keys);
    expect(identity).not.toBeNull();
    if (!identity) return;
    const header = vapidAuthorization(identity, 'https://fcm.googleapis.com/fcm/send/abc', 1_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    if (!match) return;
    const [, h, c, s, k] = match as unknown as [string, string, string, string, string];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b64urlDecode(c).toString());
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_000 + 12 * 60 * 60,
      sub: 'mailto:ops@example.invalid',
    });
    const point = b64urlDecode(keys.publicKey);
    const pub = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64urlEncode(point.subarray(1, 33)),
        y: b64urlEncode(point.subarray(33)),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        b64urlDecode(s),
      ),
    ).toBe(true);
    expect(header).not.toContain(keys.privateKey);
  });

  it('accepts a private key written without its leading zero bytes', () => {
    // A scalar starting with a zero byte, as some tools print it (31 bytes).
    let found: { publicKey: string; privateKey: string } | null = null;
    for (let i = 1; i < 256 && !found; i += 1) {
      const scalar = Buffer.alloc(32);
      scalar[31] = i;
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(scalar);
      found = {
        publicKey: b64urlEncode(ecdh.getPublicKey()),
        privateKey: b64urlEncode(scalar.subarray(1)),
      };
    }
    expect(found).not.toBeNull();
    if (!found) return;
    expect(createVapidIdentity({ ...found, subject: 'mailto:ops@example.invalid' })).not.toBeNull();
  });

  it('refuses missing, malformed or mismatched keys and a bad subject', () => {
    const keys = freshVapid();
    const other = freshVapid();
    expect(createVapidIdentity({ ...keys, privateKey: undefined })).toBeNull();
    expect(createVapidIdentity({ ...keys, publicKey: 'not*base64' })).toBeNull();
    expect(createVapidIdentity({ ...keys, privateKey: other.privateKey })).toBeNull();
    expect(createVapidIdentity({ ...keys, subject: 'ops@example.invalid' })).toBeNull();
    expect(createVapidIdentity({ ...keys, subject: 'https://vs.example.invalid' })).not.toBeNull();
  });
});

describe('subscription checks', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret },
  };

  it('accepts only https addresses of real push services', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://.push.apple.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false);
  });

  it('parses a good subscription and refuses bad keys', () => {
    expect(parsePushSubscription(good)).toEqual(good);
    expect(parsePushSubscription({ ...good, keys: { ...good.keys, auth: 'AAAA' } })).toBeNull();
    expect(
      parsePushSubscription({
        ...good,
        keys: { ...good.keys, p256dh: b64urlEncode(Buffer.alloc(65, 4)) },
      }),
    ).toBeNull();
    expect(parsePushSubscription({ ...good, endpoint: 'https://example.com/x' })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
    expect(parsePushSubscription({ endpoint: good.endpoint })).toBeNull();
  });
});

describe('WebPushSender', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret },
  };

  function sender(status: number | Error) {
    const identity = createVapidIdentity(freshVapid());
    if (!identity) throw new Error('test keys');
    const calls: { url: string; init: RequestInit }[] = [];
    const s = new WebPushSender({
      identity,
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (status instanceof Error) throw status;
        return { status };
      },
    });
    return { s, calls };
  }

  it('posts an encrypted body the receiver can read, without following redirects', async () => {
    const { s, calls } = sender(201);
    const outcome = await s.send(subscription, Buffer.from('{"a":1}'), {
      ttlSeconds: 86400,
      topic: 'visastack',
    });
    expect(outcome).toEqual({ kind: 'sent' });
    const call = calls[0];
    expect(call?.url).toBe(subscription.endpoint);
    expect(call?.init.redirect).toBe('manual');
    const headers = new Headers(call?.init.headers as Record<string, string>);
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('TTL')).toBe('86400');
    expect(headers.get('Topic')).toBe('visastack');
    const plain = decrypt(
      Buffer.from(call?.init.body as Uint8Array),
      b64urlDecode(RFC.uaPrivate),
      b64urlDecode(RFC.authSecret),
    );
    expect(plain.toString()).toBe('{"a":1}');
  });

  it('reads 404 and 410 as gone, other answers and errors as failed', async () => {
    expect(
      await sender(404).s.send(subscription, Buffer.from('x'), { ttlSeconds: 1, topic: 't' }),
    ).toEqual({ kind: 'gone' });
    expect(
      await sender(410).s.send(subscription, Buffer.from('x'), { ttlSeconds: 1, topic: 't' }),
    ).toEqual({ kind: 'gone' });
    expect(
      await sender(500).s.send(subscription, Buffer.from('x'), { ttlSeconds: 1, topic: 't' }),
    ).toEqual({ kind: 'failed', status: 500 });
    expect(
      await sender(302).s.send(subscription, Buffer.from('x'), { ttlSeconds: 1, topic: 't' }),
    ).toEqual({ kind: 'failed', status: 302 });
    expect(
      await sender(new Error('network')).s.send(subscription, Buffer.from('x'), {
        ttlSeconds: 1,
        topic: 't',
      }),
    ).toEqual({ kind: 'failed', status: null });
  });

  it('never posts to an address outside the push-service list', async () => {
    const { s, calls } = sender(201);
    const outcome = await s.send(
      { ...subscription, endpoint: 'https://example.com/x' },
      Buffer.from('x'),
      {
        ttlSeconds: 1,
        topic: 't',
      },
    );
    expect(outcome).toEqual({ kind: 'gone' });
    expect(calls).toHaveLength(0);
  });
});
