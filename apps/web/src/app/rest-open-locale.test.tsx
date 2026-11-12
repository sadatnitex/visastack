import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
const svc = vi.hoisted(() => ({
  previewOrganizationInvitation: vi.fn(),
  previewClientInvitation: vi.fn(),
  previewContributorRequest: vi.fn(),
  previewSharingInvitation: vi.fn(),
  sharingInvitationSender: vi.fn(),
  getConsents: vi.fn(),
  listApplicants: vi.fn(),
  getOrganizationBrandingForDisplay: vi.fn(),
  aiAssistAvailable: vi.fn(),
  getRetentionPolicies: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));
vi.mock('../lib/session', () => ({
  withSession: async (work: (ctx: unknown) => unknown) =>
    work({ db: {}, accountId: 'acct-1', email: 'me@example.test' }),
}));
vi.mock('./app/invitations/accept/actions', () => ({ acceptInvitationAction: vi.fn() }));
vi.mock('./app/client-invitations/accept/actions', () => ({
  acceptClientInvitationAction: vi.fn(),
}));
vi.mock('./app/sharing-invitations/accept/actions', () => ({
  acceptSharingInvitationAction: vi.fn(),
}));
vi.mock('./app/contributor-requests/accept/actions', () => ({
  submitContributorEvidenceAction: vi.fn(),
}));
vi.mock('./app/actions', () => ({ setConsentAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
  notFound: () => {
    throw new Error('not found');
  },
}));

import { I18nProvider } from '../components/i18n-provider';
import { appClientInvitationsCatalog } from '../i18n/app-client-invitations';
import { appContributorRequestsCatalog } from '../i18n/app-contributor-requests';
import { appInvitationsCatalog } from '../i18n/app-invitations';
import { appSharingInvitationsCatalog } from '../i18n/app-sharing-invitations';
import AcceptClientInvitationPage from './app/client-invitations/accept/page';
import AcceptContributorPage from './app/contributor-requests/accept/page';
import AcceptInvitationPage from './app/invitations/accept/page';
import SharingInvitationPage from './app/sharing-invitations/accept/page';

const BENGALI = /[ঀ-৿]/;
const withToken = { searchParams: Promise.resolve({ token: 'tok' }) };
const bnOf = (k: string) =>
  (appClientInvitationsCatalog.bn as Record<string, string>)[
    `appClientInvitations.appClientInvitationsAcceptAcceptForm.${k}`
  ];

const seen: string[] = [];

async function draw(page: () => unknown | Promise<unknown>, locale: 'en' | 'bn') {
  current.locale = locale;
  current.holder = null;
  const element = (await page()) as React.ReactNode;
  const markup = renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang="en">
      {element}
    </I18nProvider>,
  );
  const doc = new JSDOM(markup).window.document;
  if (locale === 'bn') seen.push(doc.body.textContent ?? '');
  return doc;
}

const ok = <T,>(value: T) => ({ ok: true, value });
const notFound = { ok: false, error: { code: 'not_found', message: 'gone' } };
const invite = {
  organizationId: 'o1',
  organizationName: 'Acme Visas',
  requestedRoute: null,
  grantActions: ['VIEW_METADATA'],
};

beforeEach(() => {
  vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
  for (const f of Object.values(svc)) f.mockReset();
  svc.listApplicants.mockResolvedValue([{ id: 'a1', displayName: 'Rina' }]);
  svc.getOrganizationBrandingForDisplay.mockResolvedValue(null);
  svc.aiAssistAvailable.mockResolvedValue(true);
  svc.getRetentionPolicies.mockResolvedValue([{ docType: 'BANK_STATEMENT', retentionDays: 30 }]);
  svc.sharingInvitationSender.mockResolvedValue({ email: 'sender@example.test' });
});
afterEach(() => vi.unstubAllEnvs());

describe('open invitation states under Bengali', () => {
  it('client invitation: consent steps shown when consents are off, English kept for held text', async () => {
    svc.previewClientInvitation.mockResolvedValue(ok(invite));
    svc.getConsents.mockResolvedValue({ CORE_PROCESSING: false, SHARING: false });
    const bn = await draw(() => AcceptClientInvitationPage(withToken), 'bn');
    const text = bn.body.textContent ?? '';
    expect(text).toContain('If you accept, they will be able to:');
    expect(text).toContain('Turn these on before accepting (both are required):');
    expect(
      [...bn.querySelectorAll('button')].some((b) =>
        b.getAttribute('aria-label')?.startsWith('Turn On: '),
      ),
    ).toBe(true);
    expect(text).toContain('See the details on the profile you choose');
    const en = await draw(() => AcceptClientInvitationPage(withToken), 'en');
    expect(en.body.textContent).toContain('Turn On');
  });

  it('client invitation: the accept form (both consents on) is Bengali only where a draft is cleared', async () => {
    svc.previewClientInvitation.mockResolvedValue(ok(invite));
    svc.getConsents.mockResolvedValue({ CORE_PROCESSING: true, SHARING: true });
    const bn = await draw(() => AcceptClientInvitationPage(withToken), 'bn');
    const text = bn.body.textContent ?? '';
    expect(text).toContain(bnOf('profileNameOptional'));
    expect(text).toContain('AI Tools');
    expect(text).toContain('Create a New Profile');
    expect(text).not.toContain(bnOf('aiTools') ?? 'x-never');
    const en = await draw(() => AcceptClientInvitationPage(withToken), 'en');
    expect(en.body.textContent).toContain('Profile Name (Optional)');
    expect(en.body.textContent).not.toContain('প্রোফাইলের নাম');
  });

  it('client invitation: an unrecognised link shows the Bengali not-valid notice', async () => {
    svc.previewClientInvitation.mockResolvedValue(notFound);
    svc.getConsents.mockResolvedValue({});
    const bn = await draw(() => AcceptClientInvitationPage(withToken), 'bn');
    expect(bn.body.textContent).toContain('এই আমন্ত্রণ লিংকটি বৈধ নয়।');
    const en = await draw(() => AcceptClientInvitationPage(withToken), 'en');
    expect(en.body.textContent).toContain('This invitation link is not valid.');
  });

  it('client invitation: an invitation that cannot be shown right now has the Bengali notice', async () => {
    svc.previewClientInvitation.mockResolvedValue(
      ok({ ...invite, grantActions: ['NOT_A_REAL_ACTION'] }),
    );
    svc.getConsents.mockResolvedValue({ CORE_PROCESSING: true, SHARING: true });
    const bn = await draw(() => AcceptClientInvitationPage(withToken), 'bn');
    expect(bn.body.textContent).toContain(
      'This invitation cannot be shown right now. Ask the agency to send it again.',
    );
  });

  it('team invitation: open state with the matching email shows the form and no Bengali sentence', async () => {
    svc.previewOrganizationInvitation.mockResolvedValue(
      ok({ organizationName: 'Acme', role: 'member', emailMatches: true, invitedEmail: 'x@y.z' }),
    );
    const bn = await draw(() => AcceptInvitationPage(withToken), 'bn');
    expect(bn.body.textContent).toContain('আমন্ত্রণ');
    expect(bn.body.textContent).toContain('Join an Organization');
    const en = await draw(() => AcceptInvitationPage(withToken), 'en');
    expect(en.body.textContent).not.toMatch(BENGALI);
  });

  it('team invitation: the wrong-email state and the not-valid state', async () => {
    svc.previewOrganizationInvitation.mockResolvedValue(
      ok({ organizationName: 'Acme', role: 'member', emailMatches: false, invitedEmail: 'x@y.z' }),
    );
    const wrong = await draw(() => AcceptInvitationPage(withToken), 'bn');
    expect(wrong.body.textContent).toContain('Sign In with the Invited Email');
    svc.previewOrganizationInvitation.mockResolvedValue(notFound);
    const bad = await draw(() => AcceptInvitationPage(withToken), 'bn');
    expect(bad.body.textContent).toContain('এই আমন্ত্রণ লিংকটি বৈধ নয়।');
  });

  it('contributor request: open form, wrong-email and not-valid states', async () => {
    const value = {
      applicantName: 'Rina',
      missionTitle: 'Japan',
      docType: 'BANK_STATEMENT',
      purpose: 'Proof of funds',
      message: null,
      recipientOrganizationNames: ['Acme'],
      emailMatches: true,
    };
    svc.previewContributorRequest.mockResolvedValue(ok(value));
    const open = await draw(() => AcceptContributorPage(withToken), 'bn');
    expect(open.body.textContent).toContain('Provide One Document');
    expect(open.body.textContent).toContain('30 days from upload');
    expect(open.body.textContent).not.toMatch(BENGALI);
    svc.previewContributorRequest.mockResolvedValue(ok({ ...value, emailMatches: false }));
    const wrong = await draw(() => AcceptContributorPage(withToken), 'bn');
    expect(wrong.body.textContent).toContain('sent to a different email address');
    expect(wrong.body.textContent).not.toMatch(BENGALI);
    svc.previewContributorRequest.mockResolvedValue(notFound);
    const bad = await draw(() => AcceptContributorPage(withToken), 'bn');
    expect(bad.body.textContent).toContain('এই লিংকটি বৈধ নয়।');
  });

  it('sharing invitation: unavailable and open states keep every held sentence English', async () => {
    svc.getConsents.mockResolvedValue({ CORE_PROCESSING: true, SHARING: true });
    svc.previewSharingInvitation.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'This invitation is not available.' },
    });
    const bad = await draw(() => SharingInvitationPage(withToken), 'bn');
    expect(bad.body.textContent).toContain('Invitation Unavailable');
    expect(bad.body.textContent).not.toMatch(BENGALI);
    svc.previewSharingInvitation.mockResolvedValue(
      ok({
        purpose: 'Visa check',
        actions: [],
        categories: null,
        documentIds: null,
        documentScopeSnapshot: null,
        grantExpiryAt: new Date('2026-12-01T00:00:00Z'),
        expiresAt: new Date('2026-11-20T00:00:00Z'),
      }),
    );
    const open = await draw(() => SharingInvitationPage(withToken), 'bn');
    expect(open.body.textContent).toContain('Review Shared Access');
    expect(open.body.textContent).toContain('Opening this invitation grants no access');
    expect(open.body.querySelector('input[name="confirm"]')).not.toBeNull();
    expect(open.body.textContent).not.toMatch(BENGALI);
  });
});

describe('live Bengali keys of the invitation screens', () => {
  it('live N, rendered N: every live key shows under bn in the states above', async () => {
    const noToken = { searchParams: Promise.resolve({}) };
    await draw(() => AcceptInvitationPage(noToken), 'bn');
    await draw(() => AcceptClientInvitationPage(noToken), 'bn');
    await draw(() => AcceptContributorPage(noToken), 'bn');
    const text = seen.join('\n');
    const live = [
      ...Object.values(appClientInvitationsCatalog.bn),
      ...Object.values(appInvitationsCatalog.bn),
      ...Object.values(appContributorRequestsCatalog.bn),
      ...Object.values(appSharingInvitationsCatalog.bn),
    ];
    expect(live.filter((v) => !text.includes(v))).toEqual([]);
  });
});

describe('a button name and its visible text share one language', () => {
  it('every labelled button on the open client invitation matches its text', async () => {
    svc.previewClientInvitation.mockResolvedValue(ok(invite));
    svc.getConsents.mockResolvedValue({ CORE_PROCESSING: false, SHARING: false });
    const bn = await draw(() => AcceptClientInvitationPage(withToken), 'bn');
    const labelled = [...bn.querySelectorAll('button[aria-label]')];
    expect(labelled.length).toBeGreaterThan(0);
    for (const b of labelled)
      expect(BENGALI.test(b.getAttribute('aria-label') ?? '')).toBe(
        BENGALI.test(b.textContent ?? ''),
      );
  });
});
