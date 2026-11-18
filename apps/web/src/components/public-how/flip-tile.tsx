'use client';

import { type ReactNode, useState } from 'react';

export interface FlipTileProps {
  /** The word on the front. */
  readonly word: ReactNode;
  /** "is not Reviewed" and the plain meaning, read in order after the word. */
  readonly not: ReactNode;
  readonly means: ReactNode;
}

/**
 * A tile that turns over to show what a word means. It is a button (aria-pressed), the whole text
 * is always in the page for a screen reader, and it is shown in full without script or motion.
 */
export function FlipTile({ word, not, means }: FlipTileProps) {
  const [turned, setTurned] = useState(false);
  return (
    <button
      type="button"
      className="hk-flip"
      aria-pressed={turned}
      onClick={() => setTurned((value) => !value)}
    >
      <span className="hk-flip-front">{word}</span>
      <span className="hk-flip-back">
        <span className="hk-flip-not">{not}</span>
        <span className="hk-flip-means">{means}</span>
      </span>
    </button>
  );
}
