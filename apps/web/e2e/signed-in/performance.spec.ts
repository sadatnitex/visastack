import { expect, test } from '@playwright/test';
import { signIn } from './support/session';
import { ids } from './support/setup';
import { keepEvidence } from './support/ui';

/**
 * Tier 2, measured page timings on staging (docs/operations/staging-journeys.md). This records
 * what a browser measured for three representative signed-in pages and attaches it as evidence.
 * It asserts only that a measurement was made. It sets no pass line and makes no speed claim: a
 * staging deployment on a shared runner says little about production, and nobody has agreed a
 * target. Never pointed at production, and never a load test (one page load per page).
 */

const PAGES = (traveller: string) => [
  { name: 'documents', path: `/app/applicant/${traveller}/documents` },
  { name: 'add-documents', path: `/app/applicant/${traveller}/documents/add` },
  { name: 'cases', path: `/app/applicant/${traveller}/missions` },
];

test('three signed-in pages are measured', async ({ page }, info) => {
  await signIn(page, 'TRAVELLER');
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp?: number };
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) w.__lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  let measured = 0;
  for (const route of PAGES(ids.traveller())) {
    await page.goto(route.path, { waitUntil: 'load' });
    await expect(page.locator('main')).toBeVisible();
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        responseStartMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        largestContentfulPaintMs: Math.round(
          (window as unknown as { __lcp?: number }).__lcp ?? Number.NaN,
        ),
      };
    });
    measured += 1;
    expect(timing.loadMs).toBeGreaterThan(0);
    await keepEvidence(
      info,
      `timing-${route.name}.json`,
      JSON.stringify({ page: route.name, ...timing }, null, 2),
      'application/json',
    );
  }
  expect(measured).toBe(3);
});
