// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { TOAST_MS, ToastHost, dismissToast, resetToastForTest, showToast } from './toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const strip = () => host.querySelector('.toast');
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  resetToastForTest();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ToastHost />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('the done strip', () => {
  it('shows nothing until something is raised', () => {
    expect(strip()).toBeNull();
  });

  it('shows the words, and goes after four seconds', () => {
    act(() => showToast('Saved.'));
    expect(strip()?.textContent).toContain('Saved.');
    advance(TOAST_MS - 1);
    expect(strip()).not.toBeNull();
    advance(2);
    expect(strip()).toBeNull();
  });

  it('is hidden from assistive technology and holds nothing a keyboard can land on', () => {
    act(() => showToast('Saved.'));
    expect(host.querySelector('.toast-region')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.toast-close')?.getAttribute('tabindex')).toBe('-1');
    expect(host.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it('waits while the pointer is on it, then carries on with the time that was left', () => {
    act(() => showToast('Saved.'));
    advance(3000);
    act(() => {
      // React works out "pointer entered" from pointerover, and "left" from pointerout.
      strip()?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    advance(10_000);
    expect(strip()).not.toBeNull();
    act(() => void strip()?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })));
    advance(900);
    expect(strip()).not.toBeNull();
    advance(200);
    expect(strip()).toBeNull();
  });

  it('waits while focus is on it', () => {
    act(() => showToast('Saved.'));
    const button = host.querySelector<HTMLButtonElement>('.toast-close');
    act(() => button?.focus());
    advance(10_000);
    expect(strip()).not.toBeNull();
    act(() => button?.blur());
    advance(TOAST_MS + 10);
    expect(strip()).toBeNull();
  });

  it('closes on its button and on Escape', () => {
    act(() => showToast('Saved.'));
    act(() => host.querySelector<HTMLButtonElement>('.toast-close')?.click());
    expect(strip()).toBeNull();
    act(() => showToast('Copied.'));
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(strip()).toBeNull();
  });

  it('shows one at a time: a newer strip replaces the older and starts its own four seconds', () => {
    act(() => showToast('First.'));
    advance(3000);
    act(() => showToast('Second.'));
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
    expect(strip()?.textContent).toContain('Second.');
    advance(3000);
    expect(strip()).not.toBeNull();
    advance(1100);
    expect(strip()).toBeNull();
  });

  it('starts the four seconds again when the same words are raised again', () => {
    act(() => showToast('Saved.'));
    advance(3000);
    act(() => showToast('Saved.'));
    advance(3000);
    expect(strip()).not.toBeNull();
    advance(1100);
    expect(strip()).toBeNull();
  });

  it('drops a strip raised on a page with no frame, but keeps one raised as the frame arrives', () => {
    act(() => root.unmount());
    showToast('Raised outside the workspace.');
    vi.advanceTimersByTime(2000);
    root = createRoot(host);
    act(() => root.render(<ToastHost />));
    expect(strip()).toBeNull();
    act(() => root.unmount());
    showToast('Raised as the frame arrives.');
    root = createRoot(host);
    act(() => root.render(<ToastHost />));
    expect(strip()?.textContent).toContain('Raised as the frame arrives.');
  });

  it('shows nothing for empty words, and an old timer never closes a newer strip', () => {
    act(() => showToast('   '));
    expect(strip()).toBeNull();
    act(() => showToast('One.'));
    advance(1000);
    act(() => dismissToast(999));
    expect(strip()).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    vi.useRealTimers();
    act(() => showToast('Saved.'));
    expect(await axeViolations(host.innerHTML)).toEqual([]);
  });
});
