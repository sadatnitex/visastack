// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlipTile } from './flip-tile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute('data-scenes');
});

const show = () =>
  act(() =>
    root.render(<FlipTile word="Received" not="is not Reviewed" means="No one has checked it." />),
  );

describe('FlipTile', () => {
  it('is a plain tile with the whole text and nothing to press when no scroll motion runs', () => {
    show();
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe('Receivedis not ReviewedNo one has checked it.');
    expect(host.querySelector('.hk-flip-static')).not.toBeNull();
  });

  it('is a disclosure while the scroll engine runs: aria-expanded and aria-controls follow the meaning', () => {
    document.documentElement.setAttribute('data-scenes', 'live');
    show();
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Receivedis not Reviewed');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    ) as HTMLElement;
    expect(panel.textContent).toBe('No one has checked it.');
    expect(panel.hidden).toBe(true);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('turns back into a plain tile when motion stops (reduced motion switched on)', () => {
    document.documentElement.setAttribute('data-scenes', 'live');
    show();
    expect(host.querySelector('button')).not.toBeNull();
    act(() => document.documentElement.removeAttribute('data-scenes'));
    return Promise.resolve().then(() => {
      expect(host.querySelector('button')).toBeNull();
      expect(host.textContent).toContain('No one has checked it.');
    });
  });
});
