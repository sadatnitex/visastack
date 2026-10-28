// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PINNED_ACTIONS_QUERY, StickyInvitationActions } from './sticky-invitation-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the browser's watcher: the test says how much of the top buttons is in view. */
class FakeObserver {
  static latest: FakeObserver | null = null;
  readonly watched: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.latest = this;
  }
  observe(element: Element) {
    this.watched.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  /** Report the share of the top buttons in view, below the header: 1 all, 0 none. */
  report(ratio: number) {
    const target = this.watched[0];
    if (!target) throw new Error('nothing is watched');
    act(() =>
      this.callback(
        [
          {
            isIntersecting: ratio > 0,
            intersectionRatio: ratio,
            target,
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      ),
    );
  }
}

/** A stand-in for the phone-width media query, which the test can flip. */
function fakeMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: initial,
    media: PINNED_ACTIONS_QUERY,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  };
  return {
    matchMedia: vi.fn(() => media),
    listeners,
    flip(matches: boolean) {
      media.matches = matches;
      act(() => {
        for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
      });
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let media: ReturnType<typeof fakeMedia>;
beforeEach(() => {
  FakeObserver.latest = null;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  media = fakeMedia(true);
  vi.stubGlobal('matchMedia', media.matchMedia);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const header of document.querySelectorAll('header')) header.remove();
  vi.unstubAllGlobals();
});

const buttons = (
  <>
    <a className="btn btn-primary" href="/auth/sign-up?next=x">
      Create an Account to Review
    </a>
    <a className="btn btn-secondary" href="/auth/sign-in?next=x">
      Sign In
    </a>
  </>
);
const show = () =>
  act(() => root.render(<StickyInvitationActions>{buttons}</StickyInvitationActions>));
const top = () => container.querySelector<HTMLElement>('.invitation-actions');
const pinned = () => container.querySelector<HTMLElement>('.invitation-sticky');
const links = (element: HTMLElement | null) => [...(element?.querySelectorAll('a') ?? [])];
const observer = () => {
  const latest = FakeObserver.latest;
  if (!latest) throw new Error('no observer was created');
  return latest;
};
/** Only one copy is usable at a time: the other is inert. */
const usable = () => [top(), pinned()].filter((copy) => copy && !copy.hasAttribute('inert'));

describe('the pinned invitation buttons on phones', () => {
  it('renders only the top buttons on the server, so the page works without scripts', () => {
    const html = renderToStaticMarkup(<StickyInvitationActions>{buttons}</StickyInvitationActions>);
    expect(html).toContain('class="invitation-actions"');
    expect(html).not.toContain('invitation-sticky');
    expect(html).not.toContain('inert');
    expect(html.match(/Create an Account to Review/g)).toHaveLength(1);
  });

  it('watches the top buttons below the sticky site header, counting them in view only when whole', () => {
    const header = document.createElement('header');
    header.className = 'nav';
    header.style.position = 'sticky';
    header.style.top = '12px';
    header.getBoundingClientRect = () => ({ height: 64 }) as DOMRect;
    document.body.prepend(header);
    show();
    expect(observer().watched).toEqual([top()]);
    expect(observer().options.rootMargin).toBe('-76px 0px 0px 0px');
    expect(observer().options.threshold).toContain(1);
    expect(media.matchMedia).toHaveBeenCalledWith('(max-width: 640px)');
  });

  it('keeps the pinned copy inert while the top buttons are fully in view', () => {
    show();
    observer().report(1);
    expect(pinned()?.getAttribute('data-shown')).toBe('false');
    expect(pinned()?.hasAttribute('inert')).toBe(true);
    expect(pinned()?.hasAttribute('aria-hidden')).toBe(false);
    expect(usable()).toEqual([top()]);
  });

  it('shows the pinned copy once the top buttons are only partly in view, and makes the top copy inert', () => {
    show();
    observer().report(0.5);
    expect(pinned()?.getAttribute('data-shown')).toBe('true');
    expect(top()?.hasAttribute('inert')).toBe(true);
    expect(top()?.getAttribute('data-pinned')).toBe('true');
    expect(usable()).toEqual([pinned()]);
    expect(links(pinned()).map((a) => a.textContent)).toEqual([
      'Create an Account to Review',
      'Sign In',
    ]);
    observer().report(0);
    expect(usable()).toEqual([pinned()]);
    observer().report(1);
    expect(pinned()?.getAttribute('data-shown')).toBe('false');
    expect(usable()).toEqual([top()]);
  });

  it('moves keyboard focus to the same button in the copy that takes over, both ways', () => {
    show();
    links(top())[1]?.focus();
    observer().report(0);
    expect(document.activeElement).toBe(links(pinned())[1]);
    observer().report(1);
    expect(document.activeElement).toBe(links(top())[1]);
  });

  it('never pins on a wide screen, and hands focus back when the screen grows past phone width', () => {
    show();
    observer().report(0);
    links(pinned())[0]?.focus();
    media.flip(false);
    expect(pinned()?.getAttribute('data-shown')).toBe('false');
    expect(usable()).toEqual([top()]);
    expect(document.activeElement).toBe(links(top())[0]);
    // Back on a phone width, still scrolled down: the pinned copy returns.
    media.flip(true);
    expect(usable()).toEqual([pinned()]);
  });

  it('starts unpinned on a wide screen, whatever the scroll', () => {
    media = fakeMedia(false);
    vi.stubGlobal('matchMedia', media.matchMedia);
    show();
    observer().report(0);
    expect(usable()).toEqual([top()]);
  });

  it('adds no pinned copy where the browser cannot watch, and stops watching when it leaves the page', () => {
    show();
    const watcher = observer();
    act(() => root.unmount());
    expect(watcher.disconnected).toBe(true);
    expect(media.listeners.size).toBe(0);
    root = createRoot(container);
    vi.stubGlobal('IntersectionObserver', undefined);
    show();
    expect(top()).not.toBeNull();
    expect(top()?.hasAttribute('inert')).toBe(false);
    expect(pinned()).toBeNull();
  });
});
