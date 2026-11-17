import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { INCOMING_PATH } from '../../lib/pwa/share-target';
import * as route from './route';

/**
 * WP-PIC11: the server side of `/share-target` runs only when no service worker took the share.
 * It never reads or keeps what was posted, and no server route serves a shared file.
 */

function sharePost() {
  const form = new FormData();
  form.append('files', new File([new Uint8Array(8)], 'passport.jpg', { type: 'image/jpeg' }));
  const request = new Request('https://vs.example/share-target', { method: 'POST', body: form });
  const spies = ['formData', 'arrayBuffer', 'blob', 'text', 'json'].map((name) =>
    vi.spyOn(request, name as 'formData'),
  );
  return { request, spies };
}

describe('the share fallback on the server', () => {
  it('sends the person to the shared files page with missed=1', () => {
    const { request } = sharePost();
    const response = route.POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`https://vs.example${INCOMING_PATH}?missed=1`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('never reads what was posted', () => {
    const { request, spies } = sharePost();
    route.POST(request);
    expect(request.bodyUsed).toBe(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('answers only the share post: no file, list or page is served from here', () => {
    expect(Object.keys(route).sort()).toEqual(['POST']);
    const files = readdirSync(__dirname, { recursive: true }).map(String).sort();
    expect(files).toEqual(['route.test.ts', 'route.ts']);
  });
});
