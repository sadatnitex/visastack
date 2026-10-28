import { DEFAULT_CLIENT_GRANT_ACTIONS } from '@visastack/services';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ load: vi.fn(), signedIn: vi.fn() }));
vi.mock('../../lib/invitation-preview', () => ({ loadClientInvitationPage: mocks.load }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: mocks.signedIn }));

const { default: InvitationPage, metadata } = await import('./page');

const TOKEN = 'a'.repeat(43);
const render = (searchParams: { kind?: string; token?: string }) =>
  renderServer(InvitationPage({ searchParams: Promise.resolve(searchParams) }));

/** The "Not you?" line: a form, not a link, that names this kind and this link only. */
function expectSwitch(document: Document, kind: string, token: string = TOKEN) {
  const form = document.querySelector('form.invitation-switch');
  expect(form?.textContent).toContain('Not you?');
  expect(form?.querySelector('button[type="submit"]')?.textContent).toBe(
    'Sign In with the Invited Email Address',
  );
  expect(form?.querySelector<HTMLInputElement>('input[name="kind"]')?.value).toBe(kind);
  expect(form?.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe(token);
}

// Until a test says otherwise the lookup is not available, so the page is the plain handoff it was.
beforeEach(() => {
  mocks.load.mockReset();
  mocks.load.mockResolvedValue({ state: 'unavailable' });
  mocks.signedIn.mockReset();
  mocks.signedIn.mockResolvedValue(false);
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
    expect(text).toContain('Ask the person who invited you for a new link.');
    expect(text).not.toContain('Create an Account');
    // Nothing that is not even a well-formed link is looked up, not even the visitor's session.
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.signedIn).not.toHaveBeenCalled();
  });

  it('asks a client to use the invited email and returns them to the invitation after sign-in', async () => {
    const html = await render({ kind: 'client', token: TOKEN });
    expect(textOf(html)).toContain(
      'Create an account or sign in with the email address that received this invitation.',
    );
    const next = encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN}`);
    expect(html).toContain(`href="/auth/sign-up?next=${next}"`);
    expect(html).toContain(`href="/auth/sign-in?next=${next}"`);
  });

  it('opens nothing by visiting: it says so, and shows no email address', async () => {
    const text = textOf(await render({ kind: 'client', token: TOKEN }));
    expect(text).toContain('Opening this link accepts nothing. You decide after you review.');
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

  it('keeps every fact of each kind of invitation on its page', async () => {
    const facts = {
      team: [
        'An agency invited you to join their team on VisaStack.',
        'You will see the agency and your role before joining.',
      ],
      sharing: [
        'You were invited to access part of a VisaStack profile.',
        'Review the purpose, permissions and expiry before accepting.',
        'No access is active until you agree.',
      ],
      client: [
        'An agency wants to work on your visa case with you.',
        'You will see the agency and the access they ask for.',
        'You choose your own profile and confirm sharing before connecting.',
      ],
    } as const;
    for (const [kind, lines] of Object.entries(facts)) {
      const text = textOf(await render({ kind, token: TOKEN }));
      for (const line of [
        ...lines,
        'Opening this link accepts nothing. You decide after you review.',
        'Create an account or sign in with the email address that received this invitation.',
        'Already signed in? Review Your Invitation',
        'If you reset your password, open this invitation link again afterwards.',
        'Invitations expire after 7 days. If this one has expired or was revoked, ask the sender for a new invitation.',
      ]) {
        expect(text, `${kind}: ${line}`).toContain(line);
      }
    }
  });

  it('shows the three steps on one list, Title Case, with exactly the current one marked', async () => {
    const document = new JSDOM(await render({ kind: 'team', token: TOKEN })).window.document;
    const steps = document.querySelector('ol.invitation-steps');
    expect(steps?.getAttribute('aria-label')).toBe('What Happens Next');
    const items = [...(steps?.querySelectorAll('li') ?? [])];
    expect(items.map((li) => li.textContent?.replace(/^\d/, ''))).toEqual([
      'Sign In',
      'Review',
      'Decide',
    ]);
    expect(steps?.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(items[0]?.getAttribute('aria-current')).toBe('step');
    // The numbers are drawn for sight; the ordered list already gives them to a screen reader.
    expect(items[0]?.querySelector('.invitation-step-mark')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('puts the main action at the top: the hero buttons come before every detail', async () => {
    const document = new JSDOM(await render({ kind: 'client', token: TOKEN })).window.document;
    const hero = document.querySelector('.invitation-hero');
    const create = hero?.querySelector('a.btn-primary');
    expect(create?.textContent).toBe('Create an Account to Review');
    expect(hero?.querySelector('a.btn-secondary')?.textContent).toBe('Sign In');
    const details = document.querySelector('.invitation-details');
    expect(details && create && create.compareDocumentPosition(details) & 4).toBeTruthy();
    // Without scripts only the hero buttons exist: the pinned copy is added in the browser.
    expect(document.querySelector('.invitation-sticky')).toBeNull();
    // Nobody is signed in, so there is no account to switch from.
    expect(document.querySelector('form.invitation-switch')).toBeNull();
  });

  it('reads the session while the link is being looked up, not after', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.load.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = render({ kind: 'client', token: TOKEN });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.signedIn).toHaveBeenCalledTimes(1);
    finish({ state: 'unavailable' });
    expect(textOf(await pending)).toContain('Work with an Agency');
  });

  it('sends a visitor who is already signed in straight to the review of their own kind', async () => {
    mocks.signedIn.mockResolvedValue(true);
    for (const [kind, path] of [
      ['team', '/app/invitations/accept'],
      ['client', '/app/client-invitations/accept'],
      ['sharing', '/app/sharing-invitations/accept'],
    ] as const) {
      const document = new JSDOM(await render({ kind, token: TOKEN })).window.document;
      const primary = document.querySelector('.invitation-hero a.btn-primary');
      expect(primary?.textContent).toBe('Review Your Invitation');
      expect(primary?.getAttribute('href')).toBe(`${path}?token=${TOKEN}`);
      expect(document.querySelector('a[href^="/auth/"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Already signed in?');
      // Signing in is done, so the review is the step they are on.
      const current = document.querySelector('ol.invitation-steps [aria-current="step"]');
      expect(current?.textContent).toContain('Review');
      expect(document.querySelector('ol.invitation-steps li')?.textContent).toContain('(Done)');
      // Signed in with another account? One quiet way to switch, back to this same invitation.
      expectSwitch(document, kind);
    }
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
    expect(text).toContain('Acme Visas wants to work on your visa case with you.');
    expect(text).toContain('An administrator at Acme Visas invited you');
    expect(text).toContain('Opening this link accepts nothing. You decide after you review.');

    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual([
      'They Could',
      'They Could Not',
      'You Stay in Control',
      'Before You Start',
    ]);
    for (const sentence of [
      'See the details on the profile you choose',
      'Open previews of the documents on that profile',
      'Leave comments on your case',
      'Suggest changes to your profile. Nothing changes until you approve it',
      'Run your case: assign their own staff, add case notes and ask you for documents',
      'Download your original files',
      'Export your profile',
      'Share your records with anyone else',
      'Approve changes to your profile for you',
      'Each of these would need a separate choice from you.',
      'You choose which of your profiles this applies to, or start a new one.',
      'Nothing is shared until you accept.',
      'You can stop sharing at any time.',
      'Create an account or sign in with the email address that received this invitation.',
      'Already signed in? Review Your Invitation',
      'If you reset your password, open this invitation link again afterwards.',
      'A complete checklist, or a file marked ready, is not an approval. Only the embassy or visa office decides.',
    ]) {
      expect(text, sentence).toContain(sentence);
    }
    // Each permission is its own item, with a decorative mark only.
    expect(document.querySelectorAll('.invitation-marked-check li')).toHaveLength(5);
    expect(document.querySelectorAll('.invitation-marked-close li')).toHaveLength(4);
    for (const icon of document.querySelectorAll('.invitation-marked svg')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    // The expiry sits in the hero as a badge, with the exact moment for machines.
    const expiry = document.querySelector('.invitation-hero .badge time');
    expect(expiry?.textContent).toMatch(/^Expires \d{1,2} [A-Z][a-z]{2} \d{4}, 6 Days Left$/);
    expect(expiry?.getAttribute('dateTime') ?? expiry?.getAttribute('datetime')).toBe(
      EXPIRES.toISOString(),
    );
    // The main action is at the top, after the agency and the promise, before the terms.
    const hero = document.querySelector('.invitation-hero');
    const create = hero?.querySelector('a.btn-primary');
    expect(create?.textContent).toBe('Create an Account to Review');
    const brand = hero?.querySelector('.invite-brand');
    const terms = document.querySelector('.invitation-terms');
    expect(brand && create && brand.compareDocumentPosition(create) & 4).toBeTruthy();
    expect(terms && create && create.compareDocumentPosition(terms) & 4).toBeTruthy();
    expect(create?.getAttribute('href')).toContain(
      encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN2}`),
    );
    expect(document.querySelectorAll('ol.invitation-steps li')).toHaveLength(3);
    // The not-an-approval note is the last thing on the page.
    expect(document.querySelector('.invitation-details')?.lastElementChild?.className).toBe(
      'invitation-legal',
    );
  });

  it('offers a signed-in visitor the review itself, at the top', async () => {
    mocks.load.mockResolvedValue({ state: 'open', view: view() });
    mocks.signedIn.mockResolvedValue(true);
    const { document } = await show();
    const primary = document.querySelector('.invitation-hero a.btn-primary');
    expect(primary?.textContent).toBe('Review Your Invitation');
    expect(primary?.getAttribute('href')).toBe(`/app/client-invitations/accept?token=${TOKEN2}`);
    expect(document.querySelector('a[href^="/auth/"]')).toBeNull();
    expectSwitch(document, 'client', TOKEN2);
    expect(document.body.textContent).toContain(
      'Use the email address that received this invitation.',
    );
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
    expect(text).not.toContain('They Could');
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
    expect(first.text).not.toContain('They Could');
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
      expect(text).toContain('Opening this link accepts nothing');
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
    expect(document.body.textContent).not.toContain('They Could');
  });
});
