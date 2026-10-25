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
}));

vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('@visastack/services', () => ({
  getConsents: async () => data.consents,
  listApplicants: async () => data.applicants,
  listGrantsForRecipientAccount: async () =>
    Array.from({ length: data.pendingGrants }, () => ({
      grant: { status: 'PENDING_ACCEPTANCE' },
    })),
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
});

describe('home (characterization before WP-V3)', () => {
  it('with an applicant and core processing on, shows the next step, the applicant and every consent control', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 2;
    data.missions = 1;
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Welcome back');
    expect(text).toContain('Signed in as me@example.com');
    expect(text).toContain('Synthetic Self');
    expect(text).toContain('2 documents');
    expect(text).toContain('Permissions you control');
    expect(stubProps<{ type: string }>(html, 'ConsentButton').map((p) => p.type)).toEqual([
      'CORE_PROCESSING',
      'AI_EXTRACTION',
      'AI_OCR',
      'SHARING',
      'MARKETING',
      'ISSUER_CONTACT',
    ]);
  });

  it('puts what someone is waiting on first, and lists the rest', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.openRequests = 2;
    data.proposals = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Evidence requests waiting for a reply');
    expect(text).toContain('Needs your attention');
    expect(text).toContain('Suggested details waiting for your decision');
  });

  it('when everything is done, says so', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 1;
    data.missions = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('You are up to date');
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
    expect(text).not.toContain('Permissions you control');
    expect(html).toContain('href="/app?setup=later"');
  });

  it('"Not now" shows the ordinary home with every consent control', async () => {
    const html = await page({ setup: 'later' });
    expect(textOf(html)).toContain('Permissions you control');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('someone who turned core processing off with another consent still on keeps every control', async () => {
    data.consents = { MARKETING: { grantedAt: new Date() } };
    const html = await page();
    expect(textOf(html)).not.toContain('Step 1 of 2');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('then asks who the record is for, and moves on to "what do you want to do?"', async () => {
    data.consents = CORE;
    const html = await page();
    expect(textOf(html)).toContain('Step 2 of 2');
    expect(stubProps<{ firstRun: { afterHref: string } }>(html, 'AddApplicantForm')).toEqual([
      { firstRun: { afterHref: '/app?welcome=1' } },
    ]);
    expect(stubProps(html, 'ConsentButton')).toHaveLength(0);
  });

  it('with a valid return path, finishes the two screens and goes to that task instead', async () => {
    data.consents = CORE;
    const next = '/invitation?kind=client&token=abc';
    const html = await page({ next });
    expect(stubProps<{ firstRun: { afterHref: string } }>(html, 'AddApplicantForm')[0]).toEqual({
      firstRun: { afterHref: next },
    });
    data.applicants = [SELF];
    await expect(page({ next })).rejects.toThrow(`NEXT_REDIRECT:${next}`);
  });

  it('never follows a return path that leaves the site, or one back to home', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    for (const next of ['//evil.example', 'https://evil.example', '/app', '/app?welcome=1']) {
      const text = textOf(await page({ next }));
      expect(text).toContain('Welcome back');
    }
  });

  it('asks what to do once, offering only destinations that exist, and can be skipped', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    let html = await page({ welcome: '1' });
    let text = textOf(html);
    expect(text).toContain('What do you want to do?');
    expect(text).toContain('Update or find my records');
    expect(text).not.toContain('Complete a request');
    expect(text).not.toContain('Prepare a brief');
    expect(html).toContain(`href="/app/applicant/${SELF.id}"`);
    expect(html).toContain('href="/app"');
    data.openRequests = 1;
    html = await page({ welcome: '1' });
    text = textOf(html);
    expect(text).toContain('Complete a request');
    expect(html).toContain(`href="/app/applicant/${SELF.id}/evidence"`);
  });

  it('does not show first run to someone with consent and an applicant', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    const text = textOf(await page());
    expect(text).not.toMatch(/Step [12] of 2/);
    expect(text).not.toContain('What do you want to do?');
    expect(text).toContain('Welcome back');
  });
});
