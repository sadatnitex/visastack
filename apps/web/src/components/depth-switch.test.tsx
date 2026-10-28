// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEPTH_COOKIE, parseDepthCookie } from '../lib/ccd/depth';
import { DepthScope, atLevel } from './depth';
import { DepthSwitch, type DepthSwitchCopy } from './depth-switch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy: DepthSwitchCopy = {
  group: 'How much to show',
  levels: { glance: 'Glance', browse: 'Browse', everything: 'Everything' },
  summaries: { glance: 'Glance text.', browse: 'Browse text.', everything: 'Everything text.' },
  status: 'Showing {level}',
};

let root: Root;
let container: HTMLDivElement;
let phone = false;

function mockViewport() {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function page(depth: 'auto' | 'glance' | 'browse' | 'everything', words: DepthSwitchCopy = copy) {
  return (
    <DepthScope family="account" depth={depth}>
      <DepthSwitch family="account" initial={depth} copy={words} />
      <section id="top-part">Top</section>
      <section id="notes" data-level="browse" tabIndex={-1}>
        <h2>Notes</h2>
        <p id="deep" data-level="everything">
          Deep
        </p>
        <input id="typed" defaultValue="" />
      </section>
    </DepthScope>
  );
}

const scope = () => container.querySelector<HTMLElement>('[data-depth-scope]') as HTMLElement;
const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === name,
  ) as HTMLButtonElement;

beforeEach(() => {
  phone = false;
  mockViewport();
  document.cookie = `${DEPTH_COOKIE}=; Path=/app; Max-Age=0`;
  window.history.replaceState(null, '', '/app/account');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the depth switch', () => {
  it('shows three buttons with Browse pressed on a wide screen when nothing is saved', () => {
    act(() => root.render(page('auto')));
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Glance',
      'Browse',
      'Everything',
    ]);
    expect(button('Browse').getAttribute('aria-pressed')).toBe('true');
    expect(button('Glance').getAttribute('aria-pressed')).toBe('false');
  });

  it('starts at Glance on a phone', () => {
    phone = true;
    mockViewport();
    act(() => root.render(page('auto')));
    expect(button('Glance').getAttribute('aria-pressed')).toBe('true');
  });

  it('changes the level, saves it as level words only, and says what it did', () => {
    act(() => root.render(page('auto')));
    button('Everything').focus();
    act(() => button('Everything').click());
    expect(scope().getAttribute('data-depth')).toBe('everything');
    expect(button('Everything').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('output')?.textContent).toBe('Showing Everything');
    expect(document.activeElement).toBe(button('Everything'));
    const saved = document.cookie.split('; ').find((c) => c.startsWith(`${DEPTH_COOKIE}=`));
    expect(parseDepthCookie(saved?.slice(DEPTH_COOKIE.length + 1))).toEqual({
      account: 'everything',
    });
  });

  it('keeps what was typed when the level changes', () => {
    act(() => root.render(page('everything')));
    const input = container.querySelector<HTMLInputElement>('#typed') as HTMLInputElement;
    input.value = 'kept';
    act(() => button('Glance').click());
    act(() => button('Everything').click());
    expect(container.querySelector<HTMLInputElement>('#typed')?.value).toBe('kept');
    expect(container.querySelector('#typed')).toBe(input);
  });
});

describe('a server refresh of the page', () => {
  it('keeps the level the person or a link chose, instead of the one first rendered', async () => {
    act(() => root.render(page('glance')));
    act(() => button('Everything').click());
    act(() => root.render(page('browse')));
    expect(scope().getAttribute('data-depth')).toBe('everything');
  });
});

describe('links never land on hidden content', () => {
  it('raises the level for an anchor inside a hidden block, then moves focus there', async () => {
    window.history.replaceState(null, '', '/app/account#notes');
    await act(async () => {
      root.render(page('glance'));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(scope().getAttribute('data-depth')).toBe('browse');
    expect(button('Browse').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement?.id).toBe('notes');
  });

  it('goes to Everything for an anchor in the deepest block', async () => {
    window.history.replaceState(null, '', '/app/account#deep');
    await act(async () => {
      root.render(page('glance'));
    });
    expect(scope().getAttribute('data-depth')).toBe('everything');
  });

  it('follows a later change of the address bar', async () => {
    await act(async () => {
      root.render(page('glance'));
    });
    window.history.replaceState(null, '', '/app/account#deep');
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(scope().getAttribute('data-depth')).toBe('everything');
  });

  it('honours ?depth= without saving it', async () => {
    window.history.replaceState(null, '', '/app/account?depth=everything');
    await act(async () => {
      root.render(page('auto'));
    });
    expect(scope().getAttribute('data-depth')).toBe('everything');
    expect(document.cookie).not.toContain(DEPTH_COOKIE);
  });

  it('ignores an anchor that is not valid text instead of crashing the page', async () => {
    window.history.replaceState(null, '', '/app/account#100%25%E0%A4%A');
    await act(async () => {
      root.render(page('glance'));
    });
    expect(scope().getAttribute('data-depth')).toBe('glance');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('does not force the level back when the page refreshes with fresh copy of the words', async () => {
    window.history.replaceState(null, '', '/app/account?depth=glance');
    await act(async () => {
      root.render(page('everything'));
    });
    act(() => button('Browse').click());
    await act(async () => {
      root.render(page('browse', { ...copy, summaries: { ...copy.summaries } }));
    });
    expect(scope().getAttribute('data-depth')).toBe('browse');
  });

  it('leaves focus alone when the target is already on screen', async () => {
    window.history.replaceState(null, '', '/app/account#top-part');
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    await act(async () => {
      root.render(page('glance'));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('opens the target on every click of an in-page link, even when the address is unchanged', async () => {
    window.history.replaceState(null, '', '/app/account#deep');
    await act(async () => {
      root.render(
        <>
          {page('glance')}
          <a id="to-deep" href="#deep">
            Show deep
          </a>
        </>,
      );
    });
    expect(scope().getAttribute('data-depth')).toBe('everything');
    act(() => button('Glance').click());
    expect(scope().getAttribute('data-depth')).toBe('glance');
    act(() => (container.querySelector('#to-deep') as HTMLAnchorElement).click());
    expect(scope().getAttribute('data-depth')).toBe('everything');
  });

  it('leaves the level alone when the target is already shown', async () => {
    window.history.replaceState(null, '', '/app/account#top-part');
    await act(async () => {
      root.render(page('glance'));
    });
    expect(scope().getAttribute('data-depth')).toBe('glance');
  });
});

describe('the server markup', () => {
  it('renders every block, whatever the level, so nothing leaves the page', () => {
    const html = renderToStaticMarkup(page('glance'));
    expect(html).toContain('Notes');
    expect(html).toContain('Deep');
    expect(html).toContain('data-depth="glance"');
  });

  it('marks blocks with a level word', () => {
    expect(atLevel('browse')).toEqual({ 'data-level': 'browse' });
  });

  it('shows everything when scripts are off, and hides the switch that needs them', () => {
    const html = renderToStaticMarkup(page('glance'));
    expect(html).toContain('<noscript><span class="depth-nojs"></span></noscript>');
  });
});
