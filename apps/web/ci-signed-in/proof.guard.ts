import { expect, test } from '@playwright/test';
import { identity, seeded } from './people';
import { SESSION_COOKIE, signInAs } from './session';

/**
 * Proof that the signed-in guard really signs in (docs/operations/ci-signed-in-guard.md). Each test
 * checks the final address and seeded text, so a sign-in page, an error page or an empty frame can
 * never pass for a signed-in page.
 */
const base = (baseURL: string | undefined) => baseURL ?? 'http://localhost:3100';

test('the made-up traveller sees their own overview inside the workspace frame', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, 'traveller', base(baseURL));
  const response = await page.goto('/app');
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/app');
  await expect(page.locator('.app-frame')).toBeVisible();
  const firstName = identity('traveller').name.split(' ')[0] ?? '';
  await expect(page.getByRole('heading', { level: 1 })).toContainText(firstName);
});

test('the same overview without the session cookie goes to sign-in', async ({ page }) => {
  await page.goto('/app');
  expect(new URL(page.url()).pathname).toBe('/auth/sign-in');
  await expect(page.locator('.app-frame')).toHaveCount(0);
});

test('a session token the stand-in does not know goes to sign-in', async ({
  context,
  page,
  baseURL,
}) => {
  const url = new URL(base(baseURL));
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: 'ci.not-a-known-token',
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/app');
  expect(new URL(page.url()).pathname).toBe('/auth/sign-in');
});

test('the made-up agency admin sees their agency page', async ({ context, page, baseURL }) => {
  await signInAs(context, 'agencyAdmin', base(baseURL));
  const { organizationId, organizationName } = seeded();
  const response = await page.goto(`/app/agency/${organizationId}`);
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(`/app/agency/${organizationId}`);
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.getByText(organizationName).first()).toBeVisible();
});
