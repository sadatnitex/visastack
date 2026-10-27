import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A missing or refused record must answer with a real "404 Not Found", not a not-found card on a
 * "200 OK" page. Next.js decides the status before it sends the first byte. A `loading.tsx` file
 * wraps everything below its folder in a loading boundary, and Next sends the loading screen with
 * "200 OK" straight away, so a `notFound()` that runs inside that boundary can no longer change the
 * status (checked against a real Next 15.5 build: `notFound()` under a parent `loading.tsx` answered
 * 200; in a layout whose own folder holds the `loading.tsx` it answered 404).
 *
 * The rule this guard holds: every signed-in address with a record id in it (a `[param]` folder)
 * looks the record up and calls `notFound()` in its layout, or in its page when it has no layout
 * gate, and no `loading.tsx` sits above that check. A loading screen in the record's own folder is
 * fine when the layout is the gate, because the layout runs before that boundary.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SIGNED_IN = join(APP_ROOT, 'app');

/**
 * Record addresses that still answer "200" with the not-found card, each for a stated reason. Every
 * entry must still be streamed (the last test fails once one is fixed, so the list only shrinks).
 */
const STILL_STREAMED: Readonly<Record<string, string>> = {
  'admin/organizations/[orgId]': 'staff-only; admin/loading.tsx is owned by the admin package',
  'admin/packs/[packId]': 'staff-only; admin/loading.tsx is owned by the admin package',
  'agency/[orgId]/countries/[iso2]':
    'inside the agency loading screen, which every agency page shares; the organization itself answers 404',
  'agency/[orgId]/plan/invoices/receipts/[receiptId]':
    'inside the agency loading screen, which every agency page shares; the organization itself answers 404',
  'mission/[id]/snapshots/[snapshotId]':
    'inside the case loading screen (case page package); the case itself answers 404',
};

function dirs(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (!statSync(full).isDirectory()) continue;
    out.push(full, ...dirs(full));
  }
  return out;
}

const callsNotFound = (file: string) =>
  existsSync(file) && /\bnotFound\(\)/.test(readFileSync(file, 'utf8'));

interface RecordRoute {
  readonly route: string;
  readonly gate: 'layout' | 'page';
  readonly streamedBy: readonly string[];
}

/** Every `[param]` folder below `/app` that refuses unknown ids, with any loading screen above its check. */
function recordRoutes(): RecordRoute[] {
  const routes: RecordRoute[] = [];
  for (const dir of dirs(SIGNED_IN)) {
    const name = dir.slice(dirname(dir).length + 1);
    if (!name.startsWith('[')) continue;
    const gate = callsNotFound(join(dir, 'layout.tsx'))
      ? 'layout'
      : callsNotFound(join(dir, 'page.tsx'))
        ? 'page'
        : null;
    if (!gate) continue;
    const streamedBy: string[] = [];
    if (gate === 'page' && existsSync(join(dir, 'loading.tsx'))) streamedBy.push(dir);
    for (let up = dirname(dir); up.startsWith(SIGNED_IN); up = dirname(up)) {
      if (existsSync(join(up, 'loading.tsx'))) streamedBy.push(up);
      if (up === SIGNED_IN) break;
    }
    routes.push({
      route: relative(SIGNED_IN, dir),
      gate,
      streamedBy: streamedBy.map((d) => `${relative(APP_ROOT, d) || '.'}/loading.tsx`),
    });
  }
  return routes;
}

describe('a missing or refused record answers 404, not a 200 page', () => {
  const routes = recordRoutes();

  it('finds the record addresses it guards', () => {
    const names = routes.map((r) => r.route);
    for (const expected of [
      'applicant/[id]',
      'mission/[id]',
      'agency/[orgId]',
      'shared/[grantId]',
      'countries/[iso2]',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('has no loading screen for every signed-in page (it would wrap every record check)', () => {
    expect(existsSync(join(SIGNED_IN, 'loading.tsx'))).toBe(false);
  });

  it('checks the person, case and organization in the layout, before any loading screen', () => {
    for (const route of ['applicant/[id]', 'mission/[id]', 'agency/[orgId]']) {
      const found = routes.find((r) => r.route === route);
      expect(found?.gate, route).toBe('layout');
      expect(found?.streamedBy, route).toEqual([]);
    }
  });

  it('keeps every other record check outside a loading screen', () => {
    const streamed = routes
      .filter((r) => r.streamedBy.length > 0 && !(r.route in STILL_STREAMED))
      .map((r) => `${r.route} (${r.gate}) is inside ${r.streamedBy.join(', ')}`);
    expect(streamed, streamed.join('\n')).toEqual([]);
  });

  it('lists only addresses that really are still streamed, so the list only shrinks', () => {
    for (const route of Object.keys(STILL_STREAMED)) {
      const found = routes.find((r) => r.route === route);
      expect(found, `${route} no longer exists or no longer refuses unknown ids`).toBeDefined();
      expect(
        found?.streamedBy.length,
        `${route} answers 404 now: remove it from the list`,
      ).toBeGreaterThan(0);
    }
  });
});
