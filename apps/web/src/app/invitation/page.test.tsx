import { DEFAULT_CLIENT_GRANT_ACTIONS } from '@visastack/services';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../lib/invitation-preview', () => ({ loadClientInvitationPage: mocks.load }));

const { default: Invitation } = await import('./page');

const TOKEN = `${'Ab3_'.repeat(10)}Ab3`;
const EMAIL = 'jane.private@example.com';
const EXPIRES = new Date('2026-11-03T14:30:00.000Z');

const view = (overrides: Record<string, unknown> = {}) => ({
  agencyName: 'Acme Visas',
  verified: true,
  accentColor: '#1a4f8b',
  logoVersion: 'abc123',
  grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
  expiresAt: EXPIRES,
  ...overrides,
});

async function render(kind: string, token: string = TOKEN) {
  const html = renderToStaticMarkup(
    await Invitation({ searchParams: Promise.resolve({ kind, token }) }),
  );
  const document = new JSDOM(html).window.document;
  return { html, document, text: document.body.textContent ?? '' };
}

beforeEach(() => mocks.load.mockReset());

describe('the client invitation page before sign-in', () => {
  it('names the agency and shows the terms before the buttons that create or sign in', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { document, text } = await render('client');
    expect(mocks.load).toHaveBeenCalledWith(TOKEN);
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
      'This invitation expires on 3 Nov 2026, 14:30 UTC.',
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
      encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN}`),
    );
    expect(document.querySelectorAll('ol.auth-steps li')).toHaveLength(3);
  });

  it('shows the logo and accent of a reviewed agency, from this invitation only', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { html, document } = await render('client');
    const image = document.querySelector('img.agency-mark-image');
    expect(image?.getAttribute('src')).toBe(`/invitation/logo?token=${TOKEN}&v=abc123`);
    expect(html).toContain('--agency-accent:#1a4f8b');
    expect(document.body.textContent).toContain('Powered by VisaStack');
    expect(document.body.textContent).not.toContain('has not reviewed this agency');
  });

  it('shows an agency VisaStack has not reviewed by name only, says it cannot be accepted yet, and offers no sign-up', async () => {
    mocks.load.mockResolvedValue({
      state: 'open',
      view: view({ verified: false, accentColor: '#aa0000', logoVersion: 'zzz' }),
    });
    const { html, document, text } = await render('client');
    expect(document.querySelector('h1')?.textContent).toBe('This Agency Is Still Being Reviewed');
    expect(text).toContain('Acme Visas');
    expect(text).toContain('VisaStack has not finished reviewing them');
    expect(text).toContain('Nothing has been shared');
    // Never dressed as a reviewed agency, even if it set a colour and a logo.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.agency-mark')).toBeNull();
    expect(document.querySelector('.invite-brand')).toBeNull();
    expect(html).not.toContain('--agency-accent');
    expect(html).not.toContain('/invitation/logo');
    expect(text).not.toContain('Powered by VisaStack');
    // No terms and no way to start an account for something that cannot be accepted yet.
    expect(text).not.toContain('Could Do');
    expect(document.querySelector('a[href^="/auth/"]')).toBeNull();
  });

  it('says the same thing for every link that is not open, and shows no terms or buttons', async () => {
    mocks.load.mockResolvedValue({ state: 'closed' });
    const first = await render('client');
    // A second link, however it came to be closed, renders exactly the same page.
    mocks.load.mockResolvedValue({ state: 'closed' });
    const second = await render('client', `${'Zz9-'.repeat(10)}Zz9`);
    expect(second.html).toBe(first.html);
    expect(first.document.querySelector('h1')?.textContent).toBe(
      'This Invitation Is No Longer Open',
    );
    expect(first.text).toContain('Ask the agency that invited you to send a new one');
    expect(first.document.querySelector('a[href^="/auth/"]')).toBeNull();
    expect(first.text).not.toContain('Acme');
  });

  it('carries nothing about the person invited, the sender or the link into the page', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    const { html } = await render('client');
    // The only place the token may appear is the sign-in return address and the logo address.
    const withoutToken = html.split(TOKEN).join('').split(encodeURIComponent(TOKEN)).join('');
    for (const secret of [EMAIL, 'Jane', 'Traveller', '@', 'UK Standard']) {
      expect(withoutToken, secret).not.toContain(secret);
    }
  });

  it('asks the visitor to try again later when the address has looked at too many links', async () => {
    mocks.load.mockResolvedValue({ state: 'busy' });
    const { document, text } = await render('client');
    expect(document.querySelector('h1')?.textContent).toBe('Please Try Again Shortly');
    expect(text).not.toContain('Acme');
    expect(document.querySelector('a[href^="/auth/"]')).toBeNull();
  });

  it('falls back to the plain handoff, still saying nothing is accepted, if the lookup fails', async () => {
    mocks.load.mockResolvedValue({ state: 'unavailable' });
    const { document, text } = await render('client');
    expect(document.querySelector('h1')?.textContent).toBe('Work with an Agency');
    expect(text).toContain('Opening the link does not accept it');
    expect(document.querySelector('a[href^="/auth/sign-up"]')).not.toBeNull();
  });

  it('falls back to the plain handoff when the access has a kind the terms cannot describe', async () => {
    mocks.load.mockResolvedValue({
      state: 'open',
      view: view({ grantActions: [...DEFAULT_CLIENT_GRANT_ACTIONS, 'DOWNLOAD_ORIGINAL'] }),
    });
    const { document } = await render('client');
    expect(document.querySelector('h1')?.textContent).toBe('Work with an Agency');
    expect(document.body.textContent).not.toContain('Could Do');
  });

  it('leaves team and sharing invitations on their own generic pages and never looks them up', async () => {
    for (const [kind, heading] of [
      ['team', 'Join an Agency Team'],
      ['sharing', 'Review Shared Access'],
    ] as const) {
      const { document } = await render(kind);
      expect(document.querySelector('h1')?.textContent).toBe(heading);
    }
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('does not look anything up for a link that is not even well formed', async () => {
    const { document } = await render('client', 'short');
    expect(document.querySelector('h1')?.textContent).toBe('Incomplete Invitation Link');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
