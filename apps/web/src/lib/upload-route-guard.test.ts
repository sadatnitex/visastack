import { redirect } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeUploadFailure, guardUploadRoute } from './upload-route-guard';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guardUploadRoute', () => {
  it('returns the work as it is when nothing goes wrong', async () => {
    const response = await guardUploadRoute('upload', async () => Response.json({ ok: 1 }));
    expect(response.status).toBe(200);
  });

  it('turns an unexpected failure into a plain JSON line and logs only its kind', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'passport-A1234567.pdf';
    const response = await guardUploadRoute('hold', async () => {
      throw Object.assign(new TypeError(`could not read ${secret}`), { code: 'ECONNRESET' });
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: 'We could not add this file just now. Try again in a minute.',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain('route=hold');
    expect(line).toContain('error=TypeError');
    expect(line).toContain('code=ECONNRESET');
    expect(line).not.toContain(secret);
  });

  it('lets a sign-in redirect reach Next untouched', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      guardUploadRoute('upload', async () => {
        redirect('/sign-in');
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('describeUploadFailure', () => {
  it('never carries a message', () => {
    expect(describeUploadFailure(new Error('secret value'))).toEqual({ name: 'Error', code: '' });
    expect(describeUploadFailure('text')).toEqual({ name: 'string', code: '' });
  });
});
