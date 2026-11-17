'use client';

import { useEffect } from 'react';

/**
 * Marks the page when the browser says data saver is on, so picture motion stays still
 * (ADR 0027). It sets `data-save-data` on the `html` element when `navigator.connection.saveData`
 * is true, and follows the setting if it changes while the page is open. Browsers without the
 * Network Information API (Safari, Firefox) are left alone: the attribute is simply never set and
 * the reduced-motion setting still applies. Nothing is drawn, sent or stored.
 *
 * Every picture component renders one of these. It is cheap: the first one on a page does the
 * work and the rest return at once.
 */

/** The attribute the picture stylesheet reads. */
export const SAVE_DATA_ATTRIBUTE = 'data-save-data';

interface NetworkInformationLike {
  readonly saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/** The browser's connection object, when it has one. */
function connectionOf(nav: unknown): NetworkInformationLike | undefined {
  if (typeof nav !== 'object' || nav === null || !('connection' in nav)) return undefined;
  const connection = (nav as { readonly connection?: unknown }).connection;
  return typeof connection === 'object' && connection !== null
    ? (connection as NetworkInformationLike)
    : undefined;
}

/** Sets or clears the attribute on `root` from the connection's current setting. */
export function applySaveData(root: Element, connection: NetworkInformationLike | undefined): void {
  if (connection?.saveData === true) root.setAttribute(SAVE_DATA_ATTRIBUTE, '');
  else root.removeAttribute(SAVE_DATA_ATTRIBUTE);
}

let mounted = 0;
let stop: (() => void) | undefined;

/** Starts following the setting for the whole page; returns the release for one picture. */
export function watchSaveData(): () => void {
  mounted += 1;
  if (mounted === 1 && typeof navigator !== 'undefined' && typeof document !== 'undefined') {
    const connection = connectionOf(navigator);
    if (connection) {
      const root = document.documentElement;
      const update = () => applySaveData(root, connection);
      update();
      connection.addEventListener?.('change', update);
      stop = () => connection.removeEventListener?.('change', update);
    }
  }
  return () => {
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

export function SaveDataFlag() {
  useEffect(() => watchSaveData(), []);
  return null;
}
