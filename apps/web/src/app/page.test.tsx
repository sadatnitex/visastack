import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const betaState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => betaState.value }));

const signedInState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => signedInState.value }));

const { default: HomePage } = await import('./page');

const render = async (searchParams: { auth_error?: string } = {}) =>
  renderServer(HomePage({ searchParams: Promise.resolve(searchParams) }));

/** The eight chapters of the approved reference, in order (R1, owner 18 Nov 2026). */
const CHAPTERS = [
  'One record.',
  'Add it once.',
  'Ready for',
  'Know where',
  'You decide',
  'Every rule shows',
  'Built for',
  'Start with',
] as const;

describe('the public home page (R1, the approved reference)', () => {
  it('tells the eight chapters in order and nothing else between them', async () => {
    const html = await render();
    const at = CHAPTERS.map((words) => html.indexOf(words));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // One top heading, and one second-level heading for each of the seven other chapters.
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/<h2[ >]/g)).toHaveLength(7);
    expect(html.match(/data-scene="/g)).toHaveLength(5);
  });

  it('opens with the record promise, the plain line and today’s buttons', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('One record.');
    expect(text).toContain('Every visa.');
    expect(text).toContain(
      'Keep your passport, photos and papers in one private place. Reuse them for every trip.',
    );
    expect(text).toContain('Invite-Only Pilot');
    expect(html).toMatch(
      /<a class="pub-button pub-button-primary" href="\/app">Sign in to get started/,
    );
    expect(html).toMatch(/<a [^>]*href="\/status"[^>]*>See What Works Today/);
  });

  it('leaves out everything the old page had', async () => {
    const html = await render();
    const text = textOf(html);
    for (const gone of [
      'A clean file you can stand behind.',
      'Which Country Do You Want to Visit?',
      'Stop starting from zero.',
      'Without One Profile',
      'Ayesha',
      'class="c1-',
      'land-group',
      'land-hero-title',
    ]) {
      expect(html + text, gone).not.toContain(gone);
    }
    expect(html).not.toContain('<details');
  });

  it('says every drawn figure is an example, and readiness is completeness never approval', async () => {
    const html = await render();
    const text = textOf(html);
    expect(html.match(/class="pub-example"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(text).toContain('Example. Completeness only. Not an approval.');
    expect(text).toContain('Example record.');
    expect(text).toContain('Completeness only. Not an approval.');
    expect(text).toContain('Example names and counts.');
  });

  it('keeps the truthful words apart: Suggested is not Confirmed, Saved is not Shared', async () => {
    const text = textOf(await render());
    expect(text).toContain('Suggested');
    expect(text).toContain('Confirmed');
    expect(text).toContain('Nothing is saved as true until you say so.');
    expect(text).toContain('Not Shared');
    expect(text).toContain('Access Ended');
    expect(text).not.toMatch(/\bReviewed\b/);
  });

  it('names the stages with the product’s own words and says who acts', async () => {
    const text = textOf(await render());
    for (const stage of [
      'Getting Started',
      'Gathering Documents',
      'Being Checked',
      'Needs You',
      'Submitted',
      'Closed',
    ]) {
      expect(text).toContain(stage);
    }
    expect(text).toContain('Illustration. Stages follow each real case.');
  });

  it('never promises what the product does not do', async () => {
    const text = textOf(await render()).toLowerCase();
    for (const overclaim of [
      'guarantee',
      'bank-grade',
      'unhackable',
      '100% secure',
      'nobody sees',
      'verified booking',
      'certified copy',
      'boarding pass',
      'approved',
      'we decide',
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
      /\bmission/i,
    ]) {
      expect(text, String(jargon)).not.toMatch(jargon);
    }
  });

  it('keeps today’s sign-in flow: open registration leads to sign-up and says Free Public Beta', async () => {
    betaState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Free Public Beta');
      expect(text).toContain('Create your free account');
      expect(text).not.toContain('Invite-Only Pilot');
      // Two buttons lead to sign-up: the first chapter and the closing band.
      expect(html.match(/href="\/auth\/sign-up"/g)).toHaveLength(2);
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

  it('sends a visitor to sign in twice, to see what works today twice and to For Agencies once', async () => {
    const html = await render();
    expect(html.match(/href="\/app"/g)).toHaveLength(2);
    expect(html.match(/href="\/status"/g)).toHaveLength(2);
    expect(html.match(/href="\/for-agencies"/g)).toHaveLength(1);
  });

  it('shows no sign-in wording to someone who is already signed in', async () => {
    signedInState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Open your workspace');
      expect(text).not.toContain('Sign in to get started');
      expect(html.match(/href="\/app"/g)).toHaveLength(2);
    } finally {
      signedInState.value = false;
    }
  });

  it('starts the scroll engine, or the pictures never move (the page lost it once in the rebuild)', () => {
    const story = readFileSync(join(__dirname, 'home-story.tsx'), 'utf8');
    expect(story).toContain(
      "import { ScenesRuntime } from '../components/public-site/scenes-runtime';",
    );
    expect(story).toContain('<ScenesRuntime />');
  });

  it('shows the real Bangladesh passport cover from this site, with no outside or inline picture', async () => {
    const html = await render();
    expect(html).toContain('src="/pictures/passport-bd.png"');
    expect(html).not.toMatch(/src="(?:https?:)?\/\//);
    expect(html).not.toMatch(/src="(?:data|blob):/);
    expect(html).not.toMatch(/ style=/);
  });
});
