import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const betaState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => betaState.value }));

const signedInState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => signedInState.value }));

const { default: HomePage } = await import('./page');

const render = async (searchParams: { auth_error?: string } = {}) =>
  renderServer(HomePage({ searchParams: Promise.resolve(searchParams) }));

describe('the public home page (Harbor C1, WP-L1)', () => {
  it('says each promise once instead of repeating the same list', async () => {
    const text = textOf(await render());
    const count = (needle: string) => text.split(needle).length - 1;
    expect(count('Enter your details once and reuse them everywhere')).toBe(1);
    expect(count('Less paperwork. More control.')).toBe(1);
  });

  it('labels the drawn interface as sample information', async () => {
    const html = await render();
    expect(textOf(html)).toContain('Illustrative interface · Sample information');
    expect(textOf(html)).toContain('Ayesha’s record · Example');
    expect(html).toContain('aria-label="Illustrative interface with sample information"');
  });

  it('says what the product is for in everyday words', async () => {
    const text = textOf(await render());
    expect(text).toContain('Your documents.');
    expect(text).toContain('Ready when you are.');
    expect(text).toContain('Invite-Only Pilot');
    expect(text).toContain(
      'Keep a reusable travel record, prepare your next application and share only what you choose.',
    );
    expect(text).toContain('One personal record. Separate cases. Explicit sharing.');
    for (const title of [
      'Keep the details.',
      'See exactly',
      'Share the part.',
      'Yesterday stays',
    ]) {
      expect(text).toContain(title);
    }
  });

  it('only claims what has shipped (claim register CL06, CL08, CL10, D5)', async () => {
    const text = textOf(await render());
    // CL08: comparing versions and reuse in a new case have not shipped yet.
    expect(text).toContain('Find your current documents and see their earlier versions.');
    expect(text).not.toContain('compare earlier versions');
    expect(text).not.toContain('reuse the right information in a new case');
    // D5: Prepare again has not shipped, so its card is replaced by the expiry reminder.
    expect(text).not.toContain('Prepared again, faster');
    expect(text).toContain('Reminder Before It Expires');
    // D5: the phone's bottom tab is the Record, not Documents.
    expect(text).toContain('▤ Record');
    // CL10: the access end date is optional.
    expect(text).toContain('if you want, set an access end date');
    // CL12.
    expect(text).toContain('Privacy and sharing are governed by actual product permissions.');
  });

  it('is honest that this is a private pilot with some features not switched on', async () => {
    const text = textOf(await render());
    expect(text).toContain('some features are still being switched on');
    expect(text).toContain('some features are not switched on yet');
    expect(text).toContain('made-up details');
  });

  it('never promises what the product does not do', async () => {
    const text = textOf(await render()).toLowerCase();
    // Readiness is how complete a file is, never a prediction.
    expect(text).toContain('never a guess at your chances of approval');
    for (const overclaim of [
      'guarantee',
      'bank-grade',
      'unhackable',
      '100% secure',
      'bangla',
      'nobody sees',
      'every action',
      'use everything',
      'verified booking',
      'certified copy',
      'boarding pass',
    ]) {
      expect(text, overclaim).not.toContain(overclaim);
    }
  });

  it('leaves out the tools and the engineering behind it', async () => {
    const text = textOf(await render());
    for (const jargon of [
      /Technical Preview/,
      /Vercel/,
      /\bNeon\b/,
      /Universal Core/,
      /\bports?\b/i,
      /Harbor/,
    ]) {
      expect(text, String(jargon)).not.toMatch(jargon);
    }
  });

  it('sends a visitor to sign in and to see what works today', async () => {
    const html = await render();
    expect(html).toMatch(/<a class="c1-pill" href="\/app">Sign in to get started/);
    expect(html.match(/href="\/app"/g)?.length).toBe(2);
    expect(html.match(/href="\/status"/g)?.length).toBe(3);
    for (const id of ['capabilities', 'for-agencies', 'land-how-title', 'how-it-works', 'product'])
      expect(html).toContain(`id="${id}"`);
  });

  it('uses the open-registration flag and states the at-your-own-risk terms plainly', async () => {
    betaState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Free Public Beta');
      expect(text).toContain('Create your free account');
      expect(text).toContain('Registration is open for public beta');
      expect(text).toContain('free to use at your own risk');
      expect(text).toContain('virus scanning of uploads');
      expect(text).not.toContain('Real applicant details are not accepted yet');
      expect(text).not.toContain('private pilot for invited users');
      expect(text).not.toContain('VisaStack is in a private pilot');
      expect(html.match(/href="\/auth\/sign-up"/g)?.length).toBe(2);
    } finally {
      betaState.value = false;
    }
  });

  it('shows a way forward when a sign-in did not complete, quoting the reference', async () => {
    const html = await render({ auth_error: 'ref-1234' });
    expect(html).toContain('role="alert"');
    const text = textOf(html);
    expect(text).toContain('Sign-in didn’t complete. Please try again.');
    expect(text).toContain('contact support and quote reference ref-1234');
  });

  it('shows no sign-in notice on an ordinary visit', async () => {
    expect(await render()).not.toContain('role="alert"');
  });

  it('tells the story in order, from the product to the closing call to action', async () => {
    const html = await render();
    const order = [
      'Ready when you are.',
      'Less paperwork. More control.',
      'Every visa starts with the same scramble',
      'Three Simple Steps',
      'Switched On Step by Step',
      'Calmer for the traveller, clearer for the agency',
      'How VisaStack Treats Your Information',
      'Honest about where we are',
      'Stop starting from zero.',
    ].map((heading) => html.indexOf(heading));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows the before and after', async () => {
    const text = textOf(await render());
    expect(text).toContain('Without one profile');
    expect(text).toContain('With VisaStack');
  });

  it('is honest that the longer-term direction is an aim, not a promise', async () => {
    const text = textOf(await render());
    expect(text).toContain('We are working toward');
    expect(text).toContain('The status page shows exactly what works today');
  });

  it('gives every section a name for screen readers and keeps one top heading', async () => {
    const html = await render();
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html.match(/<section[^>]*aria-labelledby="land-[a-z-]+"/g)?.length).toBe(9);
    expect(html).toContain('id="land-hero-title"');
  });

  it('shows no sign-in wording to someone who is already signed in', async () => {
    signedInState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Open your workspace');
      expect(text).not.toContain('Sign in to get started');
      expect(html.match(/href="\/app"/g)?.length).toBe(2);
    } finally {
      signedInState.value = false;
    }
  });
});
