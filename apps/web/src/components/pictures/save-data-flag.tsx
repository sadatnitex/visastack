'use client';

import { useEffect } from 'react';

/**
 * Keeps picture motion still when the browser says data saver is on (ADR 0027).
 *
 * The root layout marks the first paint from the `Save-Data` request header
 * (`save-data-request.ts`) and mounts this once. In the browser it then adds `data-save-data` to
 * the `html` element when `navigator.connection.saveData` is true, and follows the setting when it
 * changes while the page is open. It never clears a mark the server set from the header unless the
 * browser later reports a change. Browsers without the Network Information API (Safari, Firefox)
 * are left alone. Nothing is drawn, sent or stored.
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

/** Marks the page now if data saver is on, then follows changes; returns the clean-up. */
export function watchSaveData(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return () => undefined;
  const connection = connectionOf(navigator);
  if (!connection) return () => undefined;
  const root = document.documentElement;
  if (connection.saveData === true) root.setAttribute(SAVE_DATA_ATTRIBUTE, '');
  const update = () => applySaveData(root, connection);
  connection.addEventListener?.('change', update);
  return () => connection.removeEventListener?.('change', update);
}

/** Mounted once, in the root layout. Renders nothing. */
export function SaveDataFlag() {
  useEffect(() => watchSaveData(), []);
  return null;
}
