// @vitest-environment jsdom
import type { PublicTrustRoute } from '@visastack/services';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const { ShareHero } = await import('./share-hero');
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

  it('shows no dead control when nothing moves (reduced motion)', () => {
    const { host, root } = mount(true);
    expect(host.querySelector('button')).toBeNull();
    act(() => root.unmount());
  });
});
