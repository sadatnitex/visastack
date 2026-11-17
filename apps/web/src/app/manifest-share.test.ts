import { afterEach, describe, expect, it, vi } from 'vitest';
import * as manifestModule from './manifest';
import manifest from './manifest';

/**
 * WP-PIC11: VisaStack is offered as a share destination only when the owner has switched it on
 * (`WEB_SHARE_TARGET=on`) and the service worker, which keeps shared files on the device, is on.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function production(share?: string, worker?: string) {
  vi.stubEnv('NODE_ENV', 'production');
  if (share === undefined) vi.stubEnv('WEB_SHARE_TARGET', undefined);
  else vi.stubEnv('WEB_SHARE_TARGET', share);
  if (worker === undefined) vi.stubEnv('PWA_SERVICE_WORKER', undefined);
  else vi.stubEnv('PWA_SERVICE_WORKER', worker);
}

describe('the share entry in the app manifest', () => {
  it('is absent by default', () => {
    production();
    expect(manifest()).not.toHaveProperty('share_target');
  });

  it.each(['off', 'true', 'yes', '1', ''])('stays absent for WEB_SHARE_TARGET=%j', (value) => {
    production(value);
    expect(manifest()).not.toHaveProperty('share_target');
  });

  it('appears when the owner switches it on, taking photos and PDFs by post', () => {
    production(' On ');
    expect(manifest().share_target).toEqual({
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [
          {
            name: 'files',
            accept: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'],
          },
        ],
      },
    });
  });

  it('stays absent while the service worker is switched off, even when asked for', () => {
    production('on', 'off');
    expect(manifest()).not.toHaveProperty('share_target');
  });

  it('stays absent outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WEB_SHARE_TARGET', 'on');
    expect(manifest()).not.toHaveProperty('share_target');
  });

  it('stays a static file for everyone, not a function run on every request', () => {
    expect(manifestModule).not.toHaveProperty('dynamic');
  });

  it('leaves the rest of the manifest as it was', () => {
    production('on');
    const on = manifest();
    production();
    const off = manifest();
    const { share_target: _ignored, ...rest } = on;
    expect(rest).toEqual(off);
    expect(off.id).toBe('/');
    expect(off.scope).toBe('/');
  });
});
