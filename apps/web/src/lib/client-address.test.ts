import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientAddressFrom, hashedSubject } from './client-address';

function headers(values: Record<string, string>): Pick<Headers, 'get'> {
  return new Headers(values);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it('on Render uses only the last forwarded value, the one Render adds, never what a client wrote', () => {
    const spoofed = headers({
      'x-forwarded-for': '198.51.100.66, 192.0.2.10, 203.0.113.9',
      'x-real-ip': '198.51.100.67',
      'cf-connecting-ip': '198.51.100.68',
    });
    expect(clientAddressFrom(spoofed, 'render')).toBe('203.0.113.9');
    expect(clientAddressFrom(headers({ 'x-forwarded-for': '203.0.113.7' }), 'render')).toBe(
      '203.0.113.7',
    );
  });

  it('on Render puts requests with no forwarded value in one shared bucket', () => {
    for (const sent of [
      {},
      { 'x-forwarded-for': ' , ' },
      { 'x-real-ip': '198.51.100.67', 'cf-connecting-ip': '198.51.100.68' },
    ]) {
      expect(clientAddressFrom(headers(sent), 'render')).toBe('unknown');
    }
  });

  it('logs the Render address once, only when the owner turns the check on', async () => {
    vi.resetModules();
    const { clientAddressFrom: fresh } = await import('./client-address');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    fresh(headers({ 'x-forwarded-for': '203.0.113.9' }), 'render');
    expect(info).not.toHaveBeenCalled();
    vi.stubEnv('CLIENT_ADDRESS_CHECK', 'log-once');
    fresh(headers({ 'x-forwarded-for': '203.0.113.9' }), 'vercel');
    expect(info).not.toHaveBeenCalled();
    fresh(headers({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }), 'render');
    fresh(headers({ 'x-forwarded-for': '203.0.113.10' }), 'render');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain('203.0.113.9 (from 2 forwarded values)');
  });

  it('turns an address into a short hashed key, never the raw address', () => {
    const key = hashedSubject('net', '203.0.113.7');
    expect(key).toMatch(/^net:[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.7');
  });
});
