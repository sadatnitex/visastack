import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stubProps, textOf } from '../../lib/next-mocks.test-support';

const data = vi.hoisted(() => ({
  consents: {} as Record<string, unknown>,
  applicants: [] as { id: string; displayName: string }[],
  documents: 0,
  openRequests: 0,
  proposals: 0,
  missions: 0,
  pendingGrants: 0,
  memberships: [] as { active: boolean }[],
  platformAdmin: false,
}));

vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../lib/admin', () => ({ isPlatformAdmin: async () => data.platformAdmin }));
vi.mock('@visastack/services', () => ({
  getConsents: async () => data.consents,
  listApplicants: async () => data.applicants,
  listGrantsForRecipientAccount: async () =>
    Array.from({ length: data.pendingGrants }, () => ({
      grant: { status: 'PENDING_ACCEPTANCE' },
    })),
  listMembershipsForAccount: async () => data.memberships,
  listDocuments: async () => ({ ok: true, value: Array.from({ length: data.documents }) }),
  listPendingProposals: async () => Array.from({ length: data.proposals }),
  listMissions: async () => ({
    ok: true,
    value: Array.from({ length: data.missions }, () => ({ state: 'IN_PROGRESS' })),
  }),
  listEvidenceRequestsForApplicant: async () => ({
    ok: true,
    value: Array.from({ length: data.openRequests }, () => ({ status: 'OPEN' })),
  }),
}));
vi.mock('./consent-button', async () => {
  const { stub } = await import('../../lib/next-mocks.test-support');
  return { ConsentButton: stub('ConsentButton') };
});
vi.mock('./add-applicant-form', async () => {
  const { stub } = await import('../../lib/next-mocks.test-support');
  return { AddApplicantForm: stub('AddApplicantForm') };
});

const { default: Page } = await import('./page');

const SELF = { id: '10000000-0000-4000-8000-000000000001', displayName: 'Synthetic Self' };

beforeEach(() => {
  data.consents = {};
  data.applicants = [];
  data.documents = 0;
  data.openRequests = 0;
  data.proposals = 0;
  data.missions = 0;
  data.pendingGrants = 0;
  data.memberships = [];
  data.platformAdmin = false;
});

describe('home (characterization before WP-V3)', () => {
  it('with an applicant and core processing on, shows the next step, the applicant and every consent control', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 2;
    data.missions = 1;
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Welcome Back');
    expect(text).toContain('Signed in as me@example.com');
    expect(text).toContain('Synthetic Self');
    expect(text).toContain('2 documents');
    expect(text).toContain('Permissions You Control');
    expect(stubProps<{ type: string }>(html, 'ConsentButton').map((p) => p.type)).toEqual([
      'CORE_PROCESSING',
      'AI_EXTRACTION',
      'AI_OCR',
      'SHARING',
      'MARKETING',
      'ISSUER_CONTACT',
    ]);
  });

  it('gives each permission name and its meaning their own element, so they never run together', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    const html = await renderServer(Page({}));
    expect(html).toContain(
      '<span class="consent-name">Let VisaStack Process My Details</span> <span class="consent-meaning">Needed before',
    );
    expect(html.match(/class="consent-name"/g)).toHaveLength(6);
    expect(html.match(/class="consent-meaning"/g)).toHaveLength(6);
  });

  it('puts what someone is waiting on first, and lists the rest', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.openRequests = 2;
    data.proposals = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Evidence Requests Waiting for a Reply');
    expect(text).toContain('Needs Your Attention');
    expect(text).toContain('Suggested Details Waiting for Your Decision');
  });

  it('when everything is done, says so', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 1;
    data.missions = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('You Are Up to Date');
    expect(text).not.toContain('Set up your account');
  });
});

const page = (params: Record<string, string> = {}) =>
  renderServer(Page({ searchParams: Promise.resolve(params) }));
const CORE = { CORE_PROCESSING: { grantedAt: new Date() } };

describe('task-first first run (WP-V3, D8)', () => {
  it('asks someone new for core processing alone: exactly one consent control', async () => {
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Step 1 of 2');
    expect(text).toContain('This does not turn on AI reading, sharing with an agency or marketing');
    const buttons = stubProps<{ type: string; granted: boolean; text: string }>(
      html,
      'ConsentButton',
    );
    expect(buttons).toEqual([
      expect.objectContaining({
        type: 'CORE_PROCESSING',
        granted: false,
        text: 'Allow core processing',
      }),
    ]);
    expect(text).not.toContain('Permissions You Control');
    expect(html).toContain('href="/app?setup=later"');
  });

  it('"Not Now" shows the ordinary home with every consent control', async () => {
    const html = await page({ setup: 'later' });
    expect(textOf(html)).toContain('Permissions You Control');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('a returning person with records who turned every permission off gets the ordinary home', async () => {
    data.applicants = [SELF];
    const html = await page();
    expect(textOf(html)).not.toContain('Step 1 of 2');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('someone who turned core processing off with another consent still on keeps every control', async () => {
    data.consents = { MARKETING: { grantedAt: new Date() } };
    const html = await page();
    expect(textOf(html)).not.toContain('Step 1 of 2');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('then asks who the record is for on the page that becomes "what do you want to do?"', async () => {
    data.consents = CORE;
    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/app?welcome=1');
    const html = await page({ welcome: '1' });
    expect(textOf(html)).toContain('Step 2 of 2');
    expect(stubProps<{ firstRun: boolean }>(html, 'AddApplicantForm')).toEqual([
      { firstRun: true },
    ]);
    expect(stubProps(html, 'ConsentButton')).toHaveLength(0);
    // Once the applicant is saved, the same page asks what to do next.
    data.applicants = [SELF];
    expect(textOf(await page({ welcome: '1' }))).toContain('What do you want to do?');
  });

  it('with a valid return path, finishes the two screens and goes to that task instead', async () => {
    data.consents = CORE;
    const next = '/app/client-invitations/accept?token=abc';
    const html = await page({ next });
    expect(textOf(html)).toContain('Step 2 of 2');
    expect(stubProps(html, 'AddApplicantForm')).toHaveLength(1);
    // "Not Now" goes to the task too, rather than leaving the invitation behind.
    expect(html).toContain(`href="${next.replaceAll('&', '&amp;')}"`);
    data.applicants = [SELF];
    await expect(page({ next })).rejects.toThrow(`NEXT_REDIRECT:${next}`);
  });

  it('"Not Now" also skips the welcome redirect', async () => {
    data.consents = CORE;
    const text = textOf(await page({ setup: 'later', welcome: '1' }));
    expect(text).toContain('Welcome Back');
    expect(text).not.toContain('Step 2 of 2');
  });

  it('never follows a return path that leaves the site, or one back to home', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    for (const next of [
      '//evil.example',
      'https://evil.example',
      '/app',
      '/app?welcome=1',
      '/api/health/ready',
      '/auth/sign-in',
      '/invitationx',
      '/app/../privacy/export',
      '/app/./../api/jobs/x',
      '/app/%2e%2e/api/x',
      '/app%2f..%2fapi/x',
      '/invitation/../api/x',
      '/invitation?kind=client&token=abc',
    ]) {
      const text = textOf(await page({ next }));
      expect(text).toContain('Welcome Back');
    }
  });

  it('asks what to do once, offering only destinations that exist, and can be skipped', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    let html = await page({ welcome: '1' });
    let text = textOf(html);
    expect(text).toContain('What do you want to do?');
    expect(text).toContain('Update or Find My Records');
    expect(text).not.toContain('Complete a Request');
    expect(text).not.toContain('Prepare a brief');
    expect(html).toContain(`href="/app/applicant/${SELF.id}"`);
    expect(html).toContain('href="/app"');
    data.openRequests = 1;
    html = await page({ welcome: '1' });
    text = textOf(html);
    expect(text).toContain('Complete a Request');
    expect(html).toContain(`href="/app/applicant/${SELF.id}/evidence"`);
  });

  it('does not show first run to someone with consent and an applicant', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    const text = textOf(await page());
    expect(text).not.toMatch(/Step [12] of 2/);
    expect(text).not.toContain('What do you want to do?');
    expect(text).toContain('Welcome Back');
  });

  it('never sends agency staff, platform staff or someone with shared access through first run', async () => {
    for (const setup of [
      () => {
        data.memberships = [{ active: true }];
      },
      () => {
        data.platformAdmin = true;
      },
      () => {
        data.pendingGrants = 1;
      },
    ]) {
      data.memberships = [];
      data.platformAdmin = false;
      data.pendingGrants = 0;
      setup();
      data.consents = {};
      expect(textOf(await page())).not.toContain('Step 1 of 2');
      data.consents = CORE;
      const text = textOf(await page());
      expect(text).not.toContain('Step 2 of 2');
      expect(text).toContain('Welcome Back');
    }
  });

  it('offers a waiting sharing invitation as the request to complete', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.pendingGrants = 1;
    const html = await page({ welcome: '1' });
    expect(textOf(html)).toContain('Complete a Request');
    expect(html).toContain('href="/app/shared"');
  });
});
