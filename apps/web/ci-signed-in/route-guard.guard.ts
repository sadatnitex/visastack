import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import {
  CONTROL_SELECTOR,
  GUARD_SIZES,
  coveredControls,
  sidewaysOverflow,
} from '../e2e/support/layout-guards';
import { seeded } from './people';
import { type GuardRole, ROUTES, type RouteId, knownFinding, routePath } from './routes';
import { signInAs } from './session';

/**
 * The route guard (WAL1B-2, docs/operations/ci-signed-in-guard.md): every signed-in page in
 * routes.ts, opened as its made-up person at every guard size, must stay on its own address, show
 * its body text and a control or link of its own, need no sideways scroll and have no control
 * painted over. A page that should be off-limits to the other made-up person must not show that
 * text to them. Today's real findings are listed in KNOWN_FAILING; each must still fail exactly as
 * listed (so a fix says what to remove) and nothing else may.
 */
const base = (baseURL: string | undefined) => baseURL ?? 'http://localhost:3100';

/**
 * The page's own content: the workspace frame's content column without its toolbar (which shows
 * the signed-in person's name on every page). Inside it, the agency name banner (which a
 * non-member also sees) and the record section tabs (drawn above every record page) are shared
 * navigation, not the page: body text and the page's own controls are counted outside them.
 */
const BODY = '.app-main > :not(.workspace-toolbar)';
const SHARED = '.agency-hero, .agency-hero *, nav.subnav, nav.subnav *';
const NOT_SHARED = `:not(${SHARED})`;

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

function body(page: Page) {
  return page.locator(BODY);
}

/** The route's loading screen (components/page-loading.tsx, an `output.loading`) has gone. */
async function loaded(page: Page): Promise<void> {
  await expect(page.locator('.app-main')).toHaveCount(1);
  await expect(page.locator('.app-main output.loading')).toHaveCount(0);
}

function address(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

async function signedIn(
  browser: Browser,
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
        const response = await page.goto(path);
        expect(response?.status(), `status of ${path}`).toBe(200);
        await loaded(page);
        await expect(
          body(page).getByText(route.mustShow).and(page.locator(NOT_SHARED)).first(),
        ).toBeVisible();
        // Checked again once the page has drawn, so a late or in-browser redirect cannot pass.
        expect(address(page), 'the page did not move elsewhere').toBe(path);

        // Layout checks are soft: every size is checked and reported, then the test fails.
        const own = await body(page)
          .locator(`${CONTROL_SELECTOR}, a[href]`)
          .and(page.locator(NOT_SHARED))
          .count();
        if (knownFinding(route.page, 'no control', size.name)) {
          expect.soft(own, `${size.name}: has a control now? remove from KNOWN_FAILING`).toBe(0);
        } else {
          expect.soft(own, `${size.name}: a control or link of the page's own`).toBeGreaterThan(0);
        }

        expect
          .soft(await sidewaysOverflow(page), `${size.name}: sideways scroll in pixels`)
          .toBeLessThanOrEqual(0);

        const covered = await coveredControls(page);
        const known = knownFinding(route.page, 'covered control', size.name);
        if (known) {
          // Exactly the listed controls: a newly covered one fails, a fixed one must be removed.
          const unlisted = covered.filter(
            (line) => !known.controls.some((control) => line.includes(control)),
          );
          const fixed = known.controls.filter(
            (control) => !covered.some((line) => line.includes(control)),
          );
          expect.soft(unlisted, `${size.name}: newly covered controls`).toEqual([]);
          expect.soft(fixed, `${size.name}: fixed? remove from KNOWN_FAILING`).toEqual([]);
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
        await loaded(otherPage);
        await expect(body(otherPage).getByText(route.mustShow)).toHaveCount(0);
      } finally {
        await other.close();
      }
    }
  });
}
