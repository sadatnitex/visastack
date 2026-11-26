// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAG_RING_MAX, FlagRing, flagRingCodes } from './flag-ring';
import { PublicButton } from './public-button';
import {
  HEADER_PAGE_ROUTES,
  HOW_MENU,
  HOW_MENU_ROUTES,
  LIVE_ROUTES,
  PHONE_MENU_EXTRAS,
  PUBLIC_NAV,
  publicNavLinks,
} from './public-nav';
import { PassportTilt, PublicPicture, isSelfHosted } from './public-picture';
import { publicText } from './public-text';
import { READINESS_NOTE, ReadinessRing } from './readiness-ring';
import { Chapter, Scene, tonesAlternate } from './scene';
import { SCENES_ATTRIBUTE, SCENE_MIN_HEIGHT, SCENE_MIN_WIDTH } from './scene-engine';
import { ScenesRuntime } from './scenes-runtime';
import { ExampleTag, HeadlineWords, STATUS_WORDS, StatusChip, StoryCard } from './story';

const APP = join(__dirname, '..', '..', 'app');
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('Scene', () => {
  it('shows the finished step from the server, so no JavaScript still reads complete', () => {
    const out = html(
      <Scene name="add" len={3} steps={3} labelledBy="add-title">
        <h2 id="add-title">Add</h2>
      </Scene>,
    );
    expect(out).toContain('data-scene="add"');
    expect(out).toContain('data-len="3"');
    expect(out).toContain('data-steps="3"');
    expect(out).toContain('data-step="2"');
    expect(out).toContain('aria-labelledby="add-title"');
    expect(out).toContain('class="pub-scene-stage"');
  });
  it('writes data-play-to only when a scene has its own end, kept inside its steps (PUBFIX2 P2-7)', () => {
    const play = (value: number) =>
      renderToStaticMarkup(
        <Scene name="y" len={2} steps={4} finalStep={0} playTo={value}>
          <p>x</p>
        </Scene>,
      );
    expect(play(3)).toContain('data-play-to="3"');
    expect(play(9)).toContain('data-play-to="3"');
    expect(
      renderToStaticMarkup(
        <Scene name="z" len={2} steps={4}>
          <p>x</p>
        </Scene>,
      ),
    ).not.toContain('data-play-to');
  });

  it('repeats the finished step as data-rest, which reveal mode lays words out by (MOT1)', () => {
    expect(
      html(
        <Scene name="y" len={2} steps={4} finalStep={1}>
          y
        </Scene>,
      ),
    ).toContain('data-rest="1"');
    expect(
      html(
        <Scene name="z" len={2} steps={3}>
          z
        </Scene>,
      ),
    ).toContain('data-rest="2"');
  });
  it('keeps the length, the steps and the finished step inside their range', () => {
    const out = html(
      <Scene name="x" len={9 as 4} steps={0} finalStep={7}>
        x
      </Scene>,
    );
    expect(out).toContain('data-len="4"');
    expect(out).toContain('data-steps="1"');
    expect(out).toContain('data-step="0"');
    expect(
      html(
        <Scene name="y" len={2} steps={4} finalStep={1}>
          y
        </Scene>,
      ),
    ).toContain('data-step="1"');
  });
});

describe('Chapter', () => {
  it('marks only a dark chapter as carrying depth', () => {
    const dark = html(
      <Chapter tone="dark" id="one">
        a
      </Chapter>,
    );
    const light = html(<Chapter tone="light">b</Chapter>);
    expect(dark).toContain('class="pub-chapter pub-chapter-dark"');
    expect(dark).toContain('data-pub-depth=""');
    expect(dark).toContain('id="one"');
    expect(light).toContain('data-tone="light"');
    expect(light).not.toContain('data-pub-depth');
  });
  it('tells when the tones alternate', () => {
    expect(tonesAlternate(['dark', 'light', 'dark', 'light'])).toBe(true);
    expect(tonesAlternate([])).toBe(true);
    expect(tonesAlternate(['dark', 'light', 'light'])).toBe(false);
  });
});

describe('PublicButton', () => {
  it('uses a plain link for the workspace, which leaves for sign-in', () => {
    const out = html(
      <PublicButton href="/app" variant="secondary">
        Sign In
      </PublicButton>,
    );
    expect(out).toBe('<a class="pub-button pub-button-secondary" href="/app">Sign In</a>');
  });
  it('draws other calls to action with the chapter colours', () => {
    expect(
      html(
        <PublicButton href="/auth/sign-up" variant="primary">
          Get Started
        </PublicButton>,
      ),
    ).toContain('class="pub-button pub-button-primary" href="/auth/sign-up"');
  });
});

describe('story parts', () => {
  it('gives every state its own word and look', () => {
    const words = Object.values(STATUS_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(STATUS_WORDS.received).not.toBe(STATUS_WORDS.reviewed);
    expect(STATUS_WORDS.suggested).not.toBe(STATUS_WORDS.confirmed);
    expect(STATUS_WORDS.saved).not.toBe(STATUS_WORDS.shared);
    const looks = Object.keys(STATUS_WORDS).map(
      (status) => /class="([^"]+)"/.exec(html(<StatusChip status={status as 'saved'} />))?.[1],
    );
    expect(new Set(looks).size).toBe(words.length);
    expect(html(<StatusChip status="accessEnded" />)).toContain('>Access Ended</span>');
  });
  it('tags made-up figures as an Example and marks the English on a Bangla page', () => {
    expect(html(<StoryCard title="Case" body="Line" example />)).toContain(
      '<span class="pub-example">Example</span>',
    );
    expect(html(<StoryCard title="Case" body="Line" />)).not.toContain('Example');
    expect(html(<ExampleTag pageLang="bn" />)).toContain('<span lang="en">Example</span>');
    expect(html(<StoryCard title="T" body="B" level={2} raised />)).toContain(
      '<article class="pub-card" data-pub-depth=""><h2 class="pub-card-title">T</h2>',
    );
  });
  it('draws headline words with depth only through the marked span', () => {
    expect(html(<HeadlineWords>Every visa.</HeadlineWords>)).toBe(
      '<span class="pub-words" data-pub-depth="">Every visa.</span>',
    );
  });
  it('publicText leaves English pages alone', () => {
    expect(html(<p>{publicText('Countries', 'en')}</p>)).toBe('<p>Countries</p>');
    expect(html(<p>{publicText('Countries', 'bn')}</p>)).toBe(
      '<p><span lang="en">Countries</span></p>',
    );
  });
});

describe('ReadinessRing', () => {
  it('always says that readiness is completeness, never approval', () => {
    for (const [done, total] of [
      [3, 4],
      [4, 4],
      [0, 0],
    ] as const) {
      const out = html(<ReadinessRing done={done} total={total} />);
      expect(out).toContain(READINESS_NOTE);
      expect(out).not.toMatch(/approved|cleared|guaranteed/i);
    }
    expect(READINESS_NOTE).toBe('Completeness only. Not an approval.');
    expect(html(<ReadinessRing done={3} total={4} />)).toContain('75%');
  });
});

describe('FlagRing', () => {
  it('keeps only codes with a flag file, once each', () => {
    expect(flagRingCodes(['GB', 'gb', ' sg ', 'zz', 'javascript:'])).toEqual(['gb', 'sg']);
    const many = [
      'gb',
      'sg',
      'us',
      'ca',
      'au',
      'nz',
      'de',
      'fr',
      'it',
      'es',
      'nl',
      'be',
      'jp',
      'kr',
    ];
    expect(flagRingCodes(many)).toEqual(many.slice(0, FLAG_RING_MAX));
    expect(FLAG_RING_MAX).toBe(12);
  });
  it('draws lazy, self-hosted flags named by the public destination catalogue', () => {
    const out = html(<FlagRing codes={['GB', 'ZZ']} label="Countries We Hold" />);
    expect(out).toContain('aria-label="Countries We Hold"');
    expect(out).toContain('src="/flags/gb.svg"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('alt="United Kingdom"');
    expect(out).not.toContain('/flags/zz.svg');
    expect(out).toContain('data-count="1"');
    expect(out).not.toContain('style=');
  });
});

describe('pictures', () => {
  it('accepts only pictures served by this site', () => {
    expect(isSelfHosted('/pictures/passport-bd.png')).toBe(true);
    for (const src of [
      'data:image/png;base64,AAAA',
      'blob:https://x/1',
      'https://cdn.example.com/a.png',
      '//cdn.example.com/a.png',
      '/pictures/../secret.png',
      'pictures/a.png',
      '/a b.png',
    ])
      expect(isSelfHosted(src), src).toBe(false);
    expect(() =>
      html(<PublicPicture src="data:image/png;base64,AA" alt="" width={1} height={1} />),
    ).toThrow();
  });
  it('sets the size, loads lazily and decodes off the main thread', () => {
    const out = html(<PublicPicture src="/flags/gb.svg" alt="" width={36} height={27} />);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('width="36"');
    expect(html(<PublicPicture src="/a.png" alt="" width={1} height={1} eager />)).toContain(
      'loading="eager"',
    );
  });
  it('shows the real Bangladesh cover inside the tilting frame', () => {
    const out = html(<PassportTilt />);
    expect(out).toContain('class="pub-passport-tilt" data-pub-depth=""');
    expect(out).toContain('src="/pictures/passport-bd.png"');
    expect(out).toContain('alt=""');
  });
});

describe('public nav list', () => {
  it('names the five public pages, in order, with /trust called Privacy and Trust', () => {
    expect(PUBLIC_NAV.map((entry) => [entry.route, entry.label])).toEqual([
      ['/', 'Home'],
      ['/how-it-works', 'How It Works'],
      ['/trust', 'Privacy and Trust'],
      ['/countries', 'Country Guides'],
      ['/for-agencies', 'For Agencies'],
    ]);
  });
  it('never links to a page that does not exist yet', () => {
    const pageFile = (route: string) =>
      route === '/' ? join(APP, 'page.tsx') : join(APP, route.slice(1), 'page.tsx');
    for (const route of LIVE_ROUTES) expect(existsSync(pageFile(route)), route).toBe(true);
    const home = readFileSync(join(APP, 'home-landing.tsx'), 'utf8');
    for (const link of publicNavLinks()) {
      const [path, anchor] = link.href.split('#');
      expect(existsSync(pageFile(path || '/')), link.href).toBe(true);
      if (anchor) expect(home, link.href).toContain(`id="${anchor}"`);
    }
  });
  it('sends a signed-in person to the full country list, since the home picker is for visitors', () => {
    // While /countries is not live (the fallback the header used before PUB4 shipped it).
    const beforePub4 = new Set(['/', '/how-it-works', '/trust']);
    const countries = (signedIn: boolean) =>
      publicNavLinks(beforePub4, { signedIn }).find((link) => link.label === 'Country Guides')
        ?.href;
    expect(countries(false)).toBe('/#start');
    expect(countries(true)).toBe('/app/countries');
    expect(existsSync(join(APP, 'app', 'countries', '(list)', 'page.tsx'))).toBe(true);
    expect(
      publicNavLinks(new Set(['/countries']), { signedIn: true }).find(
        (link) => link.label === 'Country Guides',
      )?.href,
    ).toBe('/countries');
  });
  it('arranges the header as the approved homepage does: a menu, then two pages, every target real (LAND1)', () => {
    const home = readFileSync(join(APP, 'home-landing.tsx'), 'utf8');
    const pageFile = (route: string) =>
      route === '/' ? join(APP, 'page.tsx') : join(APP, route.slice(1), 'page.tsx');
    expect(HEADER_PAGE_ROUTES).toEqual(['/countries', '/for-agencies']);
    for (const route of HEADER_PAGE_ROUTES) {
      expect(
        PUBLIC_NAV.some((entry) => entry.route === route),
        route,
      ).toBe(true);
      expect(LIVE_ROUTES.has(route), route).toBe(true);
    }
    for (const entry of [...HOW_MENU, ...PHONE_MENU_EXTRAS]) {
      const [path, anchor] = entry.href.split('#');
      expect(existsSync(pageFile(path || '/')), entry.href).toBe(true);
      // A part of Home exists on the home page (and is reached from every page by the leading slash).
      if (anchor) {
        expect(entry.href.startsWith('/#'), entry.href).toBe(true);
        expect(home, entry.href).toContain(`id="${anchor}"`);
      }
    }
    // The menu stands for the pages it leads to, so the bar can mark it.
    for (const route of HOW_MENU_ROUTES) expect(LIVE_ROUTES.has(route), route).toBe(true);
    // Every entry is named in Title Case with one plain line under it, and the phone menu repeats
    // the one entry it leaves out (the trust page) in its own words further down.
    for (const entry of HOW_MENU) expect(entry.description.endsWith('.'), entry.label).toBe(true);
    expect(HOW_MENU.filter((entry) => entry.wideOnly).map((entry) => entry.href)).toEqual([
      '/trust',
    ]);
    expect(PHONE_MENU_EXTRAS.map((entry) => entry.href)).toContain('/trust');
  });
  it('follows a page once its unit marks it live', () => {
    const all = new Set(PUBLIC_NAV.map((entry) => entry.route));
    expect(publicNavLinks(all).map((link) => link.href)).toEqual([
      '/',
      '/how-it-works',
      '/trust',
      '/countries',
      '/for-agencies',
    ]);
    expect(publicNavLinks().map((link) => link.href)).toEqual([
      '/',
      '/how-it-works',
      '/trust',
      '/countries',
      '/for-agencies',
    ]);
  });
});

describe('ScenesRuntime', () => {
  let container: HTMLDivElement;
  let root: Root;
  const media = { reduce: false, wide: true };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce') ? media.reduce : media.wide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    container = document.createElement('div');
    container.innerHTML = '<section data-scene="a" data-steps="2" data-step="1"></section>';
    document.body.append(container);
    root = createRoot(container.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-save-data');
    media.reduce = false;
    media.wide = true;
  });
  const live = () => document.documentElement.getAttribute(SCENES_ATTRIBUTE);

  it('starts scenes on a wide screen with motion allowed, and stops them on the way out', () => {
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('live');
    act(() => root.render(null));
    expect(live()).toBe(null);
    expect(document.querySelector('[data-scene]')?.getAttribute('data-step')).toBe('1');
  });
  for (const wide of [true, false])
    it(`is gentle with reduced motion on a ${wide ? 'wide' : 'phone-width'} screen, and still ends finished`, () => {
      media.reduce = true;
      media.wide = wide;
      act(() => root.render(<ScenesRuntime />));
      expect(live()).toBe('gentle');
      expect(document.documentElement.getAttribute('data-scene-mode')).toBe('gentle');
      expect(document.querySelector('[data-scene]')?.getAttribute('data-step')).toBe('1');
      act(() => root.render(null));
      expect(live()).toBe(null);
    });
  it('keeps motion on with data saver: the mode is the same as without it', () => {
    document.documentElement.setAttribute('data-save-data', '');
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('live');
    media.wide = false;
    act(() => root.render(null));
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('reveal');
  });
  it('reveals instead of pinning on a phone-width or short screen, and marks the mode (MOT1)', () => {
    media.wide = false;
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('reveal');
    expect(document.documentElement.getAttribute('data-scene-mode')).toBe('reveal');
    act(() => root.render(null));
    expect(live()).toBe(null);
    expect(document.documentElement.getAttribute('data-scene-mode')).toBe(null);
    expect(document.querySelector('[data-scene]')?.getAttribute('data-step')).toBe('1');
  });
  it('switches between pinned and reveal on resize or rotation without a reload, never replaying or half drawing a scene', () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('reduce') ? media.reduce : media.wide;
      },
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => undefined,
    }));
    const fire = () => {
      for (const fn of listeners) fn();
    };
    const element = document.querySelector('[data-scene]');
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('live');
    media.wide = false;
    act(fire);
    expect(live()).toBe('reveal');
    expect(document.documentElement.getAttribute('data-scene-mode')).toBe('reveal');
    expect(element?.getAttribute('data-step')).toBe('1');
    expect(element?.getAttribute('data-reveal')).toBe('done');
    media.wide = true;
    act(fire);
    expect(live()).toBe('live');
    expect(document.documentElement.getAttribute('data-scene-mode')).toBe('pinned');
    expect(element?.hasAttribute('data-reveal')).toBe(false);
  });
  it('does not stop when data saver comes on while the page is open', async () => {
    act(() => root.render(<ScenesRuntime />));
    expect(live()).toBe('live');
    document.documentElement.setAttribute('data-save-data', '');
    await act(async () => await Promise.resolve());
    expect(live()).toBe('live');
  });
  it('treats screens narrower than 760 px or lower than 600 px as phones', () => {
    expect(SCENE_MIN_WIDTH).toBe(760);
    expect(SCENE_MIN_HEIGHT).toBe(600);
  });
});
