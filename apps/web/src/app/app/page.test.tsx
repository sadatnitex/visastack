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
