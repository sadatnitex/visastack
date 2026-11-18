'use client';

import { type ReactNode, useEffect, useState } from 'react';

/** How long each step rests, in milliseconds (the same pace as the kit's timed share sheet). */
export const SHARE_HERO_TICK_MS = 2200;

/**
 * The hero's share picture on its own clock, with the pause control WCAG 2.2.2 asks for: the five
 * steps loop every 2.2 s with no end, so a visible button stops them. It rests on the finished step
 * (Access Ended) with no script, reduced motion or data saver, and the button then never appears,
 * so there is never a dead control. Paused shows the finished step too; Play restarts from step 0.
 *
 * The five pictures (the kit's `ShareSheet` pinned to step 0 to 4) and the two button faces are
 * drawn on the server and handed in, so this client part carries no picture or icon code of its own
 * (the public JavaScript budget, WP-PUB1).
 */
export function ShareHero({
  steps,
  pauseFace,
  playFace,
}: {
  /** The share picture at each step, finished step last. */
  readonly steps: readonly ReactNode[];
  readonly pauseFace: ReactNode;
  readonly playFace: ReactNode;
}) {
  const last = steps.length - 1;
  const [moves, setMoves] = useState(false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(last);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saver = document.documentElement.hasAttribute('data-save-data');
    setMoves(!(reduced || saver));
  }, []);
  useEffect(() => {
    if (!moves || paused) {
      setStep(last);
      return;
    }
    setStep(0);
    const timer = window.setInterval(
      () => setStep((value) => (value + 1) % steps.length),
      SHARE_HERO_TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, [moves, paused, last, steps.length]);
  return (
    <div className="tr-share">
      {steps[step]}
      {moves ? (
        <button
          type="button"
          className="tr-pause"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? playFace : pauseFace}
        </button>
      ) : null}
    </div>
  );
}
