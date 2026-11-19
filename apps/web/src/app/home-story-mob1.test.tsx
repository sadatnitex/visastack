// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type AtRule, type Rule } from 'postcss';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhoneActionBar, PhoneMore, SwipeRow } from '../components/public-site/phone-actions';

/*
 * WP-MOB1 (19 Nov 2026): the phone changes of the Home page must never reach a computer. Everything
 * that changes what a phone shows sits inside `@media (max-width: 759px)`; the only rules outside it
 * hide the parts that exist for phones or flatten a wrapper (`display: contents` adds no box).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(join(__dirname, 'home-story.css'), 'utf8');
const PHONE_ONLY = /^\(max-width: 759px\)( and \(prefers-reduced-motion: reduce\))?$/;

function mob1Nodes() {
  const root = postcss.parse(CSS);
  const nodes = root.nodes ?? [];
  const start = nodes.findIndex((n) => n.type === 'comment' && n.text.startsWith('WP-MOB1'));
  return { start, nodes: start < 0 ? [] : nodes.slice(start + 1) };
}

describe('the MOB1 stylesheet block', () => {
  it('starts at a WP-MOB1 marker', () => {
    expect(mob1Nodes().start).toBeGreaterThan(0);
  });

  it('draws nothing new on a computer: outside the phone query it only hides or flattens', () => {
    const { nodes } = mob1Nodes();
    const bad: string[] = [];
    for (const node of nodes) {
      if (node.type === 'rule') {
        for (const decl of (node as Rule).nodes ?? []) {
          if (
            decl.type === 'decl' &&
            !(decl.prop === 'display' && ['none', 'contents'].includes(decl.value))
          ) {
            bad.push(`${(node as Rule).selector} { ${decl.prop}: ${decl.value} }`);
          }
        }
      } else if (node.type === 'atrule') {
        if (!PHONE_ONLY.test((node as AtRule).params)) {
          bad.push(`@${(node as AtRule).name} ${(node as AtRule).params}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('puts every phone rule inside a 759 px query', () => {
    const { nodes } = mob1Nodes();
    const phoneRules = nodes.filter(
      (n) => n.type === 'atrule' && PHONE_ONLY.test((n as AtRule).params),
    );
    expect(phoneRules.length).toBeGreaterThanOrEqual(2);
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('PhoneMore', () => {
  it('shows everything and no button before the page starts, then a real toggle', () => {
    const server = renderToStaticMarkup(
      <PhoneMore seeAll="See All 8" fewer="Show Fewer">
        <ul>
          <li>one</li>
        </ul>
      </PhoneMore>,
    );
    expect(server).not.toContain('data-ready');
    act(() =>
      root.render(
        <PhoneMore seeAll="See All 8" fewer="Show Fewer">
          <ul>
            <li>one</li>
          </ul>
        </PhoneMore>,
      ),
    );
    const wrap = host.querySelector('.hs-more') as HTMLElement;
    expect(wrap.hasAttribute('data-ready')).toBe(true);
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('See All 8');
    expect(button.getAttribute('aria-controls')).toBe(host.querySelector('.hs-more-body')?.id);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('Show Fewer');
    expect(wrap.getAttribute('data-open')).toBe('true');
  });
});

describe('SwipeRow', () => {
  const renderRow = () =>
    act(() =>
      root.render(
        <SwipeRow labelledBy="title">
          <ul />
        </SwipeRow>,
      ),
    );

  it('adds no focus stop where nothing scrolls (a computer)', () => {
    renderRow();
    const row = host.querySelector('.hs-swipe') as HTMLElement;
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.hasAttribute('role')).toBe(false);
  });

  it('becomes a labelled focus stop when it really scrolls (a phone)', () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, value: 360 });
    try {
      renderRow();
      const row = host.querySelector('.hs-swipe') as HTMLElement;
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('role')).toBe('group');
      expect(row.getAttribute('aria-labelledby')).toBe('title');
    } finally {
      // jsdom keeps these on Element, so removing our override restores its own zero sizes.
      Reflect.deleteProperty(proto, 'scrollWidth');
      Reflect.deleteProperty(proto, 'clientWidth');
    }
  });
});

describe('PhoneActionBar', () => {
  type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
  const watchers: Callback[] = [];

  beforeEach(() => {
    watchers.length = 0;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(callback: Callback) {
        watchers.push(callback);
      }
      observe() {}
      disconnect() {}
    };
    for (const id of ['first', 'last']) {
      const el = document.createElement('section');
      el.id = id;
      document.body.append(el);
    }
  });

  afterEach(() => {
    document.getElementById('first')?.remove();
    document.getElementById('last')?.remove();
  });

  const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRectReadOnly;

  it('stays hidden on the first screen, shows after it, leaves for the closing chapter', () => {
    act(() =>
      root.render(
        <PhoneActionBar afterId="first" beforeId="last" href="/auth/sign-up">
          Create your free account
        </PhoneActionBar>,
      ),
    );
    const bar = host.querySelector('.hs-bar') as HTMLElement;
    expect(bar.getAttribute('data-shown')).toBe('false');
    const [onFirst, onLast] = watchers;
    expect(onFirst && onLast).toBeTruthy();
    if (!onFirst || !onLast) return;
    // The first chapter is on screen: no bar.
    act(() => onFirst([{ isIntersecting: true, boundingClientRect: rect(0, 800) }]));
    expect(bar.getAttribute('data-shown')).toBe('false');
    // The first chapter has scrolled off the top and the closing chapter is far below.
    act(() => onFirst([{ isIntersecting: false, boundingClientRect: rect(-900, -50) }]));
    act(() => onLast([{ isIntersecting: false, boundingClientRect: rect(2000, 2800) }]));
    expect(bar.getAttribute('data-shown')).toBe('true');
    // The closing chapter comes into view: the bar leaves.
    act(() => onLast([{ isIntersecting: true, boundingClientRect: rect(700, 1500) }]));
    expect(bar.getAttribute('data-shown')).toBe('false');
    // Past it (the footer): still gone.
    act(() => onLast([{ isIntersecting: false, boundingClientRect: rect(-900, -100) }]));
    expect(bar.getAttribute('data-shown')).toBe('false');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/auth/sign-up');
  });

  it('never shows without the observer (no script means the first and last buttons are enough)', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    act(() =>
      root.render(
        <PhoneActionBar afterId="first" beforeId="last" href="/app">
          Open your workspace
        </PhoneActionBar>,
      ),
    );
    expect(host.querySelector('.hs-bar')?.getAttribute('data-shown')).toBe('false');
  });
});
