import AxeBuilder from '@axe-core/playwright';
import { type APIResponse, type Page, expect, test } from '@playwright/test';

/**
 * UMPE P14: the signed-out Document Collection Desk an agency's request link opens (ADR 0026 D4,
 * D5). Whatever the link, the visitor learns nothing: no person, route, checklist or whether an
 * account exists, the same answer for an unknown, malformed, forwarded or missing token, and the
 * token never stays in the address. The desk is behind the AGENCY_COLLECTION_REQUESTS switch, so
 * each check first reads which state this deployment is in (on: the neutral "This Link Is Not
 * Open" page, because no made-up token can name a live link; off: the site's not-found page) and
 * then holds that state to the same strict answer. These checks use no database and no real link:
 * a real guest's code step needs an issued request and is covered below the browser
 * (apps/web/src/app/collect/collect.test.tsx, packages/services/src/umpe-journeys/j5-*).
 */

const TOKENS = {
  unknown: 'p14-unknown-token-0000000000000000000000000000',
  malformed: '%00%3Cscript%3E',
  forwarded: 'p14-forwarded-token-1111111111111111111111111111',
} as const;

/** Words that would mean the neutral page leaked something about the request or a person. */
const LEAK_WORDS = [
  /checklist/i,
  /passport/i,
  /bank statement/i,
  /destination/i,
  /purpose/i,
  /due by/i,
  /hello,/i,
  /your account/i,
  /signed in as/i,
  /@/,
];

async function switchState(request: import('@playwright/test').APIRequestContext) {
  const probe = await request.get(`/collect/open?token=${TOKENS.unknown}`, { maxRedirects: 0 });
  return probe.status() === 404 ? ('off' as const) : ('on' as const);
}

function expectNoToken(value: string | null | undefined): void {
  for (const token of Object.values(TOKENS)) expect(value ?? '').not.toContain(token);
}

async function expectNeutralBody(page: Page): Promise<void> {
  const text = await page.locator('main, body').first().innerText();
  for (const word of LEAK_WORDS) expect(text, `neutral page shows ${word}`).not.toMatch(word);
}

async function noSeriousAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

function openAnswer(response: APIResponse) {
  const headers = response.headers();
  return {
    status: response.status(),
    location: headers['location'] ?? null,
    cacheControl: headers['cache-control'] ?? null,
  };
}

test.describe('UMPE collection desk, signed out (P14)', () => {
  test('every made-up, malformed, forwarded or missing token gets the same answer and never stays in the address', async ({
    request,
  }) => {
    const state = await switchState(request);
    const answers = await Promise.all(
      [...Object.values(TOKENS).map((t) => `/collect/open?token=${t}`), '/collect/open'].map(
        async (path) => openAnswer(await request.get(path, { maxRedirects: 0 })),
      ),
    );
    const first = answers[0];
    for (const answer of answers) {
      expect(answer).toEqual(first);
      expectNoToken(answer.location);
    }
    if (state === 'on') {
      expect(first?.status).toBe(303);
      expect(first?.location).toMatch(/\/collect$/);
      expect(first?.cacheControl).toContain('no-store');
    } else {
      expect(first?.status).toBe(404);
    }
  });

  test('a closed link on this device clears the desk cookie instead of keeping an older session', async ({
    request,
  }) => {
    test.skip((await switchState(request)) === 'off', 'The desk is switched off here: 404 only.');
    const response = await request.get(`/collect/open?token=${TOKENS.forwarded}`, {
      maxRedirects: 0,
      headers: { cookie: 'vs_collect=p14-stale-session-id' },
    });
    const cleared = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .find((v) => v.startsWith('vs_collect='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/Path=\/collect/i);
  });

  for (const width of [390, 768, 1280]) {
    test(`the page a forwarded link lands on is neutral, unindexed and fits ${width}px`, async ({
      page,
      request,
    }) => {
      const state = await switchState(request);
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(`/collect/open?token=${TOKENS.forwarded}`);
      expectNoToken(page.url());
      if (state === 'on') {
        expect(new URL(page.url()).pathname).toBe('/collect');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('This Link Is Not Open');
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
          'content',
          'no-referrer',
        );
      } else {
        expect(response?.status()).toBe(404);
      }
      await expectNeutralBody(page);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
      await noSeriousAxe(page);
    });
  }

  test('the signed-out account answer path names no one and looks like any closed link', async ({
    page,
    request,
  }) => {
    const state = await switchState(request);
    const response = await page.goto('/collect/account');
    if (state === 'on') {
      // Without a desk session there is no link to answer; it must not ask for sign-in first,
      // which would tell a stranger that the link is real.
      expect(new URL(page.url()).pathname).toBe('/collect/account');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('This Link Is Not Open');
    } else {
      expect(response?.status()).toBe(404);
    }
    await expectNeutralBody(page);
  });
});
