import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Authenticated workspace journey (master directive §8B/§8C).
 *
 * Requires a real WorkOS **staging** test identity — this spec is the shared
 * source of truth for both:
 *   - an optional local/manual run (set the env vars yourself), and
 *   - the `workos-staging-e2e.yml` GitHub Actions workflow, which supplies
 *     them from repository secrets and is SKIPPED entirely when absent.
 *
 * Required env vars (documented here; no values are ever committed):
 *   WORKOS_STAGING_TEST_EMAIL    — a synthetic WorkOS-staging test user email
 *   WORKOS_STAGING_TEST_PASSWORD — that user's password
 *
 * Synthetic identity only. Never production credentials. Never logs
 * credentials or session tokens (Playwright's default HTML report can capture
 * request headers — traces are attached only on failure, per playwright.config).
 *
 * KNOWN LIMITATION (documented per the truthful-status requirement): the exact
 * selectors on WorkOS's hosted AuthKit sign-in page have not been verified live
 * against WorkOS staging in this session (no credentials were available to run
 * it). Role/label-based locators are used deliberately (the most resilient
 * Playwright pattern to hosted-UI markup changes), but this spec should be
 * treated as "implemented, not yet verified" until it is actually run once
 * against real WorkOS staging credentials.
 *
 * ---
 *
 * PR-E2 (post-programme defect register, "Exact-SHA CI and deployed E2E
 * verification"): this file previously covered a small slice of the
 * Applicant journey the master directive (`docs/roadmap/commercial-recovery-
 * completion-ux-directive.md` §8 "Browser E2E") actually requires. It now
 * covers, in three `describe` blocks below:
 *
 *  1. The original 6 tests (unchanged) — sign-in, applicant creation + fact
 *     persistence, session termination, cross-tenant 404, unicode names, a11y.
 *  2. `applicant journey — consent, evidence, missions, sharing, privacy`
 *     (new, `.serial` — every test shares and mutates the same account's
 *     consent/deletion state, so they run in order, never overlapping):
 *     consent granting, document upload + real processing (polled via page
 *     reload, accepting AWAITING_REVIEW/"Needs review" as a genuine success
 *     terminal state — Codex review round 1), filename review, best-effort
 *     AI proposal review, mission creation, a sharing SAFETY check (sharing
 *     to an address with no VisaStack account fails with a clear error and
 *     creates no grant row — real grant creation needs a genuine second
 *     account, see block 3 below), history, data export, and a safe,
 *     fully-reversible account-deletion request/cancel round trip.
 *  3. `cross-account boundary journeys — NOT YET COVERED` (new, all
 *     `test.skip`): every directive §8 step that can only be MEANINGFULLY
 *     verified with a second, independent identity — creating a real grant
 *     at all (`createGrantAction` requires the recipient to already be a
 *     provisioned account — Codex review round 1) and everything downstream
 *     of that (recipient sees only allowed content, pause/resume, which
 *     both also require the recipient to have accepted), plus the entire
 *     Agency journey (org admin, member assignment, scoped visibility,
 *     unauthorized-access denial, scoped export). A single self-dealing
 *     identity granting access to itself would exercise the code paths but
 *     prove nothing about tenant isolation — worse than not testing it,
 *     since a green check would imply a guarantee it doesn't establish.
 *     These are explicitly skipped with a reason rather than silently
 *     absent, so the gap stays visible in test output. Closing them needs a
 *     second synthetic WorkOS-staging identity (e.g.
 *     `WORKOS_STAGING_TEST_EMAIL_2`/`WORKOS_STAGING_TEST_PASSWORD_2`), not
 *     yet provisioned.
 *
 * Also explicitly out of scope, for reasons documented inline at each site:
 *   - "map evidence" against a published requirement pack (needs either a
 *     pre-seeded pack fixture or platform-admin pack-authoring automation —
 *     environment-dependent, not something this spec can assume exists).
 *   - "review AI/deterministic proposals" is best-effort/conditional, not a
 *     hard assertion — AI_ENABLED + a real OpenAI project may or may not be
 *     configured in whatever environment this eventually runs against.
 *
 * Codex review, PR-E2, round 2 (three P1s, one P2), all caught before this
 * spec had ever actually run against a live environment:
 *   - **Wrong label everywhere.** `createApplicant` and the two original
 *     tests that create an applicant inline all matched
 *     `/display name|applicant name/i`, but the real form's accessible
 *     label is "Full name" (`add-applicant-form.tsx`) — every applicant-
 *     creating test, old and new, would have failed at its very first step.
 *   - **Processing-status success/failure were conflated.** The round-1 fix
 *     still treated "needs attention"/"failed"/"rejected" as an acceptable
 *     terminal state alongside "ready"/"needs review" — a genuinely broken
 *     intake worker would make the E2E check pass. Now `waitFor
 *     SuccessfulProcessingStatus` fails the test outright on a failure
 *     terminal state.
 *   - **Test timeout too short for the polling budget.** The upload test's
 *     helper polls for up to 60s, but `playwright.config.ts`'s global test
 *     timeout is 30s — sign-in/consent/upload alone could exhaust it before
 *     polling ever got a fair chance. That test now calls
 *     `test.setTimeout(120_000)`.
 *   - **The deletion test could permanently strand the shared identity.**
 *     A failure between "request" and "cancel" would leave real deletion
 *     scheduled, with no guarantee a retry (or a future run) would ever
 *     reach the cancel step. Now self-heals from any already-pending
 *     deletion at the start, and cancels in a `finally` block that runs
 *     unconditionally.
 */

/** Variable-keyed env read — avoids the index-signature lint/type rule. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

const email = getEnv('WORKOS_STAGING_TEST_EMAIL');
const password = getEnv('WORKOS_STAGING_TEST_PASSWORD');
const hasCredentials = Boolean(email && password);

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await expect(page).toHaveURL(/workos\.com|authkit\.app/);
  await page.getByLabel(/email/i).fill(email ?? '');
  await page.getByRole('button', { name: /continue|next|sign in/i }).click();
  await page.getByLabel(/password/i).fill(password ?? '');
  await page.getByRole('button', { name: /sign in|continue|log in/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });
}

/** Grants a consent purpose from the Home dashboard, no-op if already granted. */
async function ensureConsent(page: import('@playwright/test').Page, title: string) {
  await page.goto('/app');
  const row = page.locator('.row', { hasText: title });
  await expect(row).toBeVisible();
  const grantButton = row.getByRole('button', { name: 'Grant' });
  if (await grantButton.isVisible().catch(() => false)) {
    await grantButton.click();
    await expect(row.getByRole('button', { name: 'Revoke' })).toBeVisible({ timeout: 10_000 });
  }
}

/**
 * Creates a fresh applicant from /app/applicants and returns its detail-page
 * URL. The visible label is "Full name" (Codex review, PR-E2, round 2 —
 * `apps/web/src/app/app/add-applicant-form.tsx:16-25`; confirmed by reading
 * the component directly), not "display name"/"applicant name" as every
 * pre-existing test in this file (including two the original, unedited
 * describe block below) had assumed.
 */
async function createApplicant(
  page: import('@playwright/test').Page,
  namePrefix: string,
): Promise<string> {
  await page.goto('/app/applicants');
  const applicantName = `${namePrefix} ${Date.now()}`;
  await page.getByLabel(/full name/i).fill(applicantName);
  await page.getByRole('button', { name: /create applicant|add applicant/i }).click();
  await expect(page.getByText(applicantName)).toBeVisible();
  await page.getByText(applicantName).click();
  await expect(page).toHaveURL(/\/app\/applicant\/[^/]+$/);
  return page.url();
}

/** The two SUCCESSFUL terminal document-processing status labels (packages/i18n's messages.ts). */
const SUCCESS_PROCESSING_STATUS = /ready|needs review/i;
/** The three FAILURE terminal status labels — a real pipeline bug, never a pass (Codex review, PR-E2, round 2). */
const FAILURE_PROCESSING_STATUS = /needs attention|failed|rejected/i;

/**
 * Polls the documents page for a document row to reach a terminal
 * processing status, via real page reloads (Codex review, PR-E2, round 1),
 * and FAILS the test if that status is a failure state rather than treating
 * "reached some terminal state" as good enough (Codex review, PR-E2, round
 * 2): the first version of this helper let a genuinely broken intake worker
 * ("needs attention"/"failed"/"rejected" on a synthetic upload that should
 * always follow the healthy path) still report the E2E check as passing.
 *
 * documents/page.tsx is a `dynamic = 'force-dynamic'` Server Component with
 * no client-side polling of its own -- the processing status is rendered
 * once, server-side, at request time. Playwright's web-first assertions
 * auto-retry against the ALREADY-LOADED DOM; they never re-fetch the page on
 * their own. Without an explicit reload loop, a wait for a status change on
 * this page would just keep re-checking the same stale, initial render
 * forever, regardless of what actually changed in the database.
 */
async function waitForSuccessfulProcessingStatus(
  page: import('@playwright/test').Page,
  documentsUrl: string,
  documentNamePattern: RegExp,
  timeoutMs = 60_000,
): Promise<string> {
  const pollIntervalMs = 3_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.goto(documentsUrl);
    const documentRow = page.locator('.row', { hasText: documentNamePattern });
    if (await documentRow.isVisible().catch(() => false)) {
      const rowText = (await documentRow.textContent().catch(() => null)) ?? '';
      if (FAILURE_PROCESSING_STATUS.test(rowText)) {
        throw new Error(
          `Document matching ${documentNamePattern} reached a FAILURE processing status: ${rowText.trim()}`,
        );
      }
      if (SUCCESS_PROCESSING_STATUS.test(rowText)) return rowText;
    }
    if (Date.now() + pollIntervalMs > deadline) break;
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error(
    `Document matching ${documentNamePattern} did not reach a terminal processing status within ${timeoutMs}ms`,
  );
}

test.describe('authenticated workspace journey', () => {
  test.skip(!hasCredentials, 'WORKOS_STAGING_TEST_EMAIL / WORKOS_STAGING_TEST_PASSWORD not set');

  test('signs in and reaches the authenticated workspace', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.app-shell-nav')).toBeVisible();
  });

  test('creates an applicant, saves a fact, logs out, signs in again, and the fact persists', async ({
    page,
  }) => {
    await signIn(page);

    await page.getByRole('link', { name: 'Applicants' }).click();
    await expect(page).toHaveURL(/\/app\/applicants$/);

    const applicantName = `E2E Synthetic ${Date.now()}`;
    // "Full name" is the form's real accessible label (Codex review,
    // PR-E2, round 2 — apps/web/src/app/app/add-applicant-form.tsx:16-25).
    await page.getByLabel(/full name/i).fill(applicantName);
    await page.getByRole('button', { name: /create applicant|add applicant/i }).click();
    await expect(page.getByText(applicantName)).toBeVisible();

    await page.getByText(applicantName).click();
    await page.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/app\/applicant\/[^/]+\/profile$/);
    // The exact manual-profile field markup is not yet confirmed against a
    // live run; this targets the first available text field on the profile
    // page as a best-effort persistence probe.
    const firstField = page.getByRole('textbox').first();
    const syntheticValue = `synthetic-${Date.now()}`;
    await firstField.fill(syntheticValue);
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await expect(page).toHaveURL(/workos\.com|authkit\.app|\/$/);

    await signIn(page);
    await page.getByText(applicantName).click();
    await page.getByRole('link', { name: 'Profile' }).click();
    await expect(page.getByRole('textbox').first()).toHaveValue(syntheticValue);
  });

  test('terminating the session denies the next protected request', async ({ page, context }) => {
    await signIn(page);
    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await context.clearCookies();
    await page.goto('/app/privacy');
    await expect(page).toHaveURL(/workos\.com|authkit\.app/);
  });

  test('an unrelated account cannot reach another applicant by guessing the URL', async ({
    page,
  }) => {
    await signIn(page);
    // A random UUID never matches a real, owned applicant — must 404, never
    // leak a redirect-to-real-data or a raw database error.
    const response = await page.goto('/app/applicant/00000000-0000-4000-8000-000000000000');
    expect(response?.status()).toBe(404);
  });

  test('a display name with unicode characters renders correctly end to end', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Applicants' }).click();
    const unicodeName = `উদাহরণ 例え 😀 ${Date.now()}`;
    await page.getByLabel(/full name/i).fill(unicodeName);
    await page.getByRole('button', { name: /create applicant|add applicant/i }).click();
    await expect(page.getByText(unicodeName)).toBeVisible();
  });

  test('the dashboard has no critical/serious automated accessibility violations', async ({
    page,
  }) => {
    await signIn(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

// .serial (Codex review, PR-E2, round 1): every test below shares and
// mutates the SAME single account's state (consent, deletion-pending) --
// playwright.config.ts's fullyParallel: true would otherwise let a mid-test
// consent revoke in one test race a concurrently-running test's own
// consent-gated action in another. Isolated per-applicant state (documents,
// missions) doesn't need this, but the account-level state does, and
// there's no cheap way to split "the tests that mutate shared state" from
// "the tests that don't" without the same risk creeping back in on a future
// edit -- serializing the whole block is the robust choice.
test.describe
  .serial('applicant journey — consent, evidence, missions, sharing, privacy (master directive §8)', () => {
    test.skip(!hasCredentials, 'WORKOS_STAGING_TEST_EMAIL / WORKOS_STAGING_TEST_PASSWORD not set');

    test('grants and revokes core-processing and sharing consent independently', async ({
      page,
    }) => {
      await signIn(page);
      await ensureConsent(page, 'Core processing consent');
      await ensureConsent(page, 'Sharing consent');

      // Revoking one must never require re-granting the other (finding #22,
      // post-programme defect register) -- verified directly here, not just
      // at the unit level.
      await page.goto('/app');
      const sharingRow = page.locator('.row', { hasText: 'Sharing consent' });
      await sharingRow.getByRole('button', { name: 'Revoke' }).click();
      await expect(sharingRow.getByRole('button', { name: 'Grant' })).toBeVisible({
        timeout: 10_000,
      });
      const coreRow = page.locator('.row', { hasText: 'Core processing consent' });
      await expect(coreRow.getByRole('button', { name: 'Revoke' })).toBeVisible();

      // Re-grant sharing so later tests in this file that depend on it
      // (grant creation below) aren't left broken by this test's own cleanup.
      await sharingRow.getByRole('button', { name: 'Grant' }).click();
      await expect(sharingRow.getByRole('button', { name: 'Revoke' })).toBeVisible({
        timeout: 10_000,
      });
    });

    test('uploads a document, observes real processing, and reviews the proposed filename if one is offered', async ({
      page,
    }) => {
      // Extended beyond playwright.config.ts's 30s default (Codex review,
      // PR-E2, round 2): sign-in + consent + applicant creation + upload
      // already consume part of that budget, leaving little to none of the
      // helper's own 60s polling window -- a healthy but slower-than-30s
      // asynchronous worker would otherwise be killed by the TEST's own
      // timeout before ever reaching its real (successful) terminal state.
      test.setTimeout(120_000);
      await signIn(page);
      await ensureConsent(page, 'Core processing consent');
      const applicantUrl = await createApplicant(page, 'E2E Evidence');

      await page.goto(`${applicantUrl}/documents`);
      // Passport-shaped synthetic content, to give the deterministic
      // classifier (packages/adapters/src/document-naming or similar) a
      // realistic chance of proposing a rename -- never asserted as
      // guaranteed, since classification confidence is genuinely data- and
      // environment-dependent (see this file's own header comment).
      const syntheticContent = [
        'PASSPORT',
        'Type: P',
        'Country Code: SYN',
        'Passport No: E2E0000000',
        'Surname: SYNTHETIC',
        'Given Names: E2E TEST',
        'Nationality: SYNTHETIC',
        `Date of Issue: ${new Date().toISOString().slice(0, 10)}`,
      ].join('\n');
      const documentFileName = `e2e-synthetic-passport-${Date.now()}.txt`;
      await page.locator('input[aria-label="Document file"]').setInputFiles({
        name: documentFileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(syntheticContent, 'utf-8'),
      });
      await page.getByRole('button', { name: 'Upload document' }).click();
      const documentsUrl = page.url();

      // Real processing (scan -> normalize -> classify), never faked progress
      // (master directive §7 "PR 7") -- polls via real page reloads (see
      // waitForSuccessfulProcessingStatus's own doc comment) for a terminal
      // status, treating AWAITING_REVIEW ("Needs review") as a genuine
      // success terminal state (Codex review, PR-E2, round 1: for a normal,
      // safe, non-auto-approved upload, AWAITING_REVIEW is exactly where
      // processIntake is SUPPOSED to stop, pending the human review this
      // test performs immediately below) while FAILING outright on a real
      // failure terminal state (Codex review, PR-E2, round 2).
      await waitForSuccessfulProcessingStatus(page, documentsUrl, new RegExp(documentFileName));

      // Filename review is CONDITIONAL: only present when classification
      // confidence cleared the review-required bar (packages/adapters'
      // classifier decides this, not the E2E environment). Best-effort, not a
      // hard requirement -- asserting it unconditionally would make this test
      // fail on legitimate, correct low-confidence classifications.
      const approveButton = page.getByRole('button', { name: 'Approve' });
      if (await approveButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await approveButton.click();
        await expect(approveButton).toBeHidden({ timeout: 10_000 });
      }
    });

    test('creates a mission', async ({ page }) => {
      await signIn(page);
      await ensureConsent(page, 'Core processing consent');
      const applicantUrl = await createApplicant(page, 'E2E Mission');

      await page.goto(`${applicantUrl}/missions`);
      const missionTitle = `E2E Mission ${Date.now()}`;
      await page.getByLabel('Title').fill(missionTitle);
      await page.getByRole('button', { name: 'Create mission' }).click();
      await expect(page.getByText(missionTitle)).toBeVisible({ timeout: 10_000 });
    });

    test('sharing to an email with no VisaStack account fails safely, with a clear error, rather than creating a broken grant', async ({
      page,
    }) => {
      // Codex review, PR-E2, round 1 (P1): the original version of this test
      // asserted the OPPOSITE of what createGrantAction actually does --
      // apps/web/src/app/app/applicant/[id]/sharing/actions.ts:61-66 looks the
      // recipient up with getAccountByEmail and returns an error, creating NO
      // grant row at all, when the address belongs to no real account. A
      // syntactically valid but unowned address can never be used to exercise
      // grant creation (the recipient must already be a real, provisioned
      // VisaStack account) -- so "share narrow access, then revoke it" is
      // cross-account-only, same as pause/resume/accept (moved to the
      // cross-account boundary describe block below). What single-identity
      // testing over this same, real safety guard, checking the app never
      // silently no-ops or half-creates a grant for an address nobody owns.
      await signIn(page);
      await ensureConsent(page, 'Core processing consent');
      await ensureConsent(page, 'Sharing consent');
      const applicantUrl = await createApplicant(page, 'E2E Sharing Safety');

      await page.goto(`${applicantUrl}/sharing`);
      const unownedEmail = `e2e-unowned-${Date.now()}@example.invalid`;
      await page.getByLabel('Recipient email').fill(unownedEmail);
      await page.getByLabel('Purpose').fill('E2E unowned-recipient safety check');
      await page.getByRole('button', { name: 'Share access' }).click();

      await expect(page.getByText(/no visastack account found/i)).toBeVisible({ timeout: 10_000 });
      // No grant row for this address -- the failed attempt left no trace to
      // later "accept", "pause", or leak access through.
      await expect(page.locator('.row', { hasText: unownedEmail })).toHaveCount(0);
    });

    test('views fact history for an applicant', async ({ page }) => {
      await signIn(page);
      await ensureConsent(page, 'Core processing consent');
      const applicantUrl = await createApplicant(page, 'E2E History');

      await page.goto(`${applicantUrl}/history`);
      await expect(page).toHaveURL(/\/history$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test('exports account data as a downloadable JSON snapshot', async ({ page }) => {
      await signIn(page);
      await page.goto('/app/privacy');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: 'Download export' }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.json$/i);
      const path = await download.path();
      expect(path).toBeTruthy();
    });

    test('requests account deletion, sees the pending grace-window state, then cancels it', async ({
      page,
    }) => {
      // SAFETY (Codex review, PR-E2, round 2): this is a real, destructive
      // action against the ONE shared synthetic identity every test in this
      // file reuses across every run, forever. If anything between the
      // request and the cancel below fails -- a flaky assertion, a browser
      // crash, a network blip -- an unguarded version of this test leaves
      // the account genuinely scheduled for deletion; a CI retry would then
      // find "Cancel deletion" instead of "Request account deletion" and
      // never reach cancellation either, and after enough such failures the
      // 7-day grace window could elapse for real, permanently deleting the
      // only configured test account and disabling every future
      // credentialed E2E run. Two guarantees close that gap: (1) self-heals
      // from a PRIOR failed run by cancelling any already-pending deletion
      // before testing the request/cancel cycle fresh; (2) the cancel step
      // runs in `finally`, unconditionally, regardless of what the
      // assertions above it do.
      await signIn(page);
      await page.goto('/app/privacy');
      if (
        await page
          .getByRole('button', { name: 'Cancel deletion' })
          .isVisible()
          .catch(() => false)
      ) {
        await page.getByRole('button', { name: 'Cancel deletion' }).click();
        await expect(page.getByText(/deletion pending/i)).toBeHidden({ timeout: 10_000 });
      }

      try {
        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: 'Request account deletion' }).click();
        await expect(page.getByText(/deletion pending/i)).toBeVisible({ timeout: 10_000 });
      } finally {
        // Unconditional: runs whether the assertions above passed, failed,
        // or threw. isVisible().catch(() => false) rather than a bare
        // await, so a page already mid-navigation/closed can't turn this
        // cleanup step itself into an unhandled rejection that skips the
        // cancel click.
        const cancelButton = page.getByRole('button', { name: 'Cancel deletion' });
        if (await cancelButton.isVisible().catch(() => false)) {
          await cancelButton.click();
        }
      }

      await expect(page.getByText(/deletion pending/i)).toBeHidden({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeVisible();
    });
  });

test.describe('cross-account boundary journeys — NOT YET COVERED (master directive §8)', () => {
  // These steps are only MEANINGFUL with a second, independent identity: a
  // single account granting itself access, or assigning itself as an org
  // member, would exercise the code paths without proving the actual
  // tenant-isolation guarantee the directive requires -- a green check here
  // would be worse than no test at all, implying a boundary was verified
  // when it wasn't. Every test below immediately self-skips with an
  // explicit reason (the standard Playwright pattern for a documented,
  // visible gap, rather than a silently absent test) so this stays visible
  // in every run's output. Needs a second synthetic WorkOS-staging identity
  // (e.g. WORKOS_STAGING_TEST_EMAIL_2 / WORKOS_STAGING_TEST_PASSWORD_2),
  // not yet provisioned as a repository secret.
  const reason =
    'requires a second synthetic WorkOS-staging identity (WORKOS_STAGING_TEST_EMAIL_2 / _PASSWORD_2), not yet provisioned';

  // Codex review, PR-E2, round 1 (P1): moved here from the single-identity
  // describe block above. createGrantAction (apps/web/src/app/app/applicant/
  // [id]/sharing/actions.ts) looks the recipient up with getAccountByEmail
  // and creates no grant row at all for an address that isn't a real,
  // provisioned account -- so even "create a grant, then revoke it before
  // acceptance" needs a genuine second account to get past the very first
  // step. The single-identity-feasible half of this scenario (the app
  // correctly refuses to create a grant for an unowned address) is covered
  // above by "sharing to an email with no VisaStack account fails safely".
  test('creates a narrow-permission grant to a real second account and can revoke it before acceptance', () => {
    test.skip(true, reason);
  });

  test('a share recipient sees only the narrow permission subset they were granted', () => {
    test.skip(true, reason);
  });

  test('pausing an accepted grant immediately denies the recipient; resuming restores it', () => {
    test.skip(true, reason);
  });

  test('org admin accepts an organization grant and assigns an active member', () => {
    test.skip(true, reason);
  });

  test("an assigned member sees only their assigned case, never the org's full applicant list", () => {
    test.skip(true, reason);
  });

  test('an org member requests permitted evidence and adds a permitted note', () => {
    test.skip(true, reason);
  });

  test('an org member attempting unauthorized case access is denied', () => {
    test.skip(true, reason);
  });

  test('a bulk export for an organization includes exactly the granted subset, nothing more', () => {
    test.skip(true, reason);
  });
});
