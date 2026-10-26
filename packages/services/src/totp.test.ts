import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  groupSecret,
  hotp,
  looksLikeRecoveryCode,
  matchTotp,
  normaliseRecoveryCode,
  otpauthUri,
  totp,
} from './totp';

const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

describe('HOTP and TOTP follow the RFCs', () => {
  it('matches the RFC 4226 test vectors', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  it('matches the RFC 6238 SHA-1 test vectors (8 digits)', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code);
    }
  });

  it('encodes and decodes base32', () => {
    expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi'))).toBe('foobar');
    expect(() => base32Decode('not*valid')).toThrow();
  });
});

describe('matching a typed code', () => {
  const at = 1_700_000_000_000;
  const stepMs = 30_000;

  it('accepts the current step and one step either side, and says which step', () => {
    const now = Math.floor(at / stepMs);
    expect(matchTotp(RFC_SECRET, totp(RFC_SECRET, at), at)).toBe(now);
    expect(matchTotp(RFC_SECRET, totp(RFC_SECRET, at - stepMs), at)).toBe(now - 1);
    expect(matchTotp(RFC_SECRET, totp(RFC_SECRET, at + stepMs), at)).toBe(now + 1);
  });

  it('refuses two steps away, wrong codes, and anything that is not six digits', () => {
    expect(matchTotp(RFC_SECRET, totp(RFC_SECRET, at - 2 * stepMs), at)).toBeNull();
    expect(matchTotp(RFC_SECRET, totp(RFC_SECRET, at + 2 * stepMs), at)).toBeNull();
    expect(matchTotp(RFC_SECRET, '000000', at)).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5x']) {
      expect(matchTotp(RFC_SECRET, bad, at)).toBeNull();
    }
  });

  it('keeps leading zeros and ignores spaces a person types', () => {
    // 1111111111 -> counter 37037037; find a moment whose code starts with 0.
    let found = false;
    for (let step = 1000; step < 1100 && !found; step += 1) {
      const code = hotp(RFC_SECRET, step);
      if (code.startsWith('0')) {
        found = true;
        const atMs = step * stepMs;
        expect(matchTotp(RFC_SECRET, code, atMs)).toBe(step);
        expect(matchTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, atMs)).toBe(step);
      }
    }
    expect(found).toBe(true);
  });
});

describe('setup text and recovery codes', () => {
  it('builds the address an authenticator app reads', () => {
    const uri = otpauthUri({ issuer: 'VisaStack', account: 'a.b@example.com', secret: RFC_SECRET });
    expect(uri.startsWith('otpauth://totp/VisaStack:a.b%40example.com?')).toBe(true);
    expect(uri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(groupSecret(RFC_SECRET)).toBe('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
  });

  it('makes ten distinct 80-bit recovery codes that survive a retype', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
      expect(looksLikeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(true);
      expect(normaliseRecoveryCode(code.toLowerCase())).toBe(code.replace(/-/g, ''));
    }
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
