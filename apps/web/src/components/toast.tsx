'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons';

/**
 * The short "done" strip at the bottom of the screen after an action, the way a banking or mail app
 * confirms one ("Successful", "Message sent"). It is a visual echo only: the words are already
 * said to screen readers and to people without scripts by the form's own message line
 * (`FormMessage`), so the strip is hidden from assistive technology and nothing is announced twice.
 * An error never goes here; it stays under the field it is about.
 *
 * One strip at a time: a newer one replaces the older and starts its own 4 seconds. It stays 4 seconds, waits while the pointer
 * or keyboard focus is on it, closes on its button or Escape, and only fades in when the person
 * has not asked for less motion (the stylesheet).
 */

/** How long the strip stays when nothing is holding it. */
export const TOAST_MS = 4000;
/** A strip older than this when a frame first appears was raised somewhere with no frame (a page outside the workspace). */
const STALE_ON_ARRIVAL_MS = 1000;

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly at: number;
}

let current: ToastItem | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ToastItem | null {
  return current;
}

/** Shows `message` in the strip. An empty message shows nothing. */
export function showToast(message: string): void {
  const words = message.trim();
  if (words === '') return;
  current = { id: nextId++, message: words, at: Date.now() };
  emit();
}

/** Closes the strip; with an id, only that strip (so an old timer never closes a newer one). */
export function dismissToast(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** Clears the store between tests. */
export function resetToastForTest(): void {
  current = null;
  nextId = 1;
  emit();
}

/**
 * Where the strip is drawn. Put it once in the signed-in frame. It reads the store, runs the
 * 4-second timer, and holds it while the pointer or focus is on the strip.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, snapshot, () => null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const remaining = useRef(TOAST_MS);
  const startedAt = useRef(0);
  const id = toast?.id;

  // A strip raised while no frame was on the page (a form outside the workspace) is old news. One
  // raised in this same moment (a notice read from the page address) is not.
  useEffect(() => {
    if (current && Date.now() - current.at >= STALE_ON_ARRIVAL_MS) dismissToast(current.id);
  }, []);

  // A new strip starts with the full time and nothing holding it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts for each new strip
  useEffect(() => {
    remaining.current = TOAST_MS;
    setHovered(false);
    setFocused(false);
  }, [id]);

  // The countdown. Holding the strip stops it and keeps what was left; letting go carries on.
  useEffect(() => {
    if (id === undefined || held) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissToast(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [id, held]);

  // Escape closes it for anyone at a keyboard, where the button is out of the tab order.
  useEffect(() => {
    if (id === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissToast(id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id]);

  if (!toast) return null;
  return (
    // Hidden from assistive technology on purpose: the form's own message line says the same words.
    <div className="toast-region" aria-hidden="true">
      <div
        key={toast.id}
        className="toast"
        data-held={held ? 'true' : undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <span className="toast-mark">
          <Icon name="check" size={18} />
        </span>
        <span className="toast-text">{toast.message}</span>
        {/* Out of the tab order: the hidden strip must hold nothing a keyboard can land on. */}
        <button
          type="button"
          className="toast-close"
          tabIndex={-1}
          aria-label="Dismiss"
          onClick={() => dismissToast(toast.id)}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
