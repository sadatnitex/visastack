import { type ServiceError, keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../lib/next-mocks.test-support';

/**
 * The three link pages (agency invitation, client invitation, contributor request): a link that
 * opens but cannot be used shows the service's refusal in the visitor's language, marked as the
 * language it is in; a missing link shows the page's own line. A made-up link and a real one the
 * service refuses with the same key read the same in both languages. Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
const svc = vi.hoisted(() => ({ result: { ok: true } as unknown }));

vi.mock('../../lib/locale', () => ({ getLocale: async () => loc.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    loc.holder ??= build();
    return loc.holder;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewOrganizationInvitation: async () => svc.result,
  previewClientInvitation: async () => svc.result,
  previewContributorRequest: async () => svc.result,
  getRetentionPolicies: async () => [],
  getConsents: async () => ({ CORE_PROCESSING: true, SHARING: true }),
  listApplicants: async () => [],
  getOrganizationBrandingForDisplay: async () => undefined,
  aiAssistAvailable: async () => false,
}));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.test' }),
}));
vi.mock('./invitations/accept/accept-form', () => ({
  AcceptInvitationForm: stub('AcceptInvitationForm'),
}));
vi.mock('./client-invitations/accept/accept-form', () => ({
  AcceptClientInvitationForm: stub('AcceptClientInvitationForm'),
}));
vi.mock('./client-invitations/accept/consent-gate', () => ({ ConsentGate: stub('ConsentGate') }));
vi.mock('./contributor-requests/accept/submit-evidence-form', () => ({
  SubmitEvidenceForm: stub('SubmitEvidenceForm'),
}));

const pages = {
  agency: (await import('./invitations/accept/page')).default,
  client: (await import('./client-invitations/accept/page')).default,
  contributor: (await import('./contributor-requests/accept/page')).default,
};

const BENGALI = /[ঀ-৿]/;
const TOKEN = 't'.repeat(43);
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

const ROWS: readonly (readonly [keyof typeof pages, ServiceMessageKey])[] = [
  ['agency', 'invitations.already_used_or_revoked'],
  ['agency', 'invitations.this_invitation_has_expired'],
  ['agency', 'invitations.no_longer_taking_new_members'],
  ['client', 'client_invitations.already_used_or_revoked'],
  ['client', 'client_invitations.this_invitation_has_expired'],
  ['contributor', 'contributor_requests.already_used_or_revoked'],
  ['contributor', 'contributor_requests.this_request_has_expired'],
];

async function html(page: keyof typeof pages, error: ServiceError): Promise<string> {
  svc.result = { ok: false, error };
  loc.holder = null;
  return renderServer(pages[page]({ searchParams: Promise.resolve({ token: TOKEN }) }));
}

beforeEach(() => {
  loc.locale = 'en';
});

describe('link pages show the service refusal in the visitor language', () => {
  it.each(ROWS)('en: %s page, %s', async (page, key) => {
    const error = keyedError('invalid', key);
    const text = textOf(await html(page, error));
    expect(text).toContain(error.message);
    expect(text).not.toContain(key);
  });

  it.each(ROWS)('bn: %s page, %s', async (page, key) => {
    loc.locale = 'bn';
    const error = keyedError('invalid', key);
    const markup = await html(page, error);
    const own = bn[key];
    if (own === undefined) {
      expect(textOf(markup)).toContain(error.message);
    } else {
      expect(own).toMatch(BENGALI);
      // Shown in Bangla, and marked as Bangla inside the English page.
      expect(markup).toMatch(new RegExp(`lang="bn"[^>]*>${own}<`));
    }
    expect(textOf(markup)).not.toContain(key);
  });

  it('an unkeyed refusal shows the English it was sent, under bn too', async () => {
    loc.locale = 'bn';
    const text = textOf(await html('agency', { code: 'invalid', message: 'plain words here' }));
    expect(text).toContain('plain words here');
  });
});
