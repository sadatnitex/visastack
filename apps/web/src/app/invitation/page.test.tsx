import { DEFAULT_CLIENT_GRANT_ACTIONS } from '@visastack/services';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../lib/invitation-preview', () => ({ loadClientInvitationPage: mocks.load }));

const { default: InvitationPage, metadata } = await import('./page');

const TOKEN = 'a'.repeat(43);
const render = (searchParams: { kind?: string; token?: string }) =>
  renderServer(InvitationPage({ searchParams: Promise.resolve(searchParams) }));

// Until a test says otherwise the lookup is not available, so the page is the plain handoff it was.
beforeEach(() => {
  mocks.load.mockReset();
  mocks.load.mockResolvedValue({ state: 'unavailable' });
});

describe('the public invitation page (v1.2 B09: neutral, no bearer access)', () => {
  it.each([
    ['no kind', { token: TOKEN }],
    ['an unknown kind', { kind: 'admin', token: TOKEN }],
    ['no token', { kind: 'client' }],
    ['a malformed token', { kind: 'client', token: 'short' }],
  ])('shows only a neutral message for %s', async (_label, params) => {
    const text = textOf(await render(params));
    expect(text).toContain('Incomplete Invitation Link');
    expect(text).not.toContain('Create an Account');
    // Nothing that is not even a well-formed link is looked up.
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('asks a client to use the invited email and returns them to the invitation after sign-in', async () => {
    const html = await render({ kind: 'client', token: TOKEN });
    expect(textOf(html)).toContain('Use the email address that received this invitation.');
    const next = encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN}`);
    expect(html).toContain(`href="/auth/sign-up?next=${next}"`);
    expect(html).toContain(`href="/auth/sign-in?next=${next}"`);
  });

  it('opens nothing by visiting: it says so, and shows no email address', async () => {
    const text = textOf(await render({ kind: 'client', token: TOKEN }));
    expect(text).toContain('Opening the link does not accept it.');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('never sends the link, token included, to another site as a referrer', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });

  it('leaves team and sharing invitations on their own generic pages and never looks them up', async () => {
    for (const [kind, heading] of [
      ['team', 'Join an Agency Team'],
      ['sharing', 'Review Shared Access'],
    ] as const) {
      const document = new JSDOM(await render({ kind, token: TOKEN })).window.document;
      expect(document.querySelector('h1')?.textContent).toBe(heading);
    }
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

describe('the client invitation page before sign-in (growth loop 1, Option B)', () => {
  const TOKEN2 = `${'Ab3_'.repeat(10)}Ab3`;
  const EXPIRES = new Date(Date.now() + 6.5 * 24 * 60 * 60 * 1000);

  const view = (overrides: Record<string, unknown> = {}) => ({
    agencyName: 'Acme Visas',
    verified: true,
    accentColor: '#1a4f8b',
    logoVersion: 'abc123',
    grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
    expiresAt: EXPIRES,
    ...overrides,
  });

  async function show(token: string = TOKEN2) {
    const html = renderToStaticMarkup(
      await InvitationPage({ searchParams: Promise.resolve({ kind: 'client', token }) }),
    );
    const document = new JSDOM(html).window.document;
    return { html, document, text: document.body.textContent ?? '' };
  }

  it('names the agency and shows the terms before the buttons that create or sign in', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { document, text } = await show();
    expect(mocks.load).toHaveBeenCalledWith(TOKEN2);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')?.textContent).toBe('Acme Visas Invited You');
    expect(text).toContain('An administrator at Acme Visas invited you');
    expect(text).toContain('Opening the link does not accept it');

    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['What Acme Visas Could Do', 'What You Control']);
    for (const sentence of [
      'See the details on the profile you choose',
      'Open previews of the documents on that profile',
      'Leave comments on your case',
      'Suggest changes to your profile. Nothing changes until you approve it',
      'Run your case: assign their own staff, add case notes and ask you for documents',
      'They could not download your original files',
      'You choose which of your profiles this applies to, or start a new one.',
      'Nothing is shared until you accept.',
      'You can stop sharing at any time.',
      'This invitation expires in 6 days, on ',
      'A complete checklist, or a file marked ready, is not an approval.',
    ]) {
      expect(text, sentence).toContain(sentence);
    }
    // The terms come first; the account buttons come after them.
    const create = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'Create an Account',
    );
    const terms = document.querySelector('.invitation-terms-list');
    expect(create).toBeDefined();
    expect(terms && create && terms.compareDocumentPosition(create) & 4).toBeTruthy();
    expect(create?.getAttribute('href')).toContain(
      encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN2}`),
    );
    expect(document.querySelectorAll('ol.auth-steps li')).toHaveLength(3);
  });

  it('shows the logo and accent of a reviewed agency, from this invitation only', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { html, document } = await show();
    const image = document.querySelector('img.agency-mark-image');
    expect(image?.getAttribute('src')).toBe(
      `/api/branding/invitation-logo?token=${TOKEN2}&v=abc123`,
    );
    expect(html).toContain('--agency-accent:#1a4f8b');
    expect(document.body.textContent).toContain('Powered by VisaStack');
  });

  it('shows an agency VisaStack has not reviewed by name only, says it cannot be accepted yet, and offers no sign-up', async () => {
    mocks.load.mockResolvedValue({
      state: 'open',
      view: view({ verified: false, accentColor: '#aa0000', logoVersion: 'zzz' }),
    });
    const { html, document, text } = await show();
    expect(document.querySelector('h1')?.textContent).toBe('This Agency Is Still Being Reviewed');
    expect(text).toContain('Acme Visas');
    expect(text).toContain('VisaStack has not finished reviewing them');
    expect(text).toContain('Nothing has been shared');
    // Never dressed as a reviewed agency, even if it set a colour and a logo.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.agency-mark')).toBeNull();
    expect(document.querySelector('.invite-brand')).toBeNull();
    expect(html).not.toContain('--agency-accent');
    expect(html).not.toContain('invitation-logo');
    expect(text).not.toContain('Powered by VisaStack');
    // No terms and no way to start an account for something that cannot be accepted yet.
    expect(text).not.toContain('Could Do');
    expect(document.querySelector('a[href^="/auth/"]')).toBeNull();
  });

  it('says the same thing for every link that is not open, and shows no agency or terms', async () => {
    mocks.load.mockResolvedValue({ state: 'closed' });
    const first = await show();
    // A second link, however it came to be closed, renders exactly the same page.
    const second = await show(`${'Zz9-'.repeat(10)}Zz9`);
    expect(second.html).toBe(first.html);
    expect(first.document.querySelector('h1')?.textContent).toBe(
      'This Invitation Is No Longer Open',
    );
    expect(first.text).toContain('ask the agency that invited you to send a new one');
    expect(first.text).not.toContain('Acme');
    expect(first.text).not.toContain('Could Do');
    // Someone who already accepted is sent to sign in, not told to ask the agency to start again.
    expect(first.text).toContain('If you already accepted it, sign in to find your case');
    const links = [...first.document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/auth/sign-in?next=%2Fapp');
    expect(links.some((href) => href?.startsWith('/auth/sign-up'))).toBe(false);
  });

  it('carries nothing about the person invited, the sender or the link into the page', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { html } = await show();
    // The token may appear only in the sign-in return address and the logo address.
    const withoutToken = html.split(TOKEN2).join('').split(encodeURIComponent(TOKEN2)).join('');
    for (const secret of ['Jane', 'Traveller', '@', 'UK Standard']) {
      expect(withoutToken, secret).not.toContain(secret);
    }
  });

  it('falls back to the plain handoff, still saying nothing is accepted, when the lookup fails or the address is busy', async () => {
    for (const state of ['unavailable', 'busy']) {
      mocks.load.mockResolvedValue({ state });
      const { document, text } = await show();
      expect(document.querySelector('h1')?.textContent).toBe('Work with an Agency');
      expect(text).toContain('Opening the link does not accept it');
      expect(text).not.toContain('Acme');
      expect(document.querySelector('a[href^="/auth/sign-up"]')).not.toBeNull();
    }
  });

  it('falls back to the plain handoff when the access has a kind the terms cannot describe', async () => {
    mocks.load.mockResolvedValue({
      state: 'open',
      view: view({ grantActions: [...DEFAULT_CLIENT_GRANT_ACTIONS, 'DOWNLOAD_ORIGINAL'] }),
    });
    const { document } = await show();
    expect(document.querySelector('h1')?.textContent).toBe('Work with an Agency');
    expect(document.body.textContent).not.toContain('Could Do');
  });
});
