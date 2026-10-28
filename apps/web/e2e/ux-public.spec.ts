import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';
import { PRIMARY_NAV, agencyTabs, applicantTabs, platformTabs } from '../src/lib/navigation';
import { openUiFixture } from './flat-ui-support';

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
  for (const path of ['/', '/status', '/trust', '/terms', '/privacy']) {
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

/** Programme X WP-L1 acceptance: Harbor landing with the signed corrections D4 and D15. */
test.describe('Harbor landing (WP-L1)', () => {
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    test(`no sideways scroll and no card over the phone text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const result = await page.evaluate(() => {
        const phone = document.querySelector('.c1-phone')?.getBoundingClientRect();
        const covered: string[] = [];
        if (phone) {
          const texts = [
            ...document.querySelectorAll('.c1-phone .c1-phonename, .c1-phone .c1-phonepanel'),
          ];
          for (const card of document.querySelectorAll('.c1-floatcard')) {
            const c = card.getBoundingClientRect();
            if (c.width === 0) continue;
            for (const text of texts) {
              const r = text.getBoundingClientRect();
              // Only the part inside the phone frame is visible; the frame hides the rest.
              const top = Math.max(r.top, phone.top);
              const bottom = Math.min(r.bottom, phone.bottom);
              const left = Math.max(r.left, phone.left);
              const right = Math.min(r.right, phone.right);
              if (c.left < right && left < c.right && c.top < bottom && top < c.bottom)
                covered.push(card.className);
            }
          }
        }
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          covered,
        };
      });
      expect(result).toEqual({ overflow: false, covered: [] });
    });
  }

  test('headline, one primary action and the availability line show without scrolling at 360x640', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await expect(page.locator('#land-hero-title')).toBeInViewport({ ratio: 1 });
    // Growth G1: the owner's promise, read as one sentence.
    await expect(page.locator('#land-hero-title')).toHaveText('A clean file you can stand behind.');
    await expect(page.locator('.c1-cta .c1-pill').first()).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.c1-hero .c1-nudge')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.c1-hero .c1-nudge')).toHaveText(/public beta|pilot/i);
  });
});

test.describe('version banner on phones', () => {
  test('uses the short wording on a phone and the full sentence on a wide screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/status');
    const banner = page.locator('.pilot-banner');
    await expect(banner.locator('.pilot-banner-short')).toBeVisible();
    await expect(banner.locator('.pilot-banner-detail')).toBeHidden();
    await expect(banner.getByRole('link', { name: 'What Works Today' })).toBeVisible();
    // Two short lines at most, instead of the sixth of the screen the full sentence took.
    expect((await banner.boundingBox())?.height ?? 999).toBeLessThanOrEqual(64);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(banner.locator('.pilot-banner-detail')).toBeVisible();
    await expect(banner.locator('.pilot-banner-short')).toBeHidden();
  });
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

test.describe('language choice', () => {
  // Translation is deferred (owner decision), so the switch is hidden and every page is English,
  // even for someone who saved a Bangla choice before (src/lib/locale.ts LANGUAGE_CHOICE_ENABLED).
  test('offers no language switch and stays English while translation has not started', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'বাংলা' })).toHaveCount(0);
    await expect(page.locator('.lang-switch')).toHaveCount(0);
    await context.addCookies([
      { name: 'visastack_locale', value: 'bn', url: baseURL ?? page.url() },
    ]);
    await page.goto('/status');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
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
  const icon =
    '<svg class="icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M5 12h14"/></svg>';
  const navLink = (link: { href: string; label: string }, i: number) =>
    `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${icon}<span class="app-link-label">${link.label}</span></a>`;
  // Mirrors `AppNav`: four links on the bar, "More" for the rest and the switch controls.
  const primary = PRIMARY_NAV.slice(0, 4).map(navLink).join('');
  const secondary = PRIMARY_NAV.slice(4).map(navLink).join('');
  const bar = (links: readonly { href: string; label: string }[]) =>
    links
      .map(
        (link, i) =>
          `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label.replaceAll('&', '&amp;')}</a>`,
      )
      .join('');
  const agencyBar = bar(agencyTabs('fixture', { admin: true }));
  const platformBar = bar(platformTabs({ ai: true, complaints: true, audit: true, privacy: true }));
  const tabs = applicantTabs('fixture')
    .map(
      (link, i) =>
        `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label}</a>`,
    )
    .join('');
  return `
<div id="fixture">
 <div class="app-frame">
  <div class="app-shell-nav" data-open="false">
    <div class="app-bar">
      <nav class="app-shell-links" aria-label="Workspace">${primary}</nav>
      <button type="button" class="app-more-toggle" aria-expanded="false" aria-controls="fixture-more" onclick="const n=this.closest('.app-shell-nav');const o=n.dataset.open!=='true';n.dataset.open=String(o);this.setAttribute('aria-expanded',String(o))">${icon}<span class="app-link-label">More</span></button>
    </div>
    <div class="app-more" id="fixture-more">
      <nav class="app-shell-links app-shell-links-more" aria-label="Account and Privacy">${secondary}</nav>
      <div class="app-shell-switch">
        <p class="app-shell-switch-label">Switch area</p>
        <a href="/app/agency" class="btn btn-secondary nav-cta">Agency</a>
        <a href="/app/admin" class="btn btn-secondary nav-cta">Admin</a>
        <form action="#"><button type="submit" class="btn btn-secondary nav-cta">Sign Out</button></form>
      </div>
    </div>
  </div>
  <div class="app-main">
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
          <div class="field-head"><label class="field-label" for="fixture-passport">Passport number</label><span class="badge badge-warning">Needs Review</span></div>
          <div class="field-control"><input id="fixture-passport" class="input" value="A01234567"><button class="btn btn-primary" type="button">Save</button></div>
        </div></div>
        <div class="checks" style="margin-top:1rem">
          <label class="check"><input type="checkbox"> Allow the agency to read my passport page</label>
          <label class="check"><input type="checkbox"> Allow downloads</label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap"><a class="btn btn-primary" href="#">Create Case</a><button class="btn btn-secondary" type="button">Cancel</button><button class="btn btn-danger" type="button">Request Account Deletion</button></div>
      </article>
    </div>
    <div class="notice notice-warn" style="margin-top:1.5rem">A notice with a warning, in the warning colours.</div>
    <div style="height:2600px" aria-hidden="true"></div>
  </section>
  </div>
 </div>
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
        const labels = [...PRIMARY_NAV.map((l) => l.label), 'Agency', 'Admin', 'Sign Out'];
        // The last few links and the switch controls sit under "More" on a narrow screen.
        await page.getByRole('button', { name: 'More' }).click();
        for (const label of labels) {
          const target = page
            .locator('.app-shell-nav')
            .getByRole(label === 'Sign Out' ? 'button' : 'link', { name: label, exact: true });
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

      test('the bottom bar stays at the bottom and never covers the last line of the page', async ({
        page,
      }) => {
        const { barTop, barBottom, innerHeight, lastBottom } = await page.evaluate(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          const bar = document.querySelector('.app-shell-nav')?.getBoundingClientRect();
          const main = document.querySelector('.app-main')?.getBoundingClientRect();
          if (!bar || !main) throw new Error('missing shell');
          return {
            barTop: bar.top,
            barBottom: bar.bottom,
            innerHeight: window.innerHeight,
            lastBottom: main.bottom,
          };
        });
        expect(barBottom, 'bar sits on the bottom edge').toBeGreaterThanOrEqual(innerHeight - 1);
        expect(barTop, 'bar is a bar, not a screen').toBeGreaterThan(innerHeight - 140);
        expect(lastBottom, 'the page ends above the bar').toBeLessThanOrEqual(barTop + 1);
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
        // The raw workspace fixture blocks scripts; the real public menu needs hydration.
        await page.unrouteAll({ behavior: 'wait' });
        await page.goto('/');
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
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

  test('the signed-in sidebar stays visible beside the page, under the public header, while scrolling', async ({
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

  test('keyboard focus is never hidden behind the sticky header', async ({ page }) => {
    // Scroll so a control sits underneath the sticky public header, then focus it, as
    // tabbing or shift-tabbing to it would. The browser only moves it clear of the
    // header when `scroll-padding-top` tells it it is there. (On a wide screen the
    // signed-in links sit in a sidebar beside the page, so nothing else covers content.)
    const placed = await page.evaluate(() => {
      const control = [...document.querySelectorAll<HTMLElement>('#fixture button')].find(
        (el) => el.textContent?.trim() === 'Cancel',
      );
      if (!control) throw new Error('no Cancel button in the fixture');
      const top = control.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - 60, behavior: 'instant' });
      return control.getBoundingClientRect().top;
    });
    expect(placed, 'the control starts underneath the header').toBeLessThan(80);
    await page.evaluate(() => {
      const control = [...document.querySelectorAll<HTMLElement>('#fixture button')].find(
        (el) => el.textContent?.trim() === 'Cancel',
      );
      control?.focus();
    });
    await page.waitForTimeout(400);
    const { top, barsBottom } = await page.evaluate(() => {
      const focused = document.activeElement?.getBoundingClientRect();
      const header = document.querySelector('header.nav')?.getBoundingClientRect();
      if (!focused || !header) throw new Error('missing element');
      return { top: focused.top, barsBottom: header.bottom };
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

test.describe('route information page (answers with data or says plainly it is unavailable)', () => {
  // With no database behind it (this check), the page must say so instead of failing; with one,
  // it lists the routes. Either way: one top heading, a way forward, nothing off the screen.
  for (const [name, width] of [
    ['320', 320],
    ['360', 360],
    ['390', 390],
  ] as const) {
    test(`/trust is readable at ${name} width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const response = await page.goto('/trust');
      expect(response?.status()).toBe(200);
      await expect(page.locator('main h1')).toHaveCount(1);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      const unavailable = page.getByText('Route Information Is Not Available Right Now');
      if (await unavailable.count()) {
        await expect(page.getByRole('link', { name: 'Try Again' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();
      }
    });
  }
});

/** Real React components with synthetic records, not authenticated production journeys. */
test.describe('flat UI reference geometry and interaction', () => {
  test.use({ bypassCSP: true });
  const sizes = [
    [1600, 1000],
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [375, 812],
    [320, 640],
  ] as const;
  for (const mode of [
    'overview',
    'profile',
    'documents',
    'case',
    'sharing',
    'agency',
    'admin',
  ] as const) {
    for (const [width, height] of sizes) {
      test(`${mode} fits ${width}px without decorative surfaces`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await openUiFixture(page, mode);
        await page.evaluate(() => document.fonts.ready);
        const findings = await page.locator('main').evaluate((main) => {
          const effects = [...main.querySelectorAll('*')]
            .filter((element) => {
              const css = getComputedStyle(element);
              return (
                css.boxShadow !== 'none' ||
                css.textShadow !== 'none' ||
                css.backdropFilter !== 'none' ||
                /(?:linear|radial)-gradient|blur\(|drop-shadow\(/.test(
                  css.backgroundImage + css.filter,
                )
              );
            })
            .map((element) => element.className);
          return { overflow: document.documentElement.scrollWidth > innerWidth + 1, effects };
        });
        expect(findings).toEqual({ overflow: false, effects: [] });
        await page.screenshot({
          path: test.info().outputPath(`${mode}-${width}.png`),
          fullPage: false,
          animations: 'disabled',
        });
      });
    }
  }
  test('mobile navigation moves focus into the menu and returns it on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openUiFixture(page, 'overview');
    const more = page.getByRole('button', { name: 'More', exact: true });
    await more.click();
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });
  test('document selection never offers an unchecked preview', async ({ page }) => {
    await openUiFixture(page, 'documents');
    await page.getByLabel('Choose a Document').selectOption('synthetic-pending');
    await expect(page.getByRole('button', { name: 'Open Secure Preview' })).toHaveCount(0);
    await expect(page.locator('main iframe, main object, main embed')).toHaveCount(0);
    await page.getByLabel('Choose a Document').selectOption('synthetic-clean');
    await page.getByRole('button', { name: 'Open Secure Preview' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__uiFixtureActions))
      .toEqual(['synthetic-clean']);
  });
  test('document search uses the authorized metadata and keeps empty results safe', async ({
    page,
  }) => {
    await openUiFixture(page, 'documents');
    const search = page.getByRole('searchbox', { name: 'Find a Document' });
    await search.fill('no-such-document');
    await expect(
      page.getByText('No documents match. Try another name or clear your search.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Secure Preview' })).toHaveCount(0);
    await search.clear();
    await expect(page.getByLabel('Choose a Document').locator('option')).toHaveCount(2);
    await search.fill('letter');
    await expect(page.getByLabel('Choose a Document').locator('option')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open Secure Preview' })).toHaveCount(0);
  });
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const mode of ['profile', 'documents', 'sharing', 'agency', 'admin'] as const) {
      test(`${mode} has no serious accessibility violations in ${colorScheme} mode`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await openUiFixture(page, mode);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        const blocking = result.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }
  for (const mode of ['profile', 'documents', 'sharing', 'agency', 'admin'] as const) {
    test(`${mode} reflows at 320px with increased text spacing`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openUiFixture(page, mode);
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }',
      });
      const overflowing = await page
        .locator('body')
        .evaluate((body) => body.scrollWidth > window.innerWidth + 1);
      expect(overflowing).toBe(false);
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();
    });
  }
  test('the public surfaces remain flat in both color schemes', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const path of ['/', '/trust', '/auth/sign-up', '/auth/sign-in']) {
        await page.goto(path);
        const effects = await page.locator('body').evaluate((body) =>
          [...body.querySelectorAll('*')]
            .filter((element) => {
              // Owner decision D1: only the Harbor hero and product chapter on the landing may
              // use soft shadows and gradients. Everything else stays flat, on every page.
              if (element.closest('.c1-hero, .c1-darkstage')) return false;
              const css = getComputedStyle(element);
              return (
                css.boxShadow !== 'none' ||
                css.textShadow !== 'none' ||
                css.backdropFilter !== 'none' ||
                /(?:linear|radial)-gradient|blur\(|drop-shadow\(/.test(
                  css.backgroundImage + css.filter,
                )
              );
            })
            .map((element) => element.className),
        );
        expect(effects, path).toEqual([]);
      }
    }
  });
});

/** The approved appearance is independent of the device preference. */
test.describe('authoritative appearance on public routes', () => {
  for (const width of [1600, 390]) {
    for (const route of [
      '/',
      '/trust',
      '/auth/sign-up',
      '/auth/sign-in',
      '/privacy',
      '/terms',
      '/status',
    ]) {
      test(`${route} keeps identical pixels under both device appearances at ${width}px`, async ({
        page,
        browser,
        baseURL,
      }) => {
        await page.setViewportSize({ width, height: width === 1600 ? 1000 : 844 });
        if (route === '/status') {
          // Compare the same completed health state and timestamp across fresh renders.
          // The live clock and unfinished requests must not become appearance differences.
          await page.clock.setFixedTime(new Date('2026-10-11T05:00:00.000Z'));
        }
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
        await page.goto(route);
        if (route === '/status') {
          await expect(page.getByRole('button', { name: 'Check Now', exact: true })).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Check Now', exact: true }),
          ).not.toHaveAttribute('aria-disabled', 'true');
          await expect(page.getByText(/^Updated /)).toBeVisible();
        }
        await page.evaluate(() => document.fonts.ready);
        const light = await page.screenshot({
          path: test.info().outputPath('appearance-light.png'),
          animations: 'disabled',
          caret: 'hide',
        });
        await page.emulateMedia({ colorScheme: 'dark' });
        expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
          'light',
        );
        // Render the second OS preference in a fresh context. Native appearance
        // emulation can retain rounded-edge raster caches across page reloads.
        // Both complete renders still have to match every pixel exactly.
        if (!baseURL) throw new Error('A deployment URL is required');
        const darkPage = await browser.newPage({
          baseURL,
          colorScheme: 'dark',
          reducedMotion: 'reduce',
          viewport: { width, height: width === 1600 ? 1000 : 844 },
        });
        let dark: Buffer;
        try {
          if (route === '/status') {
            await darkPage.clock.setFixedTime(new Date('2026-10-11T05:00:00.000Z'));
          }
          await darkPage.goto(route);
          if (route === '/status') {
            await expect(
              darkPage.getByRole('button', { name: 'Check Now', exact: true }),
            ).toBeVisible();
            await expect(
              darkPage.getByRole('button', { name: 'Check Now', exact: true }),
            ).not.toHaveAttribute('aria-disabled', 'true');
            await expect(darkPage.getByText(/^Updated /)).toBeVisible();
          }
          await darkPage.evaluate(() => document.fonts.ready);
          expect(
            await darkPage.locator('html').evaluate((el) => getComputedStyle(el).colorScheme),
          ).toBe('light');
          dark = await darkPage.screenshot({
            path: test.info().outputPath('appearance-dark.png'),
            animations: 'disabled',
            caret: 'hide',
          });
        } finally {
          await darkPage.close();
        }
        expect(
          dark.equals(light),
          'changing the device preference changes no approved surface',
        ).toBe(true);
        expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
          'light',
        );
        await test.info().attach('approved-light', { body: light, contentType: 'image/png' });
        await test.info().attach('approved-dark-device', { body: dark, contentType: 'image/png' });
      });
    }
  }
  test('phone site navigation opens, focuses a real destination and closes on Escape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(page.locator('header.nav')).toHaveCSS('height', '64px');
    await menu.click();
    await expect(
      page
        .getByRole('navigation', { name: 'Site', exact: true })
        .getByRole('link', { name: 'Product', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.getByRole('link', { name: 'How It Works', exact: true }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#how-it-works')).toBeInViewport();
  });
  test('homepage anchors resolve and desktop header follows the reference geometry', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    const box = await page.locator('header.nav').boundingBox();
    expect(box?.width).toBe(1448);
    expect(box?.height).toBe(72);
    // Harbor C1 geometry and colour (WP-L1): headline weight and size, and the navy stage.
    await expect(page.locator('.c1-headline')).toHaveCSS('font-weight', '820');
    await expect(page.locator('.c1-headline')).toHaveCSS('font-size', '97px');
    // Legibility (G1b): loose enough that the "c" and "l" of "clean" never touch (-0.04em of 97px).
    await expect(page.locator('.c1-headline')).toHaveCSS('letter-spacing', '-3.88px');
    await expect(page.locator('.c1-darkstage')).toHaveCSS('background-color', 'rgb(11, 26, 48)');
    const missing = await page
      .locator('a[href^="/#"]')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href')?.slice(2))
          .filter((id) => id && !document.getElementById(id)),
      );
    expect(missing).toEqual([]);
    await page.goto('/trust');
    // The 12px caption size (owner list item 14), on the same 12px line, so the title stays put.
    await expect(page.locator('.trust-hero .eyebrow')).toHaveCSS('font-size', '12px');
    await expect(page.locator('.trust-hero .eyebrow')).toHaveCSS('line-height', '12px');
    const trustTitle = await page.locator('#trust-story-title').boundingBox();
    // The notice shows in full on a visitor's first page only (owner list item 17), so on this
    // second page it may already be the slim label; the title sits under it either way.
    const banner = await page.locator('.pilot-banner').boundingBox();
    expect(trustTitle?.x).toBe(116);
    expect(trustTitle?.y).toBeCloseTo(206 + (banner?.height ?? 0), 0);
    await page.goto('/auth/sign-up');
    expect((await page.locator('.auth-introduction').boundingBox())?.width).toBe(740);
    expect((await page.locator('.auth-form-panel').boundingBox())?.width).toBe(480);
  });
});

/**
 * A capture taken the moment a page finishes loading can still catch a late repaint right after a
 * deployment. Take it again until two captures in a row are identical (at most five tries) and use
 * that settled one.
 */
async function settledScreenshot(page: Page, name: string): Promise<Buffer> {
  const take = () =>
    page.screenshot({
      path: test.info().outputPath(name),
      animations: 'disabled',
      caret: 'hide',
    });
  let previous = await take();
  for (let attempt = 1; attempt < 5; attempt++) {
    const next = await take();
    if (next.equals(previous)) return next;
    previous = next;
  }
  return previous;
}

/**
 * The most a pixel may differ, per colour channel out of 255, and still count as the same picture.
 * Chromium smooths the rounded corner of a small badge slightly differently between two fresh
 * renders (seen as two pixels off by 3), which no person can see. A real light or dark change moves
 * colours by far more than this, so it still fails.
 */
const PIXEL_NOISE_LIMIT = 6;

async function pixelDifference(
  first: Buffer,
  second: Buffer,
): Promise<{ sameSize: boolean; worst: number; changed: number }> {
  if (first.equals(second)) return { sameSize: true, worst: 0, changed: 0 };
  const [a, b] = await Promise.all(
    [first, second].map((image) =>
      sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  if (!a || !b || a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { sameSize: false, worst: 255, changed: -1 };
  }
  let worst = 0;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelWorst = 0;
    for (let channel = 0; channel < 4; channel++) {
      pixelWorst = Math.max(
        pixelWorst,
        Math.abs((a.data[i + channel] ?? 0) - (b.data[i + channel] ?? 0)),
      );
    }
    if (pixelWorst > 0) changed++;
    worst = Math.max(worst, pixelWorst);
  }
  return { sameSize: true, worst, changed };
}

test.describe('pixel comparison tolerance', () => {
  const picture = (value: number) =>
    sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: value, g: value, b: value } },
    })
      .png()
      .toBuffer();
  test('accepts invisible smoothing noise and rejects a real colour change', async () => {
    const base = await picture(245);
    expect((await pixelDifference(base, await picture(248))).worst).toBeLessThanOrEqual(
      PIXEL_NOISE_LIMIT,
    );
    expect((await pixelDifference(base, await picture(200))).worst).toBeGreaterThan(
      PIXEL_NOISE_LIMIT,
    );
    expect((await pixelDifference(base, base)).changed).toBe(0);
  });
});

test.describe('authoritative appearance of actual workspace components', () => {
  test.use({ bypassCSP: true });
  for (const width of [1600, 390]) {
    for (const mode of [
      'overview',
      'profile',
      'documents',
      'case',
      'sharing',
      'agency',
      'admin',
      'shell',
    ] as const) {
      test(`${mode} keeps identical pixels under both device appearances at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 1600 ? 1000 : 844 });
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
        await openUiFixture(page, mode);
        await page.evaluate(() => document.fonts.ready);
        const light = await settledScreenshot(page, 'appearance-light.png');
        await page.emulateMedia({ colorScheme: 'dark' });
        // Compare fresh renders, matching the desktop and phone capture protocol.
        // Chromium can otherwise repaint fractional native-input edges during a media toggle.
        await openUiFixture(page, mode);
        await page.evaluate(() => document.fonts.ready);
        const dark = await settledScreenshot(page, 'appearance-dark.png');
        await expect(page.locator('.app-main')).toHaveCSS('background-color', 'rgb(247, 249, 254)');
        await expect(page.locator('header.nav')).toBeHidden();
        if (width === 1600) {
          expect((await page.locator('.app-shell-nav').boundingBox())?.width).toBe(256);
          expect((await page.locator('.workspace-toolbar').boundingBox())?.height).toBe(83);
        }
        await test
          .info()
          .attach('synthetic-workspace-light', { body: light, contentType: 'image/png' });
        await test
          .info()
          .attach('synthetic-workspace-dark-device', { body: dark, contentType: 'image/png' });
        const difference = await pixelDifference(light, dark);
        expect(
          difference.sameSize && difference.worst <= PIXEL_NOISE_LIMIT,
          `changing the device preference changes no workspace surface (${difference.changed} pixels differ, by at most ${difference.worst} of 255)`,
        ).toBe(true);
      });
    }
  }
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`the progress ring is an image with its words, flat, and fits at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openUiFixture(page, 'overview');
      const rings = page.locator('[data-fixture="rings"]');
      await expect(rings.getByRole('img', { name: '6 of 9 items ready' }).first()).toBeVisible();
      await expect(rings.getByRole('img', { name: '4 of 4 items ready' })).toBeVisible();
      await expect(rings.getByRole('img', { name: 'No checklist yet' }).first()).toBeVisible();
      // The same words are on the screen beside the ring, and the empty ring teaches.
      await expect(rings.getByText('6 of 9 items ready').first()).toBeVisible();
      await expect(rings.getByText('Pick a checklist to see what is ready').first()).toBeVisible();
      await expect(
        rings.getByRole('link', { name: 'Pick a Checklist', exact: true }),
      ).toBeVisible();
      const findings = await rings.evaluate((root) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const fill = root.querySelector('.progress-ring-fill');
        const fillStroke = fill ? getComputedStyle(fill).stroke : '';
        const sizes = [...root.querySelectorAll('.progress-ring svg')].map(
          (svg) => svg.getBoundingClientRect().width,
        );
        const moving = [...root.querySelectorAll('.progress-ring *')].filter((element) => {
          const css = getComputedStyle(element);
          return (
            css.animationName !== 'none' ||
            css.transitionDuration.split(',').some((d) => d.trim() !== '0s')
          );
        }).length;
        const link = root.querySelector('.progress-ring-action');
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          fillIsAccent: fillStroke === accent,
          smallestRing: Math.min(...sizes),
          moving,
          linkHeight: link ? link.getBoundingClientRect().height : 0,
          clipped: [...root.querySelectorAll('.progress-ring-text, .progress-ring-words')].filter(
            (element) => element.getBoundingClientRect().right > innerWidth + 1,
          ).length,
        };
      });
      expect(findings.overflow).toBe(false);
      expect(findings.fillIsAccent).toBe(true);
      expect(findings.smallestRing).toBeGreaterThanOrEqual(43.5);
      expect(findings.moving).toBe(0);
      expect(findings.linkHeight).toBeGreaterThanOrEqual(44);
      expect(findings.clipped).toBe(0);
      await rings.screenshot({
        path: test.info().outputPath(`rings-${width}.png`),
        animations: 'disabled',
      });
    });
  }
  test('the progress ring and the screen around it have no serious accessibility violations', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUiFixture(page, 'overview');
    const result = await new AxeBuilder({ page })
      .include('[data-fixture="rings"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`the deadline clock says every tone in words, marks a date to check, and fits at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openUiFixture(page, 'overview');
      const clock = page.locator('[data-fixture="deadline-clock"]');
      for (const word of [
        'Overdue',
        'Within a Week',
        'Within a Month',
        'Later',
        'Check This Date',
      ]) {
        await expect(clock.getByText(word, { exact: true }).first()).toBeVisible();
      }
      await expect(clock.getByText('Was due 3 days ago')).toBeVisible();
      await expect(clock.getByText('Expires tomorrow')).toBeVisible();
      await expect(
        clock.getByText('Expires in about 8 months, if the date is right'),
      ).toBeVisible();
      // The empty clock teaches and offers the way to add the first document.
      await expect(clock.getByText('No Dates Yet')).toBeVisible();
      await expect(
        clock.getByText(
          'Add a passport and its expiry date appears here, so you hear about it before it matters.',
        ),
      ).toBeVisible();
      await expect(clock.getByRole('link', { name: 'Add a Document', exact: true })).toBeVisible();
      const findings = await clock.evaluate((root) => {
        const lines = [...root.querySelectorAll('.deadline-link')];
        const tags = [...root.querySelectorAll('.deadline-tag')];
        const moving = [...root.querySelectorAll('[class*="deadline-"]')].filter((element) => {
          const css = getComputedStyle(element);
          return (
            css.animationName !== 'none' ||
            css.transitionDuration.split(',').some((d) => d.trim() !== '0s') ||
            css.boxShadow !== 'none' ||
            /gradient/.test(css.backgroundImage)
          );
        }).length;
        const dashed = root.querySelector('.deadline-tag-check');
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          shortest: Math.min(...lines.map((line) => line.getBoundingClientRect().height)),
          clipped: [...root.querySelectorAll('.deadline-main, .deadline-tags')].filter(
            (element) => element.getBoundingClientRect().right > innerWidth + 1,
          ).length,
          tagCount: tags.length,
          flat: moving,
          checkStyle: dashed ? getComputedStyle(dashed).borderTopStyle : '',
        };
      });
      expect(findings.overflow).toBe(false);
      expect(findings.shortest).toBeGreaterThanOrEqual(44);
      expect(findings.clipped).toBe(0);
      expect(findings.tagCount).toBe(5);
      expect(findings.flat).toBe(0);
      expect(findings.checkStyle).toBe('dashed');
      await clock.screenshot({
        path: test.info().outputPath(`deadline-clock-${width}.png`),
        animations: 'disabled',
      });
    });
  }
  test('the deadline clock has no serious accessibility violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUiFixture(page, 'overview');
    const result = await new AxeBuilder({ page })
      .include('[data-fixture="deadline-clock"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
  test('page finder points to existing destinations and hides administration for ordinary users', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openUiFixture(page, 'overview');
    await page.keyboard.press('Control+k');
    const finder = page.getByRole('searchbox', { name: 'Find a Page' });
    await expect(finder).toBeFocused();
    await finder.fill('applicants');
    await expect(
      page
        .getByRole('navigation', { name: 'Matching pages' })
        .getByRole('link', { name: 'Applicants' }),
    ).toHaveAttribute('href', '/app/applicants');
    await finder.fill('administration');
    await expect(page.getByText('No pages match. Try another name.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(finder).toHaveValue('');
    await openUiFixture(page, 'admin');
    await page.getByRole('searchbox', { name: 'Find a Page' }).fill('administration');
    await expect(
      page
        .getByRole('navigation', { name: 'Matching pages' })
        .getByRole('link', { name: 'Platform Administration' }),
    ).toHaveAttribute('href', '/app/admin');
  });
});

/** Box of the first match, rounded; fails loudly when nothing matches. */
async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`No box for ${selector}`);
  return found;
}

test.describe('collapsible sidebar and account menu fit the screen', () => {
  test.use({ bypassCSP: true });
  // Width, height and device scale factor. The scaled ones are a 1920x1080 laptop at 125 and 150
  // percent, where the real viewport is a lot smaller than the screen.
  const sizes = [
    [1366, 768, 1],
    [1440, 900, 1],
    [1920, 1080, 1],
    [1280, 600, 1],
    [1280, 600, 1.5],
    [910, 554, 1.5],
    [1024, 700, 1],
    // A very short window: the rows no longer all fit, so the panel must scroll inside itself.
    [1280, 480, 1],
  ] as const;

  for (const [width, height, scale] of sizes) {
    for (const sidebar of ['expanded', 'collapsed'] as const) {
      test.describe(`${width}x${height} at ${scale}x with the ${sidebar} sidebar`, () => {
        test.use({ deviceScaleFactor: scale });
        test('account menu is compact, clear of every edge and never most of the screen', async ({
          page,
        }) => {
          await page.setViewportSize({ width, height });
          await openUiFixture(page, 'shell', { sidebar });
          await page.locator('.record-account > summary').click();
          const panel = await box(page, '.account-menu-panel');
          const opener = await box(page, '.record-account > summary');
          expect(panel.x).toBeGreaterThanOrEqual(0);
          expect(panel.y).toBeGreaterThanOrEqual(0);
          expect(panel.x + panel.width).toBeLessThanOrEqual(width);
          // At least 16px clear of the bottom edge, never touching it.
          expect(height - (panel.y + panel.height)).toBeGreaterThanOrEqual(16);
          // A compact popover: 17.5rem wide, never the whole screen height, never above 70 percent.
          expect(panel.width).toBeGreaterThanOrEqual(272);
          expect(panel.width).toBeLessThanOrEqual(288);
          expect(panel.height).toBeLessThanOrEqual(height * 0.7 + 1);
          // Precise pointer: 34px rows (WCAG 2.2 AA asks for 24px), not the 44px touch rows.
          expect((await box(page, '.account-menu-row')).height).toBe(34);
          // Anchored to its trigger: under it, lined up with its right edge.
          expect(panel.y).toBeGreaterThanOrEqual(opener.y + opener.height);
          expect(Math.abs(panel.x + panel.width - (opener.x + opener.width))).toBeLessThanOrEqual(
            1,
          );
          // The page itself never gains a scrollbar from the menu.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBe(0);
          // Every row can be reached: either it fits, or the panel scrolls (Sign Out stays in view).
          const { scrolls, natural } = await page.evaluate(() => {
            const menu = document.querySelector<HTMLElement>('.account-menu-panel');
            return {
              scrolls: menu ? menu.scrollHeight > menu.clientHeight : false,
              natural: menu ? menu.scrollHeight : 0,
            };
          });
          if (!scrolls) expect(panel.height).toBeGreaterThanOrEqual(natural);
          // From 768px tall up, nothing scrolls and the menu is clearly less than half the window.
          if (height >= 768) {
            expect(scrolls).toBe(false);
            expect(panel.height).toBeLessThan(height * 0.5);
          }
          await expect(page.getByRole('button', { name: 'Sign Out' })).toBeInViewport();
          if (scrolls) {
            // Scrolled or not, Sign Out stays pinned flush to the panel's bottom edge.
            const out = await box(page, '.account-menu-signout button');
            expect(panel.y + panel.height - (out.y + out.height)).toBeLessThanOrEqual(10);
          }
        });
      });
    }
  }

  test.describe('a touch screen at laptop width keeps the roomy rows', () => {
    test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });
    test('rows stay 44px tall when the pointer is coarse', async ({ page }) => {
      await openUiFixture(page, 'shell');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await page.locator('.record-account > summary').click();
      expect((await box(page, '.account-menu-row')).height).toBe(44);
      const panel = await box(page, '.account-menu-panel');
      expect(768 - (panel.y + panel.height)).toBeGreaterThanOrEqual(16);
      expect(panel.height).toBeLessThanOrEqual(768 * 0.7 + 1);
    });
  });

  test('account menu opens above a trigger that sits low, and still fits', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUiFixture(page, 'shell');
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('.workspace-toolbar');
      if (!bar) throw new Error('Toolbar missing');
      bar.style.position = 'fixed';
      bar.style.left = '256px';
      bar.style.right = '0';
      bar.style.bottom = '0';
    });
    await page.locator('.record-account > summary').click();
    const panel = await box(page, '.account-menu-panel');
    const opener = await box(page, '.record-account > summary');
    expect(panel.y + panel.height).toBeLessThanOrEqual(opener.y);
    expect(panel.y).toBeGreaterThanOrEqual(0);
  });

  test('account menu closes on Escape with focus back on its trigger, and on an outside click', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    const trigger = page.locator('.record-account > summary');
    await trigger.click();
    await expect(page.locator('.account-menu-panel')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('.account-menu-panel')).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(600, 500);
    await expect(page.locator('.account-menu-panel')).toBeHidden();
  });

  test('the open sidebar keeps its pinned measurements and shows Hide Menu', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openUiFixture(page, 'shell');
    expect((await box(page, '.app-shell-nav')).width).toBe(256);
    expect((await box(page, '.workspace-toolbar')).height).toBe(83);
    const hide = page.getByRole('button', { name: 'Hide Menu' });
    await expect(hide).toBeVisible();
    await expect(hide).toHaveAttribute('aria-expanded', 'true');
    const target = await hide.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  });

  test('Hide Menu leaves a slim rail, the page takes the room, and Show Menu brings it back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openUiFixture(page, 'shell');
    const mainBefore = (await box(page, '.app-main')).width;
    const hide = page.getByRole('button', { name: 'Hide Menu' });
    await hide.focus();
    await page.keyboard.press('Enter');
    const show = page.getByRole('button', { name: 'Show Menu' });
    await expect(show).toBeFocused();
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    expect((await box(page, '.app-shell-nav')).width).toBe(72);
    expect((await box(page, '.app-main')).width).toBe(mainBefore + 256 - 72);
    // No sideways scrolling, in the page or in the rail itself.
    const scroll = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('.app-shell-nav');
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rail: nav ? nav.scrollWidth - nav.clientWidth : -1,
      };
    });
    expect(scroll.page).toBe(0);
    expect(scroll.rail).toBeLessThanOrEqual(1);
    // Every destination is still there by name, the words are gone, and the footer note is hidden.
    await expect(page.getByRole('link', { name: 'Record' })).toBeVisible();
    await expect(page.getByText('You Control Access')).toBeHidden();
    await expect(page.locator('.app-shell-nav .app-link-label').first()).toBeHidden();
    // Keyboard: every control reached by Tab inside the rail really is inside the rail.
    await show.focus();
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active?.closest('.app-shell-nav')) return null;
        const rect = active.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right <= 72;
      });
      if (inside === null) break;
      expect(inside, 'a hidden control must never take focus').toBe(true);
    }
    await show.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Hide Menu' })).toBeFocused();
    expect((await box(page, '.app-shell-nav')).width).toBe(256);
    expect((await box(page, '.app-main')).width).toBe(mainBefore);
  });

  test('the choice is saved for this device as one small cookie and read back as a rail', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openUiFixture(page, 'shell');
    await page.getByRole('button', { name: 'Hide Menu' }).click();
    const saved = (await page.context().cookies()).find((c) => c.name === 'visastack_sidebar');
    expect(saved?.value).toBe('collapsed');
    expect(saved?.path).toBe('/app');
    expect(saved?.sameSite).toBe('Lax');
    expect(saved?.httpOnly).toBe(false);
    // The signed-in layout hands that value to the shell, which draws the rail from the first paint.
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    expect((await box(page, '.app-shell-nav')).width).toBe(72);
    await expect(page.getByRole('button', { name: 'Show Menu' })).toBeVisible();
  });

  test('Hide Menu names itself on hover in the open sidebar, where it has no words', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUiFixture(page, 'shell');
    const hide = page.getByRole('button', { name: 'Hide Menu' });
    expect(await hide.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none');
    await hide.hover();
    expect(await hide.evaluate((el) => getComputedStyle(el, '::after').content)).toBe(
      '"Hide Menu"',
    );
  });

  test('Escape puts a rail label away until another control is reached', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    const record = page.getByRole('link', { name: 'Record' });
    const cases = page.getByRole('link', { name: 'Cases' });
    const label = (link: typeof record) =>
      link.evaluate((el) => getComputedStyle(el, '::after').content);
    await record.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await label(record)).toBe('"Record"');
    await page.keyboard.press('Escape');
    expect(await label(record)).toBe('none');
    await page.keyboard.press('Tab');
    await expect(cases).toBeFocused();
    expect(await label(cases)).toBe('"Cases"');
  });

  test('rail controls name themselves beside the rail on hover and keyboard focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    const link = page.getByRole('link', { name: 'Record' });
    const label = () =>
      link.evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        return { content: style.content, position: style.position, left: style.left };
      });
    expect((await label()).content).toBe('none');
    await link.hover();
    const hovered = await label();
    expect(hovered.content).toBe('"Record"');
    expect(hovered.position).toBe('fixed');
    await page.mouse.move(800, 500);
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect((await label()).content).toBe('"Record"');
  });

  test('beside the rail, the workspace list and More Tools open inside the screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    for (const trigger of [
      '.app-shell-nav > .workspace-selector > summary',
      '.workspace-tools > summary',
    ]) {
      await page.locator(trigger).click();
      const list = page.locator(
        trigger.includes('workspace-selector')
          ? '.app-shell-nav > .workspace-selector > nav'
          : '.workspace-tools-list',
      );
      await expect(list).toBeVisible();
      const listBox = await box(
        page,
        trigger.includes('workspace-selector')
          ? '.app-shell-nav > .workspace-selector > nav'
          : '.workspace-tools-list',
      );
      expect(listBox.x).toBeGreaterThanOrEqual(72);
      expect(listBox.y).toBeGreaterThanOrEqual(0);
      expect(listBox.y + listBox.height).toBeLessThanOrEqual(600);
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(1280);
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(page.locator(trigger)).toBeFocused();
    }
  });

  test('the button is a laptop control: hidden on a phone and a tablet, shown from 1024px', async ({
    page,
  }) => {
    for (const [width, shown] of [
      [390, false],
      [1023, false],
      [1024, true],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await openUiFixture(page, 'shell');
      expect(await page.locator('.app-sidebar-toggle').isVisible()).toBe(shown);
    }
    // A saved rail never changes the phone bar.
    await page.setViewportSize({ width: 390, height: 844 });
    await openUiFixture(page, 'shell', { sidebar: 'collapsed' });
    const bar = await box(page, '.app-shell-nav');
    expect(bar.width).toBe(390);
    await expect(page.locator('.app-more-toggle')).toBeVisible();
  });

  test('nothing animates, so reduced motion has nothing to switch off', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUiFixture(page, 'shell');
    const motion = await page.evaluate(() => {
      const names = ['.app-frame', '.app-shell-nav', '.app-main', '.app-sidebar-toggle'];
      return names.map((selector) => {
        const element = document.querySelector(selector);
        const style = element ? getComputedStyle(element) : null;
        return [selector, style?.transitionDuration, style?.animationName];
      });
    });
    for (const [, duration, animation] of motion) {
      expect(duration).toBe('0s');
      expect(animation).toBe('none');
    }
  });

  for (const sidebar of ['expanded', 'collapsed'] as const) {
    test(`no serious accessibility violations in the ${sidebar} shell with the account menu open`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await openUiFixture(page, 'shell', { sidebar });
      await page.locator('.record-account > summary').click();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .include('.app-frame')
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

test('password recovery confirms the request and offers an explicit resend without exposing accounts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/auth/forgot-password?sent=1');
  await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible();
  await expect(page.getByText('If an account uses that address', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Email Address')).toBeHidden();
  await page.getByText('Did not get a link? Send another', { exact: true }).click();
  await expect(page.getByLabel('Email Address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Another Link' })).toBeVisible();
  await page.getByRole('link', { name: 'Use a Different Email Address' }).click();
  await expect(page.getByRole('button', { name: 'Send Me a Link' })).toBeVisible();
  await page.goto('/auth/forgot-password?e=unavailable');
  await expect(
    page.getByText('We could not request a link right now.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Me a Link' })).toBeVisible();
});

/** Growth G2: pick a country on the landing page and the checklist fills in at once. */
test.describe('country checklist on the landing page (Growth G2)', () => {
  const sizes = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  for (const size of sizes) {
    test(`picking a country fills in its checklist at ${size.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');
      const box = page.getByLabel('Which Country Do You Want to Visit?');
      await expect(box).toBeVisible();
      // A comfortable target for a thumb, and nothing chosen yet.
      expect((await box.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(
        page.getByText('Your checklist appears here as soon as you pick a country.'),
      ).toBeVisible();

      // Half a name picks nothing.
      await box.fill('Germ');
      await expect(page.locator('.country-pick-result')).toHaveCount(0);

      // A whole name shows the checklist with no waiting and no spinner.
      await box.fill('Germany');
      await expect(page.getByRole('heading', { name: 'Germany', level: 3 })).toBeVisible();
      const items = page.locator('.country-pick-item');
      expect(await items.count()).toBeGreaterThanOrEqual(5);
      await expect(items.first()).toBeVisible();
      await expect(
        page.getByText('not a decision and not a promise', { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: 'Showing the checklist for Germany' }),
      ).toBeVisible();

      // A short list says so.
      await box.fill('Canada');
      await expect(page.getByRole('heading', { name: 'Canada', level: 3 })).toBeVisible();
      await expect(
        page.getByText('This list may not be complete.', { exact: false }),
      ).toBeVisible();

      // The button carries the country on to sign-up (or sign-in while sign-up is closed).
      const start = page.locator('.country-pick-action a');
      await expect(start).toBeVisible();
      expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(start).toHaveAttribute(
        'href',
        /^\/auth\/sign-(up|in)\?next=%2Fapp%3Fcountry%3DCA$/,
      );

      // No sideways scroll, and the picker passes the automated accessibility rules.
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      // The checklist items fade in; scan only once they have finished, so no colour is measured
      // half way through the reveal.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .include('.country-start')
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

  test('the chosen country survives the trip to the account page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByLabel('Which Country Do You Want to Visit?').fill('Japan');
    await page.locator('.country-pick-action a').click();
    await expect(page).toHaveURL(/\/auth\/sign-(up|in)\?next=%2Fapp%3Fcountry%3DJP$/);
    // The return path is kept in the form, so first run opens on Japan after sign-in.
    await expect(page.locator('input[name="next"]')).toHaveValue('/app?country=JP');
  });

  test('a device that asks for less motion gets the list with no reveal', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByLabel('Which Country Do You Want to Visit?').fill('Germany');
    const name = await page
      .locator('.country-pick-item')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(name).toBe('none');
  });

  test('a device that allows motion reveals the items one after another', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.getByLabel('Which Country Do You Want to Visit?').fill('Germany');
    const delays = await page
      .locator('.country-pick-item')
      .evaluateAll((elements) =>
        elements.slice(0, 3).map((element) => getComputedStyle(element).animationDelay),
      );
    expect(delays).toEqual(['0s', '0.045s', '0.09s']);
  });
});

/*
 * QA-E (owner list items 13, 14, 17 and 18). Every screen below is the real component rendered
 * by the UI fixture (no session, no server) or a real public page, measured in a real browser.
 */

/**
 * Every interactive target that stands on its own and cannot be pressed across 44px each way. A
 * control drawn smaller (a compact badge) passes only when a 44px square around its centre still
 * lands on it everywhere, which is what its hit-area overlay is for.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').trim().split(/\s+/).join('.')} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}"`;
    const covers = (target: Element, x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === target || target.contains(hit));
    };
    const misses: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, summary, select, textarea, [role="button"], [role="tab"], input:not([type="hidden"])',
    );
    for (const control of controls) {
      if (control.matches('.sr-only, .skip-link') || control.closest('[aria-hidden="true"]'))
        continue;
      if (!control.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      // A link inside a line of text is part of the sentence (WCAG 2.5.8 inline exception).
      if (getComputedStyle(control).display === 'inline') continue;
      // A tick box or option is pressed through its label, so the label is its target.
      let target: Element = control;
      if (
        control instanceof HTMLInputElement &&
        (control.type === 'checkbox' || control.type === 'radio') &&
        control.labels?.[0]
      )
        target = control.labels[0];
      let box = target.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (box.width >= 43.5 && box.height >= 43.5) continue;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const offsets = [-21, 0, 21];
      const pressable = offsets.every((dx) =>
        offsets.every((dy) => (dx === 0 && dy === 0) || covers(target, x + dx, y + dy)),
      );
      if (!pressable)
        misses.push(`${name(control)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    window.scrollTo(0, 0);
    return misses;
  });
}

/** Every piece of visible text set below 12px, with where it is and its size. */
async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const misses = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const words = node.textContent?.trim();
      const parent = node.parentElement;
      if (!words || !parent || parent.closest('script, style, noscript, template')) continue;
      if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((box) => box.width > 0 && box.height > 0)) continue;
      const size = Number.parseFloat(getComputedStyle(parent).fontSize);
      if (size > 0 && size < 11.95)
        misses.add(
          `${parent.tagName.toLowerCase()}.${parent.className} "${words.slice(0, 30)}" ${size}px`,
        );
    }
    return [...misses];
  });
}

/**
 * Reading text on a phone that is smaller than 16px: notices and card body text that no component
 * rule, size utility or inline size makes smaller on purpose (the same exceptions as the style
 * sheet), and the staff banner.
 */
async function smallReadingText(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.notice:not(.wallet-ai-notice, .case-manual-notice, .home-attention-why), .app-main .card-body:not(.admin-reference-rail .card-body), .staff-mode-banner',
      ),
    ]
      .filter((element) => !/\bu-fs-/.test(element.className) && !element.style.fontSize)
      .filter((element) => element.checkVisibility({ checkVisibilityCSS: true }))
      .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 15.95)
      .map(
        (element) =>
          `${element.className} "${(element.textContent ?? '').trim().slice(0, 30)}" ${getComputedStyle(element).fontSize}`,
      ),
  );
}

const SIGNED_IN_MODES = [
  'overview',
  'profile',
  'documents',
  'case',
  'sharing',
  'agency',
  'admin',
  'shell',
  'staff',
] as const;

test.describe('signed-in screens pass the automated accessibility scan (owner list item 13)', () => {
  test.use({ bypassCSP: true });
  for (const mode of SIGNED_IN_MODES) {
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ] as const) {
      test(`${mode} at ${width}px has no serious or critical violations`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openUiFixture(page, mode);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        const blocking = result.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
        // Every link and button, icon-only ones included, has a name a screen reader can say.
        const unnamed = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('main a[href], main button, main summary')]
            .filter((control) => control.checkVisibility())
            .filter(
              (control) =>
                !control.getAttribute('aria-label')?.trim() &&
                !control.getAttribute('aria-labelledby') &&
                !control.getAttribute('title') &&
                !control.innerText.trim(),
            )
            .map((control) => control.outerHTML.slice(0, 120)),
        );
        expect(unnamed).toEqual([]);
      });
    }
  }
});

test.describe('touch screens get 44px targets and readable text (owner list item 14)', () => {
  test.use({ bypassCSP: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  for (const mode of ['shell', 'overview', 'documents', 'staff'] as const) {
    test(`${mode}: every control is at least 44px and no text is under 12px`, async ({ page }) => {
      test.setTimeout(60_000);
      await openUiFixture(page, mode);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('16px');
      expect(await smallReadingText(page)).toEqual([]);
      // Bigger targets never push the page sideways.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
    });
  }
  for (const path of ['/auth/sign-up', '/auth/sign-in'] as const) {
    test(`${path}: every control is at least 44px and no text is under 12px`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect(await smallReadingText(page)).toEqual([]);
      // A phone never zooms in on a field: every field is at least 16px.
      const fields = await page
        .locator('main input:visible, main select:visible, main textarea:visible')
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) => !['checkbox', 'radio'].includes((element as HTMLInputElement).type),
            )
            .map((element) => getComputedStyle(element).fontSize),
        );
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.filter((size) => Number.parseFloat(size) < 15.95)).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('a touch laptop keeps compact controls pressable across 44px (owner list item 14)', () => {
  test.use({ bypassCSP: true, hasTouch: true, viewport: { width: 1280, height: 800 } });
  for (const mode of ['shell', 'staff'] as const) {
    test(`${mode}: every control, the compact plan pill included, can be pressed across 44px`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await openUiFixture(page, mode);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
    });
  }
});

test.describe('a precise pointer keeps no text under 12px on wide screens (owner list item 14)', () => {
  test.use({ bypassCSP: true });
  for (const mode of ['shell', 'overview', 'staff'] as const) {
    test(`${mode} at 1440px has no text under 12px`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openUiFixture(page, mode);
      expect(await smallText(page)).toEqual([]);
    });
  }
  test('the trust page has no text under 12px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/trust');
    await expect(page.locator('#trust-story-title')).toBeVisible();
    expect(await smallText(page)).toEqual([]);
  });
});

test.describe('the notice about this version shows once per visitor (owner list item 17)', () => {
  /** The notice writes its small cookie once the page is running; wait for it, not for a clock. */
  async function noticeRemembered(page: Page) {
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).find((cookie) => cookie.name === 'visastack_notice')
            ?.value,
        { timeout: 20_000 },
      )
      .toBe('seen');
  }

  /** The slim label: the version name and the link on one line, with no Hide button. */
  async function expectSlimLabel(page: Page) {
    const label = page.getByRole('region', { name: 'About this version' });
    await expect(label).toBeVisible();
    await expect(label).toHaveClass(/\bpilot-banner-slim\b/);
    await expect(label.locator('.pilot-banner-label')).toHaveText(
      /^VisaStack (Public Beta|Private Pilot|Test Build)$/,
    );
    await expect(label.getByRole('link', { name: 'What Works Today', exact: true })).toBeVisible();
    await expect(label.locator('.pilot-banner-detail, .pilot-banner-short, button')).toHaveCount(0);
    // One line: the name and the link sit side by side.
    const nameBox = await label.locator('.pilot-banner-label').boundingBox();
    const linkBox = await label.getByRole('link', { name: 'What Works Today' }).boundingBox();
    expect(
      Math.abs(
        (nameBox?.y ?? 0) +
          (nameBox?.height ?? 0) / 2 -
          ((linkBox?.y ?? 0) + (linkBox?.height ?? 0) / 2),
      ),
    ).toBeLessThan(4);
    return label;
  }

  test('shows in full on the first page, then as a one-line label, with the full words a footer link away', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/terms');
    const notice = page.getByRole('region', { name: 'About this version' });
    await expect(notice).toBeVisible();
    await expect(
      notice.getByRole('button', { name: 'Hide This Notice', exact: true }),
    ).toBeVisible();
    await noticeRemembered(page);
    // Moving on within the visit folds it to the label, and back on the first page it stays folded.
    const footer = page.getByRole('contentinfo');
    await footer.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expectSlimLabel(page);
    await footer.getByRole('link', { name: 'Terms', exact: true }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expectSlimLabel(page);
    // A fresh page load arrives with the label straight from the server.
    await page.goto('/privacy');
    await expect(page.locator('h1')).toBeVisible();
    const label = await expectSlimLabel(page);
    expect((await label.boundingBox())?.height ?? 999).toBeLessThanOrEqual(44);
    await footer.getByRole('link', { name: 'About This Version', exact: true }).click();
    await expect(page).toHaveURL(/\/status#about-this-version$/);
    await expect(page.locator('#about-this-version')).toContainText(
      /VisaStack (Public Beta|Private Pilot|Test Build)\./,
    );
    await expect(page.locator('#about-this-version')).toBeInViewport();
  });

  test('Hide This Notice folds it to the label at once, keeps the keyboard in it, and is remembered', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/terms');
    const notice = page.getByRole('region', { name: 'About this version' });
    await expect(notice).toBeVisible();
    // The cookie is written by the running page, so the button below is working by now.
    await noticeRemembered(page);
    await page.getByRole('button', { name: 'Hide This Notice', exact: true }).click();
    await expectSlimLabel(page);
    await expect(notice.getByRole('link', { name: 'What Works Today' })).toBeFocused();
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await expectSlimLabel(page);
  });
});

test.describe('the slim label is one 44px row on a touch screen (owner list item 17)', () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 640 } });
  test('the version name and a 44px link on one row', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/terms');
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).find((cookie) => cookie.name === 'visastack_notice')
            ?.value,
        { timeout: 20_000 },
      )
      .toBe('seen');
    await page.goto('/privacy');
    const label = page.getByRole('region', { name: 'About this version' });
    await expect(label).toHaveClass(/\bpilot-banner-slim\b/);
    const box = await label.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeLessThan(50);
    const link = await label.getByRole('link', { name: 'What Works Today' }).boundingBox();
    expect(link?.height).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe('sign-up on a phone asks only for what the account needs (owner list item 17)', () => {
  test('no traveller or agency choice, three fields and the acknowledgement', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/sign-up');
    const form = page.locator('form').filter({ has: page.locator('input[name="email"]') });
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="usageIntent"]')).toHaveCount(0);
    await expect(form.locator('input:visible')).toHaveCount(4);
    await expect(form.getByLabel('Your Name (Optional)')).toBeVisible();
    await expect(form.locator('input[name="acceptNotices"]')).not.toBeChecked();
    await expect(page.getByText('you do so at your own risk')).toBeVisible();
  });
});

test.describe('staff pages say staff mode and keep traveller context out (owner list item 18)', () => {
  test.use({ bypassCSP: true });
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px the staff banner shows and no traveller name or search appears`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openUiFixture(page, 'staff');
      const banner = page.getByRole('region', { name: 'Staff Mode', exact: true });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('You are using platform tools.');
      await expect(banner.getByRole('link', { name: 'Leave Staff Mode' })).toHaveAttribute(
        'href',
        '/app',
      );
      await expect(page.locator('.app-frame')).toHaveAttribute('data-workspace', 'platform');
      // Nothing about a traveller, even inside the closed menus.
      await expect(page.getByText('Synthetic Child')).toHaveCount(0);
      await expect(page.locator('a[href^="/app/applicant/"]')).toHaveCount(0);
      await expect(page.getByText(/your (own )?records?/i)).toHaveCount(0);
      await expect(page.locator('search, .record-search-toggle, .record-plan-badge')).toHaveCount(
        0,
      );
      await expect(page.getByText('You Control Access')).toHaveCount(0);
    });
  }
  test('the traveller shell shows no staff banner', async ({ page }) => {
    await openUiFixture(page, 'shell');
    await expect(page.locator('.staff-mode-banner')).toHaveCount(0);
  });
});

test.describe('public invitation page on a phone (UX-G)', () => {
  // A well-formed link that is never looked up: team and sharing invitations show the handoff only.
  const TOKEN = 'A'.repeat(43);
  for (const kind of ['team', 'sharing']) {
    test.describe(`${kind} invitation at 390px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/invitation?kind=${kind}&token=${TOKEN}`);
      });

      test('the main action shows in the first screen', async ({ page }) => {
        const primary = page.locator('.invitation-hero .invitation-actions .btn-primary');
        await expect(primary).toHaveText('Create an Account to Review');
        await expect(primary).toBeInViewport({ ratio: 1 });
        await expect(page.locator('.invitation-hero .invitation-reassure')).toBeInViewport();
      });

      test('has no critical or serious automated accessibility violations', async ({ page }) => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });

      test('every button and link on the page is at least 44px tall, or sits inside a sentence', async ({
        page,
      }) => {
        const small = await page
          .locator('.invitation-page a, .invitation-page button')
          .evaluateAll((elements) =>
            elements
              .filter((element) => !element.closest('li, p'))
              .map((element) => ({
                text: element.textContent?.trim(),
                height: element.getBoundingClientRect().height,
              }))
              .filter((target) => target.height < 44),
          );
        expect(small).toEqual([]);
      });

      test('pins the main buttons to the bottom only after the top ones scroll away', async ({
        page,
      }) => {
        const bar = page.locator('.invitation-sticky');
        await expect(bar).toHaveAttribute('data-shown', 'false');
        await expect(bar).toBeHidden();
        // Make the page long enough to scroll the top buttons out of view, whatever its length.
        await page.evaluate(() => {
          document.body.style.minHeight = '3000px';
          window.scrollTo(0, 1500);
        });
        await expect(bar).toHaveAttribute('data-shown', 'true');
        await expect(bar).toBeVisible();
        await expect(bar.locator('.btn-primary')).toHaveText('Create an Account to Review');
        // The bar slides in; measure it once it has come to rest at the bottom of the screen.
        await expect
          .poll(() => bar.evaluate((element) => Math.round(element.getBoundingClientRect().bottom)))
          .toBe(844);
        const sizes = await bar.evaluate((element) => ({
          bar: element.getBoundingClientRect().height,
          room: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
          bottom: Math.round(element.getBoundingClientRect().bottom),
          shadow: getComputedStyle(element).boxShadow,
        }));
        expect(sizes.room).toBeGreaterThanOrEqual(sizes.bar);
        expect(sizes.bottom).toBe(844);
        expect(sizes.shadow).toBe('none');
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(bar).toHaveAttribute('data-shown', 'false');
      });
    });

    for (const width of [320, 360, 390]) {
      test(`${kind} invitation at ${width}px keeps the steps on one line and never scrolls sideways`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/invitation?kind=${kind}&token=${TOKEN}`);
        const items = page.locator('ol.invitation-steps > li');
        await expect(items).toHaveCount(3);
        const layout = await page.evaluate(() => {
          const steps = document.querySelector('ol.invitation-steps');
          const boxes = [...(steps?.children ?? [])].map((item) => item.getBoundingClientRect());
          return {
            tops: boxes.map((box) => Math.round(box.top)),
            clipped: steps ? steps.scrollWidth > steps.clientWidth + 1 : true,
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        });
        expect(new Set(layout.tops).size).toBe(1);
        expect(layout.clipped).toBe(false);
        expect(layout.overflow).toBe(false);
        await expect(page.locator('ol.invitation-steps [aria-current="step"]')).toContainText(
          'Sign In',
        );
      });
    }
  }
});
