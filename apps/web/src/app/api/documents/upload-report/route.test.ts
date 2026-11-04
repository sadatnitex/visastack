import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORIGIN = 'https://vs.example.test';

function post(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return POST(
    new Request(`${ORIGIN}/api/documents/upload-report`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(text).length),
        ...headers,
      },
      body: text,
    }),
  );
}

const good = { route: 'upload', reason: 'network', status: 0, redirected: false, ms: 1200 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/documents/upload-report', () => {
  it('writes one line with only the fixed fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await post({ ...good, extra: 'passport-A1234567.pdf' });
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toBe(
      'upload client problem route=upload reason=network status=0 redirected=false ms=1200',
    );
    expect(line).not.toContain('passport');
  });

  it('takes the reason a file could not be read on the phone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await post({ ...good, reason: 'unreadable' })).status).toBe(204);
    expect(String(warn.mock.calls[0]?.[0])).toContain('reason=unreadable');
  });

  it('refuses another origin, a missing or large body, and anything outside the fixed fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await post(good, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(good, { 'content-length': '5000' })).status).toBe(413);
    expect((await post(good, { 'content-length': '0' })).status).toBe(413);
    expect((await post('not json')).status).toBe(400);
    expect((await post([1, 2])).status).toBe(400);
    for (const bad of [
      { ...good, route: 'elsewhere' },
      { ...good, reason: 'because <script>' },
      { ...good, status: 1000 },
      { ...good, status: -1 },
      { ...good, status: 1.5 },
      { ...good, redirected: 'yes' },
      { ...good, ms: 999_999_999 },
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
