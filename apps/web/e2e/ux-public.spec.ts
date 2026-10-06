import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { PRIMARY_NAV, agencyTabs, applicantTabs, platformTabs } from '../src/lib/navigation';

/**
 * UX/accessibility verification for public (no-secret) surfaces (master
 * directive §7 "PR 7" — UX verification). Runs in ordinary CI alongside
 * no-secret-auth.spec.ts. Authenticated-workspace UX (dashboard, applicant
 * pages, forms) is covered separately in authenticated-workspace.spec.ts,
 * gated behind WorkOS staging credentials like the rest of that file —
 * implemented, not yet verified against real staging credentials, same
 * caveat as the existing authenticated journey tests.
 */

test.describe('accessibility (axe) — public pages', () => {
  for (const path of ['/', '/status']) {
    test(`${path} has no critical/serious automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

test.describe('responsive layout', () => {
  const viewports = {
    mobile: { width: 390, height: 844 },
    tablet: { width: 820, height: 1180 },
    desktop: { width: 1440, height: 900 },
  } as const;

  for (const [name, viewport] of Object.entries(viewports)) {
    test(`landing page has no horizontal overflow at ${name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe('keyboard navigation', () => {
  test('skip link is the first focus stop and jumps to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeInViewport();
  });
});

test.describe('language switching', () => {
  test('switching to Bangla changes the html lang attribute and persists across navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await page.goto('/status');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  });
});

test.describe('error and not-found states', () => {
  test('an unknown route renders the styled not-found page, not a bare 404', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /workspace|home/i }).first()).toBeVisible();
  });
});

/**
 * The signed-in screens cannot be opened without a WorkOS identity, but what
 * made them break on a phone was the stylesheet: a container whose side padding
 * was reset to zero, a navigation bar that could not fit its links, and a second
 * sticky bar hidden behind the first. This loads the REAL stylesheet and the
 * REAL public header from the deployment, then puts the signed-in building
 * blocks (the shell bar, a workspace header with its tabs, cards, rows, a form
 * row, checkboxes) into the page using the product's own class names and the
 * product's own navigation labels (`src/lib/navigation.ts`). It checks layout,
 * not page logic: the real pages are covered by `authenticated-workspace.spec.ts`
 * when staging credentials exist.
 */
/**
 * The fixture is HTML written into the page, with `style` attributes the way the
 * product's own pages use inline styles. The site's Content-Security-Policy (which
 * `browser-security.spec.ts` checks) correctly refuses inline style attributes that
 * arrive as markup, so these layout checks switch it off for their own page only.
 * They test the stylesheet, not the policy.
 */
const PHONE_AND_TABLET = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone', width: 360, height: 740 },
  { name: 'large phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
] as const;

function fixtureHtml(): string {
  const primary = PRIMARY_NAV.map(
    (link, i) => `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label}</a>`,
  ).join('');
  const bar = (links: readonly { href: string; label: string }[]) =>
    links
      .map(
        (link, i) =>
          `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label.replaceAll('&', '&amp;')}</a>`,
      )
      .join('');
  const agencyBar = bar(agencyTabs('fixture', { admin: true }));
  const platformBar = bar(platformTabs({ ai: true, complaints: true }));
  const tabs = applicantTabs('fixture')
    .map(
      (link, i) =>
        `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label}</a>`,
    )
    .join('');
  return `
<div id="fixture">
  <div class="app-shell-nav">
    <nav class="app-shell-links" aria-label="Workspace">${primary}</nav>
    <div class="app-shell-switch">
      <a href="/app/agency" class="btn btn-secondary nav-cta">Agency</a>
      <a href="/app/admin" class="btn btn-secondary nav-cta">Admin</a>
      <form action="#"><button type="submit" class="btn btn-secondary nav-cta">Sign out</button></form>
    </div>
  </div>
  <div class="container tabs-bar"><nav class="subnav" aria-label="Platform sections">${platformBar}</nav></div>
  <section class="section container" id="fixture-section">
    <div class="toolbar" style="margin-bottom:1.5rem">
      <div>
        <span class="eyebrow">Applicant</span>
        <h1 class="section-title" style="margin:.25rem 0 0">Mohammad Abdul Rahman Chowdhury</h1>
        <p class="muted" style="margin:.35rem 0 0">Self</p>
      </div>
    </div>
    <nav class="subnav" aria-label="Applicant sections">${tabs}</nav>
    <nav class="subnav" aria-label="Organization sections">${agencyBar}</nav>
    <div class="grid">
      <article class="card">
        <p class="card-kicker">Cases</p>
        <h2 class="card-title">Active cases</h2>
        <div class="rows">
          <div class="row"><span class="row-key">Active cases</span><span class="badge badge-neutral">2</span></div>
          <div class="row">
            <span class="row-key">very.long.email.address.of.a.team.member@example-consultancy-bangladesh.com
              <span class="muted" style="font-size:.8rem;margin-left:.5rem">ADMIN</span></span>
            <span style="display:flex;align-items:center;gap:.6rem">
              <span class="badge badge-success">Active</span>
              <button class="btn btn-secondary nav-cta" type="button">Deactivate</button>
            </span>
          </div>
          <div class="row"><span class="row-key">Reference</span><span class="row-val">01J8ZK3Q9V7M2XWPA5R4T6YBNC-0000-1111-2222-333344445555</span></div>
        </div>
      </article>
      <article class="card">
        <p class="card-kicker">Profile</p>
        <h2 class="card-title">Edit a field</h2>
        <div class="field-list"><div class="field-row">
          <div class="field-head"><label class="field-label" for="fixture-passport">Passport number</label><span class="badge badge-warning">Needs review</span></div>
          <div class="field-control"><input id="fixture-passport" class="input" value="A01234567"><button class="btn btn-primary" type="button">Save</button></div>
        </div></div>
        <div class="checks" style="margin-top:1rem">
          <label class="check"><input type="checkbox"> Allow the agency to read my passport page</label>
          <label class="check"><input type="checkbox"> Allow downloads</label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap"><a class="btn btn-primary" href="#">Create case</a><button class="btn btn-secondary" type="button">Cancel</button><button class="btn btn-danger" type="button">Request account deletion</button></div>
      </article>
    </div>
    <div class="notice notice-warn" style="margin-top:1.5rem">A notice with a warning, in the warning colours.</div>
    <div style="height:2600px" aria-hidden="true"></div>
  </section>
</div>`;
}

async function openFixture(page: Page): Promise<void> {
  // The landing page is only a carrier for the real stylesheet and the real public
  // header. Scripts are blocked so React cannot hydrate it afterwards and replace
  // the fixture that is put into `main` below (which made these checks flaky).
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.evaluate((html) => {
    const main = document.querySelector('main');
    if (!main) throw new Error('the page has no <main>');
    main.innerHTML = html;
  }, fixtureHtml());
}

test.describe('signed-in layout building blocks on a narrow screen (real stylesheet)', () => {
  test.use({ bypassCSP: true });
  for (const viewport of PHONE_AND_TABLET) {
    test.describe(`${viewport.name} (${viewport.width}px)`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openFixture(page);
      });

      test('the page does not scroll sideways', async ({ page }) => {
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      });

      test('content keeps a side margin instead of touching the screen edge', async ({ page }) => {
        const { left, right, width } = await page.evaluate(() => {
          const section = document.querySelector('#fixture-section');
          if (!section) throw new Error('no fixture section');
          const style = getComputedStyle(section);
          return {
            left: Number.parseFloat(style.paddingLeft),
            right: Number.parseFloat(style.paddingRight),
            width: document.documentElement.clientWidth,
          };
        });
        expect(left).toBeGreaterThanOrEqual(16);
        expect(right).toBeGreaterThanOrEqual(16);
        expect(width).toBe(viewport.width);
      });

      test('every navigation link and switch button is on screen, none clipped', async ({
        page,
      }) => {
        const labels = [...PRIMARY_NAV.map((l) => l.label), 'Agency', 'Admin', 'Sign out'];
        for (const label of labels) {
          const target = page
            .locator('.app-shell-nav')
            .getByRole(label === 'Sign out' ? 'button' : 'link', { name: label, exact: true });
          await expect(target, label).toBeVisible();
          const box = await target.boundingBox();
          expect(box, label).not.toBeNull();
          if (box) {
            expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(
              viewport.width + 1,
            );
          }
        }
      });

      test('every tab of every section bar can be scrolled into view, so none is out of reach', async ({
        page,
      }) => {
        const bars = page.locator('#fixture nav.subnav');
        expect(await bars.count()).toBe(3);
        for (let b = 0; b < (await bars.count()); b++) {
          const links = bars.nth(b).locator('a');
          for (let i = 0; i < (await links.count()); i++) {
            const link = links.nth(i);
            await link.scrollIntoViewIfNeeded();
            const box = await link.boundingBox();
            expect(box, `bar ${b} tab ${i}`).not.toBeNull();
            if (box) {
              expect(box.x, `bar ${b} tab ${i} left edge`).toBeGreaterThanOrEqual(-1);
              expect(box.x + box.width, `bar ${b} tab ${i} right edge`).toBeLessThanOrEqual(
                viewport.width + 1,
              );
            }
          }
        }
      });

      test('section tabs keep the width of their own text, so none is squeezed over another', async ({
        page,
      }) => {
        // A tab shrunk below its text still sits inside the bar (so "is it on screen" passes) while its
        // text spills over the next tab. Check the text fits its own box and neighbours do not overlap.
        const squeezed = await page.evaluate(() => {
          const out: string[] = [];
          for (const nav of document.querySelectorAll<HTMLElement>('#fixture nav.subnav')) {
            const bar = nav.getAttribute('aria-label');
            const links = [...nav.querySelectorAll<HTMLElement>('a')];
            links.forEach((link, i) => {
              if (link.scrollWidth > link.clientWidth + 1) {
                out.push(
                  `${bar}: "${link.textContent}" is ${link.scrollWidth}px of text in a ${link.clientWidth}px tab`,
                );
              }
              const next = links[i + 1];
              if (
                next &&
                next.getBoundingClientRect().left < link.getBoundingClientRect().right - 0.5
              ) {
                out.push(`${bar}: "${link.textContent}" overlaps "${next.textContent}"`);
              }
            });
          }
          return out;
        });
        expect(squeezed).toEqual([]);
      });

      test('the public header keeps its sign-in button on screen', async ({ page }) => {
        const button = page.locator('header.nav').getByRole('link', { name: /sign in|workspace/i });
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        if (box) expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      });

      test('every control is at least 24 by 24 CSS pixels (WCAG 2.2 target size)', async ({
        page,
      }) => {
        const tooSmall = await page.evaluate(() => {
          const out: string[] = [];
          const controls = document.querySelectorAll('a[href], button, input, select, textarea');
          for (const el of controls) {
            if (el.closest('.skip-link')) continue;
            const box = el.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
            // A link inside a sentence is exempt (WCAG 2.5.8 "inline").
            const inline =
              el.tagName === 'A' &&
              getComputedStyle(el).display === 'inline' &&
              el.closest('p, .row-key, li');
            if (inline) continue;
            if (box.width < 24 || box.height < 24) {
              const name = (el.textContent || el.getAttribute('type') || '').trim().slice(0, 30);
              out.push(
                `${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`,
              );
            }
          }
          return out;
        });
        expect(tooSmall).toEqual([]);
      });
    });
  }
});

test.describe('signed-in navigation on a wide screen (real stylesheet)', () => {
  test.use({ bypassCSP: true });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page);
  });

  test('the signed-in bar stays visible under the public header while scrolling', async ({
    page,
  }) => {
    // `scroll-behavior: smooth` is set on the page, so jump instantly and check the
    // page really moved; a check made mid-animation would pass for the wrong reason.
    const scrolled = await page.evaluate(() => {
      window.scrollTo({ top: 900, behavior: 'instant' });
      return window.scrollY;
    });
    expect(scrolled, 'the page scrolled').toBeGreaterThan(800);
    const { headerBottom, barTop, barBottom } = await page.evaluate(() => {
      const header = document.querySelector('header.nav')?.getBoundingClientRect();
      const bar = document.querySelector('.app-shell-nav')?.getBoundingClientRect();
      if (!header || !bar) throw new Error('missing bar');
      return { headerBottom: header.bottom, barTop: bar.top, barBottom: bar.bottom };
    });
    // Not behind the public header (it used to stick at the same top and vanish).
    expect(barTop).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(barBottom).toBeGreaterThan(headerBottom);
  });

  test('every section bar fits a desktop screen without scrolling sideways', async ({ page }) => {
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll('#fixture nav.subnav')].map((nav) => ({
        label: nav.getAttribute('aria-label'),
        scrollWidth: nav.scrollWidth,
        clientWidth: nav.clientWidth,
      })),
    );
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.scrollWidth, `${bar.label} bar`).toBeLessThanOrEqual(bar.clientWidth + 1);
    }
  });

  test('keyboard focus is never hidden behind the sticky bars', async ({ page }) => {
    // Scroll so a control sits underneath the two sticky bars, then focus it, as
    // tabbing or shift-tabbing to it would. The browser only moves it clear of the
    // bars when `scroll-padding-top` tells it they are there.
    const placed = await page.evaluate(() => {
      const control = [...document.querySelectorAll<HTMLElement>('#fixture button')].find(
        (el) => el.textContent?.trim() === 'Cancel',
      );
      if (!control) throw new Error('no Cancel button in the fixture');
      const top = control.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - 60, behavior: 'instant' });
      return control.getBoundingClientRect().top;
    });
    expect(placed, 'the control starts underneath the bars').toBeLessThan(104);
    await page.evaluate(() => {
      const control = [...document.querySelectorAll<HTMLElement>('#fixture button')].find(
        (el) => el.textContent?.trim() === 'Cancel',
      );
      control?.focus();
    });
    await page.waitForTimeout(400);
    const { top, barsBottom } = await page.evaluate(() => {
      const focused = document.activeElement?.getBoundingClientRect();
      const bar = document.querySelector('.app-shell-nav')?.getBoundingClientRect();
      if (!focused || !bar) throw new Error('missing element');
      return { top: focused.top, barsBottom: bar.bottom };
    });
    expect(top).toBeGreaterThanOrEqual(barsBottom - 1);
  });
});

test.describe('colour contrast of the signed-in building blocks (axe, both colour schemes)', () => {
  test.use({ bypassCSP: true });
  for (const scheme of ['light', 'dark'] as const) {
    test(`no critical or serious violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await openFixture(page);
      const results = await new AxeBuilder({ page })
        .include('#fixture')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});
