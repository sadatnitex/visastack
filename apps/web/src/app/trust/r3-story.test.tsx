// @vitest-environment jsdom
import type { PublicTrustRoute } from '@visastack/services';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * R3 (owner, 18 Nov 2026): the Privacy and Trust page is rebuilt to the approved reference. These
 * checks read the real rendered page as a parsed document, never as pattern-matched text.
 */

const listPublicTrustPublished = vi.fn();
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPublicTrustPublished: (...args: unknown[]) => listPublicTrustPublished(...args),
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));

const { default: Page } = await import('./page');
const { SHARE_HERO_TICK_MS, ShareHero } = await import('./share-hero');
const { ShareSheetBody } = await import('../../components/public-site/kit/share-sheet-body');
const { renderToStaticMarkup } = await import('react-dom/server');

function route(n: number): PublicTrustRoute {
  return {
    packKey: `route-${n}`,
    packName: `Route ${n}`,
    jurisdiction: 'Japan',
    route: 'Visit',
    routeDescription: 'Short stays.',
  } as unknown as PublicTrustRoute;
}

async function page(routes: PublicTrustRoute[]): Promise<Document> {
  listPublicTrustPublished.mockResolvedValue(routes);
  const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
  return new DOMParser().parseFromString(html, 'text/html');
}

const text = (node: Element | null | undefined) => {
  const copy = node?.cloneNode(true) as Element | undefined;
  for (const br of copy?.querySelectorAll('br') ?? []) br.replaceWith(' ');
  return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

beforeEach(() => {
  listPublicTrustPublished.mockReset();
});

describe('the Privacy and Trust chapters', () => {
  it('runs the six chapters of the reference in order, each named by one heading', async () => {
    const doc = await page([route(1)]);
    const chapters = [...doc.querySelectorAll('.pub-chapter')];
    expect(chapters).toHaveLength(6);
    const headings = chapters.map((chapter) => text(chapter.querySelector('h1, h2')));
    expect(headings).toEqual([
      'You decide who sees what.',
      'Five promises.',
      'Your history, in plain view.',
      'What we do. What we do not.',
      'Where we are today.',
      'Private from the first document.',
    ]);
    for (const chapter of chapters) {
      expect(chapter.querySelectorAll('h1, h2')).toHaveLength(1);
    }
  });

  it('states the agreed privacy sentence and keeps the start and privacy links', async () => {
    const doc = await page([]);
    expect(text(doc.querySelector('#trust-story-title')?.closest('section'))).toContain(
      'Agencies and other people see it only when you share it.',
    );
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((href) => href === '/app').length).toBeGreaterThanOrEqual(2);
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/how-it-works');
  });

  it('draws five promises, each with its own drawing', async () => {
    const doc = await page([]);
    const cards = [...doc.querySelectorAll('#promises li')];
    expect(cards).toHaveLength(5);
    for (const card of cards) expect(card.querySelector('svg')).not.toBeNull();
    // The one exception to "only when you share it" is stated, never hidden.
    expect(text(cards[0] ?? null)).toContain('Support help is the one exception');
  });

  it('tags the made-up history rows as Example and ends on the no-approval boundary', async () => {
    const doc = await page([]);
    const events = [...doc.querySelectorAll('#history li')];
    expect(events).toHaveLength(3);
    for (const event of events) expect(event.querySelector('.pub-example')).not.toBeNull();
    expect(text(doc.querySelector('#limits'))).toContain('No approval guarantees');
  });

  it('never draws an empty block: no route list, no empty notice without routes', async () => {
    const doc = await page([]);
    expect(doc.querySelector('.trust-catalog')).toBeNull();
    expect(doc.body.textContent).not.toContain('No routes are currently published');
    expect(text(doc.querySelector('#today'))).toContain('controlled pilot');
  });

  it('puts the route list inside the Where We Are Today chapter, linked to the pack pages', async () => {
    const doc = await page([route(1), route(2)]);
    const list = doc.querySelector('#today .trust-catalog');
    expect(list).not.toBeNull();
    expect(
      [...(list?.querySelectorAll('a.card') ?? [])].map((a) => a.getAttribute('href')),
    ).toEqual(['/trust/route-1', '/trust/route-2']);
  });

  it('uses no inline style or script on the page', async () => {
    const doc = await page([route(1)]);
    expect(doc.querySelectorAll('[style]')).toHaveLength(0);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('the hero makes no part-of-document sharing claim', () => {
  // Sharing part of a document does not exist yet (sharing.ts, Milestone 2): no step of the
  // picture, and nothing else in the hero, may say a part of a paper is shared.
  const CLAIMS = ['Photo page only', 'Visa size', 'photo page'];

  it('draws no such words at any of the five steps', () => {
    for (const step of [0, 1, 2, 3, 4] as const) {
      const doc = new DOMParser().parseFromString(
        renderToStaticMarkup(<ShareSheetBody step={step} pageLang="en" />),
        'text/html',
      );
      expect(doc.querySelector('figure')).not.toBeNull();
      for (const claim of CLAIMS) {
        expect(doc.body.textContent ?? '', `step ${step}`).not.toContain(claim);
      }
    }
  });

  it('keeps the whole page free of them too', async () => {
    const doc = await page([route(1)]);
    for (const claim of CLAIMS) expect(doc.body.textContent ?? '').not.toContain(claim);
  });
});

describe('the hero pause control (WCAG 2.2.2)', () => {
  function mount(reduced: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduced && query.includes('reduce'),
      addEventListener() {},
    }));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <ShareHero
          steps={([0, 1, 2, 3, 4] as const).map((step) => (
            <ShareSheetBody key={step} step={step} pageLang="en" />
          ))}
          pauseFace="Pause the Animation"
          playFace="Play the Animation"
        />,
      ),
    );
    return { host, root };
  }

  it('offers a Pause button that stops the picture on its finished still, and Play to resume', () => {
    const { host, root } = mount(false);
    const button = host.querySelector('button');
    expect(button?.textContent).toContain('Pause the Animation');
    expect(button?.hasAttribute('aria-pressed')).toBe(false);
    act(() => button?.click());
    expect(host.querySelector('button')?.textContent).toContain('Play the Animation');
    expect(host.querySelector('.kit-fixed')?.getAttribute('data-kit-step')).toBe('4');
    act(() => host.querySelector('button')?.click());
    // Playing again restarts the loop from its first step (nothing is shared yet).
    expect(host.querySelector('.kit-fixed')?.getAttribute('data-kit-step')).toBe('0');
    act(() => root.unmount());
  });

  it('plays for visitors who asked for less motion too (gentle fades), so the Pause button shows', () => {
    const { host, root } = mount(true);
    expect(host.querySelector('button')?.textContent).toContain('Pause the Animation');
    expect(host.querySelector('.kit-fixed')?.getAttribute('data-kit-step')).toBe('0');
    act(() => root.unmount());
  });

  it('keeps the same picture elements from step to step so the parts can fade (no hard swap)', () => {
    const { host, root } = mount(true);
    const first = host.querySelector('.kit-fixed');
    act(() => host.querySelector('button')?.click());
    act(() => host.querySelector('button')?.click());
    expect(host.querySelector('.kit-fixed')).toBe(first);
    act(() => root.unmount());
  });

  it('keeps the Pause button in the server markup, idle and hidden, so nothing shifts when it appears', () => {
    const out = renderToStaticMarkup(
      <ShareHero
        steps={([0, 1, 2, 3, 4] as const).map((step) => (
          <ShareSheetBody key={step} step={step} pageLang="en" />
        ))}
        pauseFace="Pause the Animation"
        playFace="Play the Animation"
      />,
    );
    expect(out).toContain('class="tr-pause"');
    expect(out).toContain('data-idle=""');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('tabindex="-1"');
  });

  it('shows no dead control without script or before hydration: the finished step and no button', () => {
    const out = renderToStaticMarkup(
      <ShareHero
        steps={([0, 1, 2, 3, 4] as const).map((step) => (
          <ShareSheetBody key={step} step={step} pageLang="en" />
        ))}
        pauseFace="Pause the Animation"
        playFace="Play the Animation"
      />,
    );
    expect(out).toContain('data-kit-step="4"');
    // The only button is the idle one: hidden from sight, from the tab order and from readers.
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('data-idle=""');
  });

  describe('plays only while it should', () => {
    const steps = ([0, 1, 2, 3, 4] as const).map((step) => (
      <ShareSheetBody key={step} step={step} pageLang="en" />
    ));
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => undefined;
    function play() {
      vi.useFakeTimers();
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: typeof notify) {
            notify = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      act(() =>
        root.render(<ShareHero steps={steps} pauseFace="Pause the Animation" playFace="Play" />),
      );
      const step = () => host.querySelector('.kit-fixed')?.getAttribute('data-kit-step');
      return { host, root, step };
    }
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, 'hidden');
    });

    it('stops while it is off screen and carries on when it is back', () => {
      const { root, step } = play();
      act(() => notify([{ isIntersecting: true }]));
      act(() => {
        vi.advanceTimersByTime(SHARE_HERO_TICK_MS);
      });
      expect(step()).toBe('1');
      act(() => notify([{ isIntersecting: false }]));
      act(() => {
        vi.advanceTimersByTime(SHARE_HERO_TICK_MS * 6);
      });
      expect(step()).toBe('1');
      act(() => notify([{ isIntersecting: true }]));
      act(() => {
        vi.advanceTimersByTime(SHARE_HERO_TICK_MS);
      });
      expect(step()).toBe('2');
      act(() => root.unmount());
    });

    it('stops while the tab is hidden and carries on when it shows again', () => {
      const { root, step } = play();
      let hidden = true;
      Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => {
        vi.advanceTimersByTime(SHARE_HERO_TICK_MS * 6);
      });
      expect(step()).toBe('0');
      hidden = false;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => {
        vi.advanceTimersByTime(SHARE_HERO_TICK_MS);
      });
      expect(step()).toBe('1');
      act(() => root.unmount());
    });

    it('changes the picture at most three times a second', () => {
      const { root, step } = play();
      expect(SHARE_HERO_TICK_MS).toBeGreaterThanOrEqual(334);
      // Sample every 100 ms for ten steps and note when the picture changes.
      const changes: number[] = [];
      let last = step();
      const start = Date.now();
      for (let tick = 0; tick < (SHARE_HERO_TICK_MS * 10) / 100; tick++) {
        act(() => {
          vi.advanceTimersByTime(100);
        });
        if (step() !== last) {
          changes.push(Date.now() - start);
          last = step();
        }
      }
      expect(changes.length).toBeGreaterThanOrEqual(9);
      for (let at = 0; at + 3 < changes.length; at++)
        expect((changes[at + 3] ?? 0) - (changes[at] ?? 0)).toBeGreaterThanOrEqual(1000);
      act(() => root.unmount());
    });
  });
});
