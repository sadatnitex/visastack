import { type BrowserContext, type Cookie, type Page, expect } from '@playwright/test';
import { type Role, blocked, credentials, optional } from './setup';
import { totp } from './totp';

/**
 * Signs in the way a person does: the real sign-in form with the synthetic account's email and
 * password. There is no shortcut and no minted cookie; if the form cannot be used, the journey is
 * BLOCKED, not bypassed. Cookies the real form set are kept in memory for the rest of this worker
 * (never written to disk, never printed) so a read-only check does not use up an account's hourly
 * sign-in allowance.
 *
 * The labels are those of the sign-in page at the time of writing (also used by
 * neon-staging-routes.spec.ts, which is the only suite that has run against a deployed target);
 * they have not been run against the staging deployment this suite will use.
 */

const kept = new Map<Role, Cookie[]>();

/** A second step, if the sign-in page shows one. The product has none for ordinary accounts yet. */
const SECOND_STEP = /verification code|authenticator code|one-time code|security code/i;

/**
 * After "Sign In", the page either reaches the workspace or asks for a code. Wait for whichever
 * comes first before deciding, so a missing code secret is reported as BLOCKED naming it, not as
 * a puzzling address mismatch a moment later.
 */
async function passSecondStep(page: Page, role: Role): Promise<void> {
  const field = page.getByLabel(SECOND_STEP).first();
  const arrived = page.waitForURL(/\/app(?:\/|$)/, { timeout: 30_000 }).then(() => 'app' as const);
  const asked = field.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'code' as const);
  const outcome = await Promise.any([arrived, asked]).catch(() => 'neither' as const);
  if (outcome !== 'code') return;
  const secret = optional(`NEON_STAGING_${role}_TOTP_SECRET`);
  if (!secret) {
    blocked(
      `sign-in as ${role} asks for a second step, and NEON_STAGING_${role}_TOTP_SECRET is not set`,
    );
  }
  await field.fill(totp(secret));
  await page.getByRole('button', { name: /^(Verify|Continue|Sign In)$/i }).click();
}

export async function signIn(page: Page, role: Role): Promise<void> {
  const existing = kept.get(role);
  if (existing) {
    await page.context().addCookies(existing);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app(?:\/|$)/);
    return;
  }
  const { email, password } = credentials(role);
  await page.goto('/auth/sign-in');
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.getByLabel('Email Address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await passSecondStep(page, role);
  await expect(page, `sign-in as ${role} should reach the workspace`).toHaveURL(/\/app(?:\/|$)/, {
    timeout: 30_000,
  });
  kept.set(role, await page.context().cookies());
}

/** A fresh browser window signed in as `role`. Close the returned context when the test is done. */
export async function signedInContext(
  browser: import('@playwright/test').Browser,
  role: Role,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signIn(page, role);
  return { context, page };
}

/** Forgets the kept cookies for a role, for a test that signs that account out on purpose. */
export function forget(role: Role): void {
  kept.delete(role);
}
