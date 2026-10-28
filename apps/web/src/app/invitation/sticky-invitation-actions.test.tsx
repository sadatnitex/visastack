// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StickyInvitationActions } from './sticky-invitation-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the browser's watcher: the test says when the top buttons enter or leave view. */
class FakeObserver {
  static latest: FakeObserver | null = null;
  readonly watched: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
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
  report(isIntersecting: boolean) {
    const target = this.watched[0];
    if (!target) throw new Error('nothing is watched');
    act(() =>
      this.callback(
        [{ isIntersecting, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  FakeObserver.latest = null;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
const pinned = () => container.querySelector<HTMLElement>('.invitation-sticky');
const observer = () => {
  const latest = FakeObserver.latest;
  if (!latest) throw new Error('no observer was created');
  return latest;
};

describe('the pinned invitation buttons on phones', () => {
  it('renders only the top buttons on the server, so the page works without scripts', () => {
    const html = renderToStaticMarkup(<StickyInvitationActions>{buttons}</StickyInvitationActions>);
    expect(html).toContain('class="invitation-actions"');
    expect(html).not.toContain('invitation-sticky');
    expect(html.match(/Create an Account to Review/g)).toHaveLength(1);
  });

  it('watches the top buttons themselves', () => {
    show();
    expect(observer().watched).toEqual([container.querySelector('.invitation-actions')]);
  });

  it('keeps the pinned copy hidden from sight, speech and keyboard while the top buttons show', () => {
    show();
    const bar = pinned();
    expect(bar?.getAttribute('data-shown')).toBe('false');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(bar?.hasAttribute('inert')).toBe(true);
    observer().report(true);
    expect(pinned()?.getAttribute('data-shown')).toBe('false');
  });

  it('shows the pinned copy only after the top buttons leave view, and hides it again when they return', () => {
    show();
    observer().report(false);
    const bar = pinned();
    expect(bar?.getAttribute('data-shown')).toBe('true');
    expect(bar?.hasAttribute('aria-hidden')).toBe(false);
    expect(bar?.hasAttribute('inert')).toBe(false);
    expect([...(bar?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'Create an Account to Review',
      'Sign In',
    ]);
    observer().report(true);
    expect(pinned()?.getAttribute('data-shown')).toBe('false');
    expect(pinned()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('moves keyboard focus to the same top button when the pinned copy hides under it', () => {
    show();
    observer().report(false);
    const pinnedSignIn = [...(pinned()?.querySelectorAll('a') ?? [])][1];
    pinnedSignIn?.focus();
    expect(document.activeElement).toBe(pinnedSignIn);
    observer().report(true);
    const topSignIn = [
      ...(container.querySelector('.invitation-actions')?.querySelectorAll('a') ?? []),
    ][1];
    expect(document.activeElement).toBe(topSignIn);
  });

  it('adds no pinned copy where the browser cannot watch, and stops watching when it leaves the page', () => {
    show();
    const watcher = observer();
    act(() => root.unmount());
    expect(watcher.disconnected).toBe(true);
    root = createRoot(container);
    vi.stubGlobal('IntersectionObserver', undefined);
    show();
    expect(container.querySelector('.invitation-actions')).not.toBeNull();
    expect(pinned()).toBeNull();
  });
});
