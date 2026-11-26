import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const betaState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => betaState.value }));

const signedInState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => signedInState.value }));

const { default: HomePage } = await import('./page');

afterEach(() => vi.unstubAllEnvs());

const render = async (searchParams: { auth_error?: string } = {}) =>
  renderServer(HomePage({ searchParams: Promise.resolve(searchParams) }));

/** The sections of the approved homepage, in order (LAND1, owner 26 Nov 2026), by a phrase of each. */
const SECTIONS = [
  'Your visa paperwork',
  'Your Starting Plan',
  'Start from the official source',
  'See what’s ready.',
  'Give your next trip a head start.',
  'One request link. A clearer case file.',
  'Before you begin',
  'Where’s your next trip?',
] as const;

describe('the public home page (LAND1, the approved homepage)', () => {
  it('tells the sections in order: first screen, plan, sources, case, record, agencies, questions, close', async () => {
    const html = await render();
    const at = SECTIONS.map((words) => html.indexOf(words));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // One top heading; second-level headings for the plan, the case, the record, the agencies, the
    // questions and the close.
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/<h2[ >]/g)).toHaveLength(6);
  });

  it('keeps every inbound Home anchor and the sections the new menus point at', async () => {
    const html = await render();
    for (const id of [
      'planner',
      'prepare',
      'your-record',
      'for-agencies',
      'questions',
      // Older inbound links, mapped to the section that tells the same story now.
      'how-it-works',
      'capabilities',
      'sources',
      'start',
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  it('opens with the Bangladesh promise, the plain line and a labelled destination picker', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('For travellers applying from Bangladesh');
    expect(text).toContain('Your visa paperwork, in order.');
    expect(text).toContain(
      'Check official sources, organise a case for yourself or your family, and share only the documents you choose.',
    );
    expect(html).toMatch(/<label for="lp-destination">Where are you going\?<\/label>/);
    expect(text).toContain('Start without an account.');
    expect(html).toMatch(/<a [^>]*href="\/countries"[^>]*>Browse All Country Guides/);
  });

  it('offers the suggested destinations by their catalogue names, and a plain GET to the guides as the no-script path', async () => {
    const html = await render();
    expect(html).toMatch(/<form[^>]*id="planner"[^>]*action="\/countries"[^>]*method="get"/);
    const select = html.match(/<select[^>]*name="q"[^>]*>([\s\S]*?)<\/select>/);
    expect(select).not.toBeNull();
    expect(select?.[0]).toContain(' required=""');
    const options = [...(select?.[1] ?? '').matchAll(/<option[^>]*value="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(options).toEqual([
      '',
      'Japan',
      'Singapore',
      'United Kingdom',
      'Canada',
      'Germany',
      'Australia',
    ]);
    // The placeholder cannot be chosen: an empty destination never opens a plan.
    expect(select?.[1]).toMatch(/<option value="" disabled=""[^>]*>Choose a destination/);
  });

  it('keeps the plan closed until a destination is chosen, with its steps and a guide button ready', async () => {
    const html = await render();
    expect(html).toMatch(/<section class="lp-start" hidden="" aria-labelledby="lp-start-title">/);
    const text = textOf(html);
    expect(text).toContain('Your first steps');
    expect(text).toContain('Find the official source');
    expect(text).toContain('Check your saved copies');
    expect(text).toContain('Decide how you’ll prepare');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/<a class="lp-button lp-primary" href="\/countries">Open Country Guide/);
    expect(html).toMatch(/<output class="lp-sr">/);
    // Route-specific requirements stay in the guides: the plan only opens them.
    expect(text).toContain(
      'Confirm the current requirements for your trip with the issuing authority.',
    );
  });

  it('draws the one folio picture from this site, decorative, sized, first in line, with its caption as real text', async () => {
    const html = await render();
    const image = html.match(/<img[^>]*visa-record-folio[^>]*>/)?.[0] ?? '';
    expect(image).toContain('alt=""');
    expect(image).toContain('width="1100"');
    expect(image).toContain('height="1375"');
    expect(image).toContain('fetchPriority="high"');
    expect(image).toContain(
      'sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1340px) 42vw, 550px"',
    );
    expect(image).toContain('src="/_next/image?url=%2Flanding%2Fvisa-record-folio.webp');
    // The one preload in the head is the folio's: the small flag is told to wait.
    const preloads = html.match(/<link rel="preload" as="image"[^>]*>/g) ?? [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('visa-record-folio');
    expect(html.match(/fetchPriority="high"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('One record for this trip and the next.');
    expect(html).not.toMatch(/src="(?:https?:)?\/\/(?!\/)/);
    expect(html).not.toMatch(/src="(?:data|blob):/);
  });

  it('shows the family case as an example, with its three items in one accordion and the first open', async () => {
    const html = await render();
    expect(html.match(/<details name="lp-case"/g)).toHaveLength(3);
    expect(html.match(/<details name="lp-case" open=""/g)).toHaveLength(1);
    const text = textOf(html);
    expect(text).toContain('Preparing a family visit');
    expect(text).toContain('Example case');
    expect(text).toContain('Illustrative files. Requirements depend on the country and route.');
    for (const item of ['Passport Copy', 'Employment Letter', 'Agency Request']) {
      expect(text).toContain(item);
    }
    expect(text).toContain('A passport renewal');
    expect(text).toContain('Example');
  });

  it('answers the five questions, each in its own closed disclosure', async () => {
    const html = await render();
    const faq = html.slice(html.indexOf('lp-faq-items'));
    expect(faq.match(/<details>/g)).toHaveLength(5);
    expect(faq).not.toContain('<details open');
    expect(textOf(faq)).toContain('Does VisaStack issue visas?');
    expect(textOf(faq)).toContain(
      'VisaStack helps you prepare. The issuing authority sets the official requirements and decides your application.',
    );
  });

  it('leaves out everything the earlier home page had, and the studio-only link', async () => {
    const html = await render();
    const text = textOf(html);
    for (const gone of [
      'One record.',
      'Every visa.',
      'Add it once.',
      'Every rule shows',
      'Ayesha',
      'data-scene=',
      'hs-hero',
      'Compare designs',
      '/record/',
    ]) {
      expect(html + text, gone).not.toContain(gone);
    }
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

  it('says the pilot, the beta or the test build from the deployment mode and registration, and nowhere else', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
    let text = textOf(await render());
    expect(text).toContain('VisaStack is in a controlled pilot');
    expect(text).toContain('Use sample data during the controlled pilot.');
    vi.stubEnv('DEPLOYMENT_MODE', 'development');
    text = textOf(await render());
    expect(text).toContain('This is a test build');
    expect(text).not.toContain('controlled pilot');
    betaState.value = true;
    try {
      vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
      text = textOf(await render());
      expect(text).toContain('VisaStack is in public beta');
      expect(text).not.toContain('controlled pilot');
      expect(text).not.toContain('sample data');
    } finally {
      betaState.value = false;
    }
  });

  it('keeps today’s sign-in flow: open registration leads to sign-up', async () => {
    betaState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Create your free account');
      expect(text).toContain('Registration is open for public beta');
      expect(html.match(/href="\/auth\/sign-up"/g)).toHaveLength(1);
    } finally {
      betaState.value = false;
    }
  });

  it('keeps the closed-registration flow: one sign-in action and the made-up-details notice', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Sign in to get started');
    expect(html).toMatch(/<a class="lp-button lp-quiet" href="\/app">Sign in to get started/);
    expect(text).toContain('Real applicant details are not accepted yet');
    expect(html).not.toContain('href="/auth/sign-up"');
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

  it('links the real public pages, once each where the page names them', async () => {
    const html = await render();
    expect(html.match(/href="\/how-it-works"/g)).toHaveLength(1);
    expect(html.match(/href="\/for-agencies"/g)).toHaveLength(1);
    expect(html.match(/href="\/trust"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/href="\/status"/g)?.length).toBeGreaterThanOrEqual(2);
    for (const href of html
      .match(/<a [^>]*href="\/[^"#]*"/g)
      ?.map((tag) => tag.slice(tag.indexOf('href="'))) ?? []) {
      expect([
        '/',
        '/countries',
        '/how-it-works',
        '/for-agencies',
        '/trust',
        '/status',
        '/app',
      ]).toContain(href.slice(6, -1));
    }
  });

  it('shows no sign-in wording to someone who is already signed in', async () => {
    signedInState.value = true;
    try {
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Open your workspace');
      expect(text).not.toContain('Sign in to get started');
      expect(html).toMatch(/<a class="lp-button lp-quiet" href="\/app">Open your workspace/);
    } finally {
      signedInState.value = false;
    }
  });

  it('is a still page: no scene engine, no animation file', () => {
    const body = readFileSync(join(__dirname, 'home-landing.tsx'), 'utf8');
    const css = readFileSync(join(__dirname, 'home-landing.css'), 'utf8');
    expect(body).not.toContain('ScenesRuntime');
    expect(css).not.toMatch(/animation|transition|@keyframes/);
  });
});
