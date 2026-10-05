import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { createTranslator } from '@visastack/i18n';
import { PRIMARY_NAV, applicantTabs, localizeLinks } from '../src/lib/navigation';

/**
 * Bangla verification for the public (no-secret) surfaces and for the signed-in
 * building blocks (Commercial V1 Part 9 section 4 and section 14, A32). It checks
 * what a Bangla reader meets before they can sign in: the language the page
 * declares, the words in the header and footer, whether it fits a small phone,
 * the typography rules that stop Bangla text being cut or pulled apart, and that
 * the signed-in bar and tabs, set in Bangla, still fit and stay reachable.
 *
 * What it cannot do is read the signed-in pages themselves (no sign-in is possible
 * without WorkOS credentials). Those are checked by render tests that call each
 * page with simulated data in both languages.
 *
 * Glyph shapes depend on the fonts the machine has, so nothing here asserts how a
 * letter looks. Layout is asserted in CSS pixels against whatever font was used.
 */

const bn = createTranslator('bn');
const BENGALI = /[ঀ-৿]/;

async function readInBangla(page: Page, baseURL: string | undefined): Promise<void> {
  const url = new URL(baseURL ?? 'http://localhost:3000');
  await page.context().addCookies([
    {
      name: 'visastack_locale',
      value: 'bn',
      domain: url.hostname,
      path: '/',
      secure: url.protocol === 'https:',
    },
  ]);
}

const VIEWPORTS = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone', width: 360, height: 740 },
  { name: 'large phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
] as const;

test.describe('public pages in Bangla', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await readInBangla(page, baseURL);
  });

  test('declare Bangla and put the header, skip link and footer in Bangla', async ({ page }) => {
    await page.goto('/status');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.locator('.skip-link')).toHaveText(bn('shell.skipToContent'));
    const nav = page.getByRole('navigation', { name: bn('shell.nav.primary') });
    await expect(nav.getByRole('link', { name: bn('shell.nav.platform') })).toBeVisible();
    await expect(nav.getByRole('link', { name: bn('shell.nav.status') })).toBeVisible();
    await expect(nav.getByRole('link', { name: bn('nav.signIn') })).toBeVisible();
    await expect(page.locator('footer')).toContainText('VisaStack');
    await expect(page.locator('footer')).toContainText(bn('shell.footer.hosting'));
  });

  test('offer English by name, in English, and mark it as English for a screen reader', async ({
    page,
  }) => {
    await page.goto('/status');
    const toEnglish = page.getByRole('button', { name: 'English' });
    await expect(toEnglish).toBeVisible();
    await expect(toEnglish).toHaveAttribute('lang', 'en');
    await expect(page.locator('form[aria-label]').first()).toHaveAttribute(
      'aria-label',
      bn('shell.language'),
    );
  });

  test('switching back to English restores English and keeps it across navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/status');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.skip-link')).toHaveText('Skip to content');
  });

  test('the not-found page is in Bangla, with a way back', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(bn('shell.notFound.heading'));
    await expect(page.getByRole('link', { name: bn('shell.notFound.workspace') })).toBeVisible();
    await expect(page.getByRole('link', { name: bn('shell.error.home') })).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`the header does not scroll sideways at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/status');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      const signIn = page
        .getByRole('navigation', { name: bn('shell.nav.primary') })
        .getByRole('link', { name: bn('nav.signIn') });
      const box = await signIn.boundingBox();
      expect(box).not.toBeNull();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    });
  }

  for (const path of ['/', '/status']) {
    test(`${path} has no critical or serious accessibility violations in Bangla`, async ({
      page,
    }) => {
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

/**
 * The signed-in screens cannot be opened without a WorkOS identity, so, as in
 * `ux-public.spec.ts`, this puts the signed-in building blocks into the real page
 * (real stylesheet, real Bangla header) using the product's own class names and its
 * own Bangla messages from the catalog.
 */
function banglaFixtureHtml(): string {
  const bar = (links: readonly { href: string; label: string }[]) =>
    links
      .map(
        (link, i) =>
          `<a href="${link.href}"${i === 0 ? ' aria-current="page"' : ''}>${link.label}</a>`,
      )
      .join('');
  const primary = bar(localizeLinks(PRIMARY_NAV, bn));
  const tabs = bar(localizeLinks(applicantTabs('fixture'), bn));
  const hold = bn('privacy.deletion.hold')
    .replace('<b>{name}</b>', '<strong>মোহাম্মদ আব্দুর রহমান চৌধুরী</strong>')
    .replace('{reason}', 'আদালতের আদেশ ১৪/২০২৬')
    .replace('{scope}', bn('privacy.deletion.scope.profile'))
    .replace('{placed}', '৫ অক্টো, ২০২৬')
    .replace('{review}', bn('privacy.deletion.review.none'))
    .replace('{accessible}', 'এজেন্সি আলফা, এজেন্সি বিটা');
  return `
<div id="fixture">
  <div class="app-shell-nav">
    <nav class="app-shell-links" aria-label="${bn('shell.nav.primary')}">${primary}</nav>
    <div class="app-shell-switch">
      <a href="/app/agency" class="btn btn-secondary nav-cta">${bn('shell.app.agency')}</a>
      <a href="/app/admin" class="btn btn-secondary nav-cta">${bn('shell.app.admin')}</a>
      <form action="#"><button type="submit" class="btn btn-secondary nav-cta">${bn('shell.app.signOut')}</button></form>
    </div>
  </div>
  <section class="section container" id="fixture-section">
    <div class="toolbar" style="margin-bottom:1.5rem">
      <div>
        <span class="eyebrow">${bn('shell.applicant.eyebrow')}</span>
        <h1 class="section-title" style="margin:.25rem 0 0">মোহাম্মদ আব্দুর রহমান চৌধুরী</h1>
        <p class="muted" style="margin:.35rem 0 0">${bn('applicant.relationship.familyMember')}</p>
      </div>
    </div>
    <nav class="subnav" aria-label="${bn('shell.applicant.navLabel')}">${tabs}</nav>
    <p class="notice" lang="bn" style="margin-bottom:1.5rem">${bn('shell.translationNotice')}</p>
    <div class="grid">
      <article class="card">
        <p class="card-kicker">${bn('privacy.erase.kicker')}</p>
        <h2 class="card-title">${bn('privacy.erase.title')}</h2>
        <p class="card-body">${bn('privacy.erase.body')}</p>
        <div class="notice notice-warn" style="margin-top:1rem">${hold}</div>
        <div class="rows" style="margin-top:1rem">
          <div class="row"><span class="row-key">${bn('account.glance.invitations')}</span><span class="badge badge-warning">${bn('account.glance.pending', { count: 3 })}</span></div>
          <div class="row"><span class="row-key">${bn('privacy.consent.issuerContact')}</span><span class="badge badge-success">${bn('privacy.history.granted')}</span></div>
        </div>
      </article>
      <article class="card">
        <p class="card-kicker">${bn('consent.overview.kicker')}</p>
        <h2 class="card-title">${bn('consent.overview.title')}</h2>
        <p class="card-body">${bn('consent.overview.body')}</p>
        <div class="rows">
          <div class="row"><span class="row-key">${bn('consent.core.title')}</span><button class="btn btn-secondary nav-cta" type="button">${bn('consent.action.revoke')}</button></div>
          <div class="row"><span class="row-key">${bn('consent.issuerContact.title')}</span><button class="btn btn-primary nav-cta" type="button">${bn('consent.action.grant')}</button></div>
        </div>
        <div style="margin-top:1rem">
          <label class="field-label" for="fixture-name">${bn('account.add.name')}</label>
          <input id="fixture-name" class="input" style="width:100%;margin-top:.35rem" value="রহিম উদ্দিন">
        </div>
        <div style="margin-top:1rem">
          <label class="field-label" for="fixture-reason" style="display:block;margin-bottom:.4rem">${bn('privacy.deletion.reason')}</label>
          <input id="fixture-reason" class="input" type="text" placeholder="${bn('privacy.deletion.reasonPlaceholder')}">
        </div>
        <label class="check" style="margin-top:1rem"><input type="checkbox"> ${bn('consent.authority.confirm')}</label>
        <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap"><button class="btn btn-primary" type="button">${bn('account.add.submit')}</button><button class="btn btn-danger" type="button">${bn('privacy.deletion.request')}</button></div>
      </article>
    </div>
    <div style="height:2000px" aria-hidden="true"></div>
  </section>
</div>`;
}

async function openBanglaFixture(page: Page, baseURL: string | undefined): Promise<void> {
  await readInBangla(page, baseURL);
  // Scripts are blocked so React cannot hydrate the landing page afterwards and replace the fixture.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.evaluate((html) => {
    const main = document.querySelector('main');
    if (!main) throw new Error('the page has no <main>');
    main.innerHTML = html;
  }, banglaFixtureHtml());
}

test.describe('signed-in building blocks in Bangla on a narrow screen (real stylesheet)', () => {
  // The fixture uses inline style attributes the way the pages do; the site policy correctly
  // refuses those when they arrive as markup, so it is off for these layout checks only.
  test.use({ bypassCSP: true });

  for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.name} (${viewport.width}px)`, () => {
      test.beforeEach(async ({ page, baseURL }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openBanglaFixture(page, baseURL);
      });

      test('the page is Bangla and does not scroll sideways', async ({ page }) => {
        await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      });

      test('no card, notice, row or button is wider than the screen', async ({ page }) => {
        const wide = await page.evaluate((width) => {
          const out: string[] = [];
          for (const el of document.querySelectorAll(
            '#fixture .card, #fixture .notice, #fixture .row, #fixture .btn, #fixture .badge',
          )) {
            const box = el.getBoundingClientRect();
            if (box.right > width + 1 || box.left < -1) {
              out.push(`${el.className} ${Math.round(box.left)}..${Math.round(box.right)}`);
            }
          }
          return out;
        }, viewport.width);
        expect(wide).toEqual([]);
      });

      test('every navigation link and switch button is on screen, none clipped', async ({
        page,
      }) => {
        const labels = [
          ...localizeLinks(PRIMARY_NAV, bn).map((l) => l.label),
          bn('shell.app.agency'),
          bn('shell.app.admin'),
          bn('shell.app.signOut'),
        ];
        for (const label of labels) {
          const target = page
            .locator('.app-shell-nav')
            .getByRole(label === bn('shell.app.signOut') ? 'button' : 'link', {
              name: label,
              exact: true,
            });
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

      test('every applicant tab can be scrolled into view', async ({ page }) => {
        const links = page.locator('#fixture nav.subnav a');
        expect(await links.count()).toBe(8);
        for (let i = 0; i < (await links.count()); i++) {
          const link = links.nth(i);
          await link.scrollIntoViewIfNeeded();
          const box = await link.boundingBox();
          expect(box, `tab ${i}`).not.toBeNull();
          if (box) {
            expect(box.x, `tab ${i} left edge`).toBeGreaterThanOrEqual(-1);
            expect(box.x + box.width, `tab ${i} right edge`).toBeLessThanOrEqual(
              viewport.width + 1,
            );
          }
        }
      });

      test('no placeholder is cut off by the width of its own field', async ({ page }) => {
        // A placeholder does not wrap: if Bangla needs more room than the field has, the end of it
        // is hidden. Measure each placeholder in the field's own font against the room inside it.
        const cutOff = await page.evaluate(() => {
          const out: string[] = [];
          const canvas = document.createElement('canvas').getContext('2d');
          if (!canvas) throw new Error('no canvas');
          for (const el of document.querySelectorAll<HTMLInputElement>(
            '#fixture input[placeholder]',
          )) {
            const style = getComputedStyle(el);
            canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const needed = canvas.measureText(el.placeholder).width;
            const room =
              el.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight);
            if (needed > room)
              out.push(
                `"${el.placeholder}" needs ${Math.round(needed)}px, room ${Math.round(room)}px`,
              );
          }
          return out;
        });
        expect(cutOff).toEqual([]);
      });

      test('every control is at least 24 by 24 CSS pixels (WCAG 2.2 target size)', async ({
        page,
      }) => {
        const tooSmall = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll('a[href], button, input, select, textarea')) {
            if (el.closest('.skip-link')) continue;
            const box = el.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
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

test.describe('Bangla typography (real stylesheet)', () => {
  test.use({ bypassCSP: true });

  test('Bangla text is not tracked and has room for the marks above and below the line', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBanglaFixture(page, baseURL);
    const measured = await page.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`missing ${selector}`);
        return getComputedStyle(el);
      };
      const ratio = (selector: string) => {
        const s = style(selector);
        return Number.parseFloat(s.lineHeight) / Number.parseFloat(s.fontSize);
      };
      return {
        headingSpacing: style('#fixture h1').letterSpacing,
        titleSpacing: style('#fixture .card-title').letterSpacing,
        eyebrowSpacing: style('#fixture .eyebrow').letterSpacing,
        bodySpacing: style('body').letterSpacing,
        kickerCase: style('#fixture .card-kicker').textTransform,
        headingLine: ratio('#fixture h1'),
        bodyLine: ratio('body'),
        noticeLine: ratio('#fixture .notice'),
        buttonLine: ratio('#fixture .btn'),
        family: style('body').fontFamily,
      };
    });
    expect(measured.headingSpacing).toBe('normal');
    expect(measured.titleSpacing).toBe('normal');
    expect(measured.eyebrowSpacing).toBe('normal');
    expect(measured.bodySpacing).toBe('normal');
    expect(measured.kickerCase).toBe('none');
    expect(measured.headingLine).toBeGreaterThanOrEqual(1.35);
    expect(measured.bodyLine).toBeGreaterThanOrEqual(1.7);
    expect(measured.noticeLine).toBeGreaterThanOrEqual(1.55);
    expect(measured.buttonLine).toBeGreaterThanOrEqual(1.55);
    expect(measured.family).toContain('Bengali');
  });

  test('English keeps its own tighter typography, so Bangla rules never leak into it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const measured = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const title = document.querySelector('.hero-title');
      if (!title) throw new Error('no hero title');
      return {
        lang: document.documentElement.lang,
        bodySpacing: Number.parseFloat(body.letterSpacing),
        titleSpacing: Number.parseFloat(getComputedStyle(title).letterSpacing),
        bodyLine: Number.parseFloat(body.lineHeight) / Number.parseFloat(body.fontSize),
      };
    });
    expect(measured.lang).toBe('en');
    expect(measured.bodySpacing).toBeLessThan(0);
    expect(measured.titleSpacing).toBeLessThan(0);
    expect(measured.bodyLine).toBeLessThan(1.6);
  });

  test('the Bangla messages really are Bengali script', async ({ page, baseURL }) => {
    await openBanglaFixture(page, baseURL);
    const text = await page.locator('#fixture').innerText();
    expect(BENGALI.test(text)).toBe(true);
  });
});

test.describe('colour contrast of the Bangla building blocks (axe, both colour schemes)', () => {
  test.use({ bypassCSP: true });
  for (const scheme of ['light', 'dark'] as const) {
    test(`no critical or serious violations in ${scheme} mode`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await openBanglaFixture(page, baseURL);
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
