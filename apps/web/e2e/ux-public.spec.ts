import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
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
          const texts = [...document.querySelectorAll('.c1-phone .c1-phonename, .c1-phone .c1-phonepanel')];
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
    await expect(page.locator('.c1-cta .c1-pill').first()).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.c1-hero .c1-nudge')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.c1-hero .c1-nudge')).toHaveText(/public beta|pilot/i);
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
  const platformBar = bar(platformTabs({ ai: true, complaints: true }));
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
      <nav class="app-shell-links app-shell-links-more" aria-label="Account and privacy">${secondary}</nav>
      <div class="app-shell-switch">
        <p class="app-shell-switch-label">Switch area</p>
        <a href="/app/agency" class="btn btn-secondary nav-cta">Agency</a>
        <a href="/app/admin" class="btn btn-secondary nav-cta">Admin</a>
        <form action="#"><button type="submit" class="btn btn-secondary nav-cta">Sign out</button></form>
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
        const labels = [...PRIMARY_NAV.map((l) => l.label), 'Agency', 'Admin', 'Sign out'];
        // The last few links and the switch controls sit under "More" on a narrow screen.
        await page.getByRole('button', { name: 'More' }).click();
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
      const unavailable = page.getByText('Route information is not available right now');
      if (await unavailable.count()) {
        await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
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
    await page.getByLabel('Choose a document').selectOption('synthetic-pending');
    await expect(page.getByRole('button', { name: 'Open secure preview' })).toHaveCount(0);
    await expect(page.locator('main iframe, main object, main embed')).toHaveCount(0);
    await page.getByLabel('Choose a document').selectOption('synthetic-clean');
    await page.getByRole('button', { name: 'Open secure preview' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__uiFixtureActions))
      .toEqual(['synthetic-clean']);
  });
  test('document search uses the authorized metadata and keeps empty results safe', async ({
    page,
  }) => {
    await openUiFixture(page, 'documents');
    const search = page.getByRole('searchbox', { name: 'Find a document' });
    await search.fill('no-such-document');
    await expect(
      page.getByText('No documents match. Try another name or clear your search.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open secure preview' })).toHaveCount(0);
    await search.clear();
    await expect(page.getByLabel('Choose a document').locator('option')).toHaveCount(2);
    await search.fill('letter');
    await expect(page.getByLabel('Choose a document').locator('option')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open secure preview' })).toHaveCount(0);
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
          await expect(page.getByRole('button', { name: 'Check now', exact: true })).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Check now', exact: true }),
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
              darkPage.getByRole('button', { name: 'Check now', exact: true }),
            ).toBeVisible();
            await expect(
              darkPage.getByRole('button', { name: 'Check now', exact: true }),
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
        .getByRole('link', { name: 'Features', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.getByRole('link', { name: 'How it works', exact: true }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#land-how-title')).toBeInViewport();
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
    await expect(page.locator('.trust-hero .eyebrow')).toHaveCSS('font-size', '10px');
    const trustTitle = await page.locator('#trust-story-title').boundingBox();
    const banner = await page.locator('.pilot-banner').boundingBox();
    expect(trustTitle?.x).toBe(116);
    expect(trustTitle?.y).toBeCloseTo(206 + (banner?.height ?? 0), 0);
    await page.goto('/auth/sign-up');
    expect((await page.locator('.auth-introduction').boundingBox())?.width).toBe(740);
    expect((await page.locator('.auth-form-panel').boundingBox())?.width).toBe(480);
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
    ] as const) {
      test(`${mode} keeps identical pixels under both device appearances at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 1600 ? 1000 : 844 });
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
        await openUiFixture(page, mode);
        await page.evaluate(() => document.fonts.ready);
        const light = await page.screenshot({
          path: test.info().outputPath('appearance-light.png'),
          animations: 'disabled',
          caret: 'hide',
        });
        await page.emulateMedia({ colorScheme: 'dark' });
        // Compare fresh renders, matching the desktop and phone capture protocol.
        // Chromium can otherwise repaint fractional native-input edges during a media toggle.
        await openUiFixture(page, mode);
        await page.evaluate(() => document.fonts.ready);
        const dark = await page.screenshot({
          path: test.info().outputPath('appearance-dark.png'),
          animations: 'disabled',
          caret: 'hide',
        });
        await expect(page.locator('.app-main')).toHaveCSS('background-color', 'rgb(250, 250, 247)');
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
        expect(
          dark.equals(light),
          'changing the device preference changes no workspace surface',
        ).toBe(true);
      });
    }
  }
  test('page finder points to existing destinations and hides administration for ordinary users', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openUiFixture(page, 'overview');
    await page.keyboard.press('Control+k');
    const finder = page.getByRole('searchbox', { name: 'Find a page' });
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
    await page.getByRole('searchbox', { name: 'Find a page' }).fill('administration');
    await expect(
      page
        .getByRole('navigation', { name: 'Matching pages' })
        .getByRole('link', { name: 'Platform administration' }),
    ).toHaveAttribute('href', '/app/admin');
  });
});

test('password recovery confirms the request and offers an explicit resend without exposing accounts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/auth/forgot-password?sent=1');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('If an account uses that address', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeHidden();
  await page.getByText('Did not get a link? Send another', { exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send another link' })).toBeVisible();
  await page.getByRole('link', { name: 'Use a different email address' }).click();
  await expect(page.getByRole('button', { name: 'Send me a link' })).toBeVisible();
  await page.goto('/auth/forgot-password?e=unavailable');
  await expect(
    page.getByText('We could not request a link right now.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send me a link' })).toBeVisible();
});
