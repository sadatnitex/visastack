import { type Page, expect, test } from '@playwright/test';

/**
 * Browser-security verification for public (no-secret) surfaces (Commercial V1
 * SEC-02; directive Part 9 section 6 and Part 10 section 6, "browser
 * security/CSP"). Runs against the deployed preview in ordinary CI, or against
 * any URL via PLAYWRIGHT_BASE_URL.
 *
 * Header checks prove the policy is served. The browser checks prove it is
 * enforced and that the app still works under it: the page hydrates, a Server
 * Action runs, and each class of injected content is refused. Signed-in pages
 * share the root layout, the Next runtime and the same header, but are only
 * covered by the authenticated journey (gated behind WorkOS staging
 * credentials, like the rest of that file).
 */

const PAGES = ['/', '/status', '/trust', '/this-route-does-not-exist'] as const;

interface Violation {
  readonly directive: string;
  readonly blocked: string;
  /** `enforce` when the browser blocked the thing, `report` when it only told us. */
  readonly disposition: string;
}

declare global {
  interface Window {
    __cspViolations?: Violation[];
    __injected?: boolean;
    __clicked?: boolean;
    __viaUrl?: boolean;
    __withNonce?: boolean;
    __spa?: boolean;
    __evalResult?: string;
    __functionResult?: string;
    __next_f?: unknown;
  }
}

/** Splits a policy into `{ directive: [sources] }`. */
function directives(policy: string): Record<string, string[]> {
  const parsed: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) parsed[name] = sources;
  }
  return parsed;
}

function nonceOf(policy: string): string | undefined {
  return policy.match(/'nonce-([^']+)'/)?.[1];
}

async function trackViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        disposition: event.disposition,
      });
    });
  });
}

/**
 * Violations seen so far. The Vercel preview toolbar is injected by Vercel
 * itself and is not part of this app, so its own blocked requests are not
 * counted.
 */
async function violations(page: Page): Promise<Violation[]> {
  const seen = await page.evaluate(() => window.__cspViolations ?? []);
  return seen.filter(
    (v) => !v.blocked.includes('vercel.live') && !v.blocked.includes('pusher.com'),
  );
}

/** Directives the browser actually enforced, as opposed to merely reported. */
async function enforcedDirectives(page: Page): Promise<string[]> {
  return (await violations(page))
    .filter((v) => v.disposition === 'enforce')
    .map((v) => v.directive);
}

/**
 * React stamps its bookkeeping on every DOM node it manages once it has hydrated
 * it, so this is true only after the app's own scripts have run to completion.
 * Waiting for network idle is avoided on purpose: Playwright never counts a
 * request as finished when the policy blocks the redirect it was answered with,
 * so a page with one would appear never to settle.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const link = document.querySelector('a[href="/status"]');
    return link !== null && Object.keys(link).some((key) => key.startsWith('__reactProps'));
  });
}

test.describe('response headers on public pages', () => {
  for (const path of PAGES) {
    test(`${path} carries an enforced, nonce-based Content-Security-Policy`, async ({
      request,
    }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();

      expect(headers['content-security-policy-report-only']).toBeUndefined();
      const policy = headers['content-security-policy'];
      expect(policy, 'Content-Security-Policy header').toBeDefined();
      const parsed = directives(policy as string);

      const script = parsed['script-src'] ?? [];
      expect(script.some((s) => /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/.test(s))).toBe(true);
      expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain('*');
      expect(parsed['default-src']).toEqual(["'self'"]);
      expect(parsed['object-src']).toEqual(["'none'"]);
      expect(parsed['base-uri']).toEqual(["'self'"]);
      expect(parsed['frame-ancestors']).toEqual(["'none'"]);
      expect(parsed['report-uri']).toEqual(['/api/csp-report']);
    });

    test(`${path} carries the standing security headers`, async ({ request }) => {
      const headers = (await request.get(path, { maxRedirects: 0 })).headers();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['strict-transport-security']).toContain('max-age=63072000');
      expect(headers['strict-transport-security']).toContain('includeSubDomains');
      expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    });
  }

  test('the nonce is new on every request', async ({ request }) => {
    const a = (await request.get('/status')).headers()['content-security-policy'] ?? '';
    const b = (await request.get('/status')).headers()['content-security-policy'] ?? '';
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  for (const path of ['/', '/status']) {
    test(`every inline script on ${path} carries the nonce from its own header`, async ({
      request,
    }) => {
      const response = await request.get(path);
      const nonce = nonceOf(response.headers()['content-security-policy'] ?? '');
      expect(nonce).toBeTruthy();
      const html = await response.text();
      const inline = [...html.matchAll(/<script\b([^>]*)>/g)]
        .map((m) => m[1] ?? '')
        .filter((attributes) => !/\bsrc=/.test(attributes));
      expect(inline.length).toBeGreaterThan(0);
      for (const attributes of inline) expect(attributes).toContain(`nonce="${nonce}"`);
    });
  }
});

test.describe('the app under the policy', () => {
  for (const path of ['/', '/status', '/this-route-does-not-exist']) {
    test(`${path} loads and hydrates with no policy violation`, async ({ page }) => {
      await trackViolations(page);
      await page.goto(path);
      await waitForHydration(page);
      // Set by a nonced inline script, so it only exists if that script ran.
      expect(await page.evaluate(() => typeof window.__next_f)).toBe('object');
      expect(await violations(page)).toEqual([]);
    });
  }

  test('switching language, a Server Action, raises no violation', async ({ page }) => {
    await trackViolations(page);
    await page.goto('/');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    expect(await violations(page)).toEqual([]);
  });

  test('client-side navigation works, with no full page load and no violation', async ({
    page,
  }) => {
    await trackViolations(page);
    await page.goto('/');
    await waitForHydration(page);
    // A full page load would discard this; the router's own navigation keeps it.
    await page.evaluate(() => {
      window.__spa = true;
    });
    await page
      .getByRole('navigation', { name: 'Footer' })
      .getByRole('link', { name: 'Status' })
      .click();
    await expect(page).toHaveURL(/\/status$/);
    expect(await page.evaluate(() => window.__spa)).toBe(true);
    expect(await violations(page)).toEqual([]);
  });
});

test.describe('the policy is enforced in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await trackViolations(page);
    await page.goto('/status');
    await waitForHydration(page);
  });

  test('control: a script carrying the page nonce does run', async ({ page }) => {
    const ran = await page.evaluate(() => {
      const nonce = (document.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce;
      if (!nonce) return 'no-nonce';
      const script = document.createElement('script');
      script.nonce = nonce;
      script.textContent = 'window.__withNonce = true';
      document.body.append(script);
      return window.__withNonce === true ? 'ran' : 'did-not-run';
    });
    expect(ran).toBe('ran');
    expect(await violations(page)).toEqual([]);
  });

  test('markup injected into the page cannot run script', async ({ page }) => {
    // The realistic attack is injected HTML, which the parser inserts: an inline
    // script and an inline event handler, neither carrying the page's nonce.
    // (A script a trusted script creates through the DOM is trusted by
    // 'strict-dynamic' by design, so that is not what is being tested here.)
    const outcome = await page.evaluate(async () => {
      const seen: string[] = [];
      document.open();
      // The image error is asynchronous; completion requires both actual
      // security events rather than assuming the request failed within 500 ms.
      const blocked = new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error('Both injected-script protections were not observed')),
          10_000,
        );
        document.addEventListener('securitypolicyviolation', (event) => {
          seen.push(event.effectiveDirective);
          if (seen.includes('script-src-elem') && seen.includes('script-src-attr')) {
            clearTimeout(deadline);
            resolve();
          }
        });
      });
      document.write(
        '<script>window.__injected = true</script><img src="/x" onerror="window.__clicked = true">',
      );
      document.close();
      await blocked;
      return { seen, injected: window.__injected, handled: window.__clicked };
    });
    expect(outcome.injected).toBeUndefined();
    expect(outcome.handled).toBeUndefined();
    expect(outcome.seen).toContain('script-src-elem');
    expect(outcome.seen).toContain('script-src-attr');
  });

  test('an inline event handler does not run', async ({ page }) => {
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.setAttribute('onclick', 'window.__clicked = true');
      document.body.append(button);
      button.click();
    });
    expect(await page.evaluate(() => window.__clicked)).toBeUndefined();
    expect(await enforcedDirectives(page)).toContain('script-src-attr');
  });

  test('a javascript: URL does not run', async ({ page }) => {
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = 'javascript:window.__viaUrl = true';
      document.body.append(link);
      link.click();
    });
    expect(await page.evaluate(() => window.__viaUrl)).toBeUndefined();
    expect((await enforcedDirectives(page)).length).toBeGreaterThan(0);
  });

  test('eval and new Function are refused to a page script', async ({ page }) => {
    // The attempt is made from a script the policy admits (it carries the nonce)
    // and runs on a timer. Code run synchronously inside the test driver's own
    // call is exempt from the page's eval rule, so it would prove nothing.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.nonce =
        (document.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce ?? '';
      script.textContent = `setTimeout(() => {
        try { eval('1 + 1'); window.__evalResult = 'ran'; } catch (e) { window.__evalResult = 'blocked'; }
        try { new Function('return 1')(); window.__functionResult = 'ran'; } catch (e) { window.__functionResult = 'blocked'; }
      }, 0)`;
      document.body.append(script);
    });
    await page.waitForFunction(() => window.__functionResult !== undefined);
    expect(await page.evaluate(() => window.__evalResult)).toBe('blocked');
    expect(await page.evaluate(() => window.__functionResult)).toBe('blocked');
    expect(await enforcedDirectives(page)).toContain('script-src');
  });

  test('a request to a third-party origin is refused', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://third-party.invalid/collect', { mode: 'no-cors' });
        return 'sent';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
    expect(await enforcedDirectives(page)).toContain('connect-src');
  });

  test('a third-party image is refused', async ({ page }) => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = 'https://third-party.invalid/pixel.png';
        }),
    );
    expect(await enforcedDirectives(page)).toContain('img-src');
  });

  test('a form cannot be sent to a third party', async ({ page }) => {
    const before = page.url();
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.method = 'post';
      form.action = 'https://third-party.invalid/collect';
      document.body.append(form);
      form.submit();
    });
    await expect.poll(() => enforcedDirectives(page)).toContain('form-action');
    expect(page.url()).toBe(before);
  });

  test('a <base> tag cannot redirect relative URLs', async ({ page }) => {
    const before = await page.evaluate(() => document.baseURI);
    await page.evaluate(() => {
      const base = document.createElement('base');
      base.href = 'https://third-party.invalid/';
      document.head.append(base);
    });
    expect(await page.evaluate(() => document.baseURI)).toBe(before);
    expect(await enforcedDirectives(page)).toContain('base-uri');
  });
});

test.describe('violation report endpoint', () => {
  const report = JSON.stringify({
    'csp-report': {
      'document-uri': 'https://example.test/app?token=redacted',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://third-party.invalid/x.js',
      disposition: 'enforce',
    },
  });

  test('accepts a report with 204, never cached', async ({ request }) => {
    const response = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: report,
    });
    expect(response.status()).toBe(204);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('refuses other content types and methods', async ({ request }) => {
    const wrongType = await request.post('/api/csp-report', {
      headers: { 'content-type': 'text/plain' },
      data: report,
    });
    expect(wrongType.status()).toBe(415);
    const wrongMethod = await request.get('/api/csp-report');
    expect(wrongMethod.status()).toBe(405);
  });
});

test.describe('brand assets from the VisaStack brand pack', () => {
  test('the page links its icons, manifest and share image, and each is served same-site', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const head = await page.evaluate(() => ({
      icons: [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map(
        (link) => new URL((link as HTMLLinkElement).href).pathname,
      ),
      manifest: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? '',
      shareImage:
        document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? '',
    }));
    expect(head.icons.some((path) => path.startsWith('/icon.svg'))).toBe(true);
    expect(head.icons.some((path) => path.startsWith('/apple-icon.png'))).toBe(true);
    expect(new URL(head.manifest).pathname).toBe('/manifest.webmanifest');
    expect(new URL(head.shareImage).pathname).toMatch(/^\/opengraph-image\.png/);
    const assets: ReadonlyArray<readonly [string, string]> = [
      ['/icon.svg', 'image/svg+xml'],
      ['/favicon.ico', 'image/x-icon'],
      ['/apple-icon.png', 'image/png'],
      ['/opengraph-image.png', 'image/png'],
      ['/icons/icon-192.png', 'image/png'],
      ['/icons/icon-maskable-512.png', 'image/png'],
      ['/brand/visastack-v-tile.svg', 'image/svg+xml'],
      ['/brand/visastack-v-tile-reversed.svg', 'image/svg+xml'],
    ];
    for (const [path, type] of assets) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toContain(type);
    }
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'VisaStack', theme_color: '#1D4C98' });
  });

  test('the header shows the brand V, loaded under the content security policy', async ({
    page,
  }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text()))
        refused.push(message.text());
    });
    const tile = page.waitForResponse((response) =>
      response.url().endsWith('/brand/visastack-v-tile.svg'),
    );
    await page.goto('/');
    expect((await tile).status()).toBe(200);
    await expect(page.locator('header.nav .brand-mark')).toHaveCSS(
      'background-image',
      /\/brand\/visastack-v-tile\.svg/,
    );
    expect(refused).toEqual([]);
  });
});
