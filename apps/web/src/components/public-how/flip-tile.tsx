'use client';

import { type ReactNode, useId, useState, useSyncExternalStore } from 'react';

export interface FlipTileProps {
  /** The word on the front. */
  readonly word: ReactNode;
  /** "is not Reviewed", read straight after the word. */
  readonly not: ReactNode;
  /** The plain meaning. */
  readonly means: ReactNode;
}

/** True while the scroll engine runs (motion welcome, a wide screen): html[data-scenes="live"]. */
function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => {};
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scenes'] });
  return () => watcher.disconnect();
}

function isLive(): boolean {
  return document.documentElement.getAttribute('data-scenes') === 'live';
}

/**
 * A word tile. Where the meaning is always shown (no script, reduced motion, data saver, a phone)
 * it is a plain tile with nothing to press. While the scroll engine runs it is a disclosure: the
 * button says the word and what it is not, and opens the plain meaning (aria-expanded and
 * aria-controls), so a screen reader hears the state change.
 */
export function FlipTile({ word, not, means }: FlipTileProps) {
  const live = useSyncExternalStore(subscribe, isLive, () => false);
  const [open, setOpen] = useState(false);
  const panel = useId();
  if (!live) {
    return (
      <div className="hk-flip hk-flip-static">
        <span className="hk-flip-front">{word}</span>
        <span className="hk-flip-not">{not}</span>
        <span className="hk-flip-means">{means}</span>
      </div>
    );
  }
  return (
    <div className="hk-flip" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="hk-flip-button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hk-flip-front">{word}</span>
        <span className="hk-flip-not">{not}</span>
      </button>
      <p className="hk-flip-means" id={panel} hidden={!open}>
        {means}
      </p>
    </div>
  );
}
