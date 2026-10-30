import { describe, expect, it } from 'vitest';
import { clientAddressFrom, hashedSubject } from './client-address';

function headers(values: Record<string, string>): Pick<Headers, 'get'> {
  return new Headers(values);
}

describe('clientAddressFrom', () => {
  it('reads the first forwarded address, then x-real-ip, on Vercel and elsewhere', () => {
    for (const platform of ['vercel', 'other'] as const) {
      expect(
        clientAddressFrom(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), platform),
      ).toBe('203.0.113.7');
      expect(clientAddressFrom(headers({ 'x-real-ip': ' 203.0.113.8 ' }), platform)).toBe(
        '203.0.113.8',
      );
      expect(clientAddressFrom(headers({}), platform)).toBe('unknown');
    }
  });

  it('ignores cf-connecting-ip off Render, where a client could send it', () => {
    const sent = headers({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.7' });
    expect(clientAddressFrom(sent, 'vercel')).toBe('203.0.113.7');
    expect(clientAddressFrom(sent, 'other')).toBe('203.0.113.7');
  });

  it('prefers the edge address on Render, where x-forwarded-for can carry what a client sent', () => {
    const sent = headers({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.66, 203.0.113.9',
    });
    expect(clientAddressFrom(sent, 'render')).toBe('203.0.113.9');
    expect(clientAddressFrom(headers({ 'x-forwarded-for': '203.0.113.7' }), 'render')).toBe(
      '203.0.113.7',
    );
  });

  it('turns an address into a short hashed key, never the raw address', () => {
    const key = hashedSubject('net', '203.0.113.7');
    expect(key).toMatch(/^net:[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.7');
  });
});
