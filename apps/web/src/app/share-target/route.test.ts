import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as route from './route';

/**
 * WP-PIC11: the server side of `/share-target` runs only when no service worker took the share.
 * It never reads or keeps what was posted, and no server route serves a shared file.
 */

describe('the share fallback on the server', () => {
  it('sends the person on with missed=1 and stores nothing', () => {
    const response = route.POST();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/app/incoming?missed=1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('cannot read the posted body: it takes no request at all', () => {
    expect(route.POST.length).toBe(0);
  });

  it('answers only the share post: no file, list or page is served from here', () => {
    expect(Object.keys(route).sort()).toEqual(['POST']);
    const files = readdirSync(__dirname, { recursive: true }).map(String).sort();
    expect(files).toEqual(['route.test.ts', 'route.ts']);
  });
});
