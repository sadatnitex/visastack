import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import {
  CONTROL_SELECTOR,
  GUARD_SIZES,
  coveredControls,
  sidewaysOverflow,
} from '../e2e/support/layout-guards';
import { seeded } from './people';
import {
  type GuardRole,
  type GuardRoute,
  KNOWN_FAILING,
  ROUTES,
  type RouteId,
  routePath,
} from './routes';
import { signInAs } from './session';

/**
 * The route guard (WAL1B-2, docs/operations/ci-signed-in-guard.md): every signed-in page in
 * routes.ts, opened as its made-up person at every guard size, must land on its own address, show
 * its body text and at least one control, need no sideways scroll and have no control painted
 * over. A page that should be off-limits to the other made-up person must not show that text to
 * them. Today's real findings are listed in KNOWN_FAILING; each must still fail (so a fix removes
 * its line) and nothing else may.
 */
const base = (baseURL: string | undefined) => baseURL ?? 'http://localhost:3100';

function ids(): Record<RouteId, string> {
  const s = seeded();
  const documentId = s.documentIds[0];
  if (!documentId) throw new Error('The seed made no document.');
  return {
    applicantId: s.applicantId,
    caseId: s.caseId,
    organizationId: s.organizationId,
    grantId: s.grantId,
    documentId,
  };
}

/**
 * The page's own content: the workspace frame's content column without its toolbar (which shows
 * the signed-in person's name on every page) and without the agency name banner (which a
 * non-member also sees). Text and controls are only counted here.
 */
const BODY = '.app-main > :not(.workspace-toolbar)';
const NOT_CHROME = ':not(.agency-hero, .agency-hero *)';

function body(page: Page) {
  return page.locator(BODY);
}

/**
 * Text the page body shows. The route's loading screen (components/page-loading.tsx, an
 * `output.loading`) must be gone first, so a word it shares with the page can never pass for the page.
 */
async function expectBodyText(page: Page, text: string): Promise<void> {
  await expect(page.locator('.app-main output.loading')).toHaveCount(0);
  await expect(body(page).getByText(text).and(page.locator(NOT_CHROME)).first()).toBeVisible();
}

async function open(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `status of ${path}`).toBe(200);
  const url = new URL(page.url());
  expect(`${url.pathname}${url.search}`, 'the page did not move elsewhere').toBe(path);
}

function known(route: GuardRoute, size: string, check: 'sideways scroll' | 'covered control') {
  return KNOWN_FAILING.find((k) => k.page === route.page && k.size === size && k.check === check);
}

async function signedIn(
  browser: import('@playwright/test').Browser,
  role: GuardRole,
  baseURL: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await signInAs(context, role, baseURL);
  return context;
}

test.describe.configure({ mode: 'parallel' });
// Three sizes, each with a control-by-control cover check.
test.setTimeout(120_000);

for (const route of ROUTES) {
  test(`${route.role} ${route.page}`, async ({ browser, baseURL }) => {
    const path = routePath(route, ids());
    const context = await signedIn(browser, route.role, base(baseURL));
    const page = await context.newPage();
    try {
      for (const size of GUARD_SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await open(page, path);
        await expectBodyText(page, route.mustShow);
        // Something to act on or move on with: a control, or a link (a back link counts, also the
        // agency banner's).
        expect(
          await body(page).locator(`${CONTROL_SELECTOR}, a[href]`).count(),
          'at least one control or link in the page',
        ).toBeGreaterThan(0);

        // Layout checks are soft: every size is checked and reported, then the test fails.
        const overflow = await sidewaysOverflow(page);
        const scrollFinding = known(route, size.name, 'sideways scroll');
        if (scrollFinding) {
          expect
            .soft(
              overflow,
              `${size.name}: fixed? remove from KNOWN_FAILING: ${scrollFinding.finding}`,
            )
            .toBeGreaterThan(0);
        } else {
          expect.soft(overflow, `${size.name}: sideways scroll in pixels`).toBeLessThanOrEqual(0);
        }

        const covered = await coveredControls(page);
        const coverFinding = known(route, size.name, 'covered control');
        if (coverFinding) {
          expect
            .soft(
              covered.length,
              `${size.name}: fixed? remove from KNOWN_FAILING: ${coverFinding.finding}`,
            )
            .toBeGreaterThan(0);
        } else {
          expect.soft(covered, `${size.name}: controls painted over by something else`).toEqual([]);
        }
      }
    } finally {
      await context.close();
    }

    if (route.deniedTo) {
      const other = await signedIn(browser, route.deniedTo, base(baseURL));
      const otherPage = await other.newPage();
      try {
        await otherPage.goto(path);
        await expect(body(otherPage).getByText(route.mustShow)).toHaveCount(0);
      } finally {
        await other.close();
      }
    }
  });
}
