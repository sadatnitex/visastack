/*
 * One Documents-list refresh for all open Undo windows (LC-A1). Each archive or restore keeps its
 * row in view, with its Undo, for ten seconds. Refreshing the list after one of them would take
 * every other row archived since out of view too, Undo and all, before its time was up, so the
 * refresh waits until the last open window has closed. A window closed because its panel left
 * the page asks for no refresh of its own.
 */

const open = new Set<symbol>();
let pending: (() => void) | null = null;

export function openUndoWindow(): symbol {
  const token = Symbol('undo-window');
  open.add(token);
  return token;
}

/** Close one window; `refresh` asks for the list to refresh once no window is open. */
export function closeUndoWindow(token: symbol, refresh?: () => void): void {
  open.delete(token);
  if (refresh) pending = refresh;
  if (open.size === 0 && pending) {
    const run = pending;
    pending = null;
    run();
  }
}

/** Test-only: forget every window. */
export function resetUndoWindowsForTests(): void {
  open.clear();
  pending = null;
}

const ANNOUNCER_ID = 'lc-archive-announcer';

/**
 * A polite status region that stays on the page, created when an archive panel opens and before
 * any result arrives: screen readers announce a change to a region already present, while many
 * ignore the first words of a region that appears with them.
 */
export function ensureAnnouncer(): HTMLElement {
  const existing = document.getElementById(ANNOUNCER_ID);
  if (existing) return existing;
  const region = document.createElement('div');
  region.id = ANNOUNCER_ID;
  region.className = 'sr-only';
  region.setAttribute('aria-live', 'polite');
  document.body.append(region);
  return region;
}

export function announce(text: string): void {
  const region = ensureAnnouncer();
  // Cleared first, so the same words said twice in a row are still announced.
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * Before the list refreshes and this row leaves it, move focus that is inside the row (or lost
 * on the page body) to something that stays: the list's own tab, else the page heading.
 */
export function keepFocusThroughRefresh(row: HTMLElement | null): void {
  const active = document.activeElement;
  const inRow = row !== null && active !== null && row.contains(active);
  if (!inRow && active !== document.body && active !== null) return;
  const tab = document.querySelector<HTMLElement>('.lc-tab[aria-current="page"]');
  const heading = document.querySelector<HTMLElement>('main h1');
  const target = tab ?? heading;
  if (!target) return;
  if (target === heading && !heading.hasAttribute('tabindex'))
    heading.setAttribute('tabindex', '-1');
  target.focus();
}
