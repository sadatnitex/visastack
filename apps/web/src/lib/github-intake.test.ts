import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchGithubIntake } from './github-intake';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('private intake dispatch', () => {
  it('refuses preview, local and unconfigured production without any network request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const mode of ['preview', 'development', '']) {
      vi.stubEnv('VERCEL_ENV', mode);
      await expect(dispatchGithubIntake()).rejects.toThrow('cannot be dispatched');
    }
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('GITHUB_INTAKE_DISPATCH_TOKEN', '');
    await expect(dispatchGithubIntake()).rejects.toThrow('not configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('dispatches from the Render fallback production site, never from a Vercel preview', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('HOSTING_PLATFORM', 'render');
    vi.stubEnv('GITHUB_INTAKE_DISPATCH_TOKEN', 'synthetic-dispatch-credential');
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await dispatchGithubIntake();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubEnv('VERCEL_ENV', 'preview');
    await expect(dispatchGithubIntake()).rejects.toThrow('cannot be dispatched');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('dispatches fixed main code without document data or caller-controlled inputs', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('GITHUB_INTAKE_DISPATCH_TOKEN', 'synthetic-dispatch-credential');
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await dispatchGithubIntake();
    expect(fetcher.mock.calls[0]?.[0]).toContain('/document-intake.yml/dispatches');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"ref":"main"}',
      redirect: 'error',
      cache: 'no-store',
    });
  });
  it('rejects denied dispatches, redirects and transport failures without returning queued', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('GITHUB_INTAKE_DISPATCH_TOKEN', 'synthetic-dispatch-credential');
    for (const status of [401, 403, 302, 500]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(dispatchGithubIntake()).rejects.toThrow('could not be queued');
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(dispatchGithubIntake()).rejects.toThrow('offline');
  });
});
