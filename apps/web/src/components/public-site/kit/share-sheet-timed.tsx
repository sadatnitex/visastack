'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { SHARE_STEPS, type ShareStep } from './share-steps';
import { useOnScreen } from './use-on-screen';

/** How long each step rests, in milliseconds. */
export const SHARE_TICK_MS = 2200;

/**
 * The sharing picture on its own clock. It starts finished (the server's markup), so with no
 * JavaScript it rests on `Access Ended`. Otherwise it runs steps 0 to 4 in turn, and starts again,
 * on every screen and for every visitor (MOT1, owner 18 Nov 2026: motion is always on, gentle with
 * reduced motion, see kit.css), but only while it is on screen and the tab is showing, and a
 * visible Pause button (WCAG 2.2.2: the loop is longer than 5 seconds) stops it where it is; Play
 * carries on from there.
 */
export function ShareSheetTimed({
  bodies,
  playLabel,
  pauseLabel,
}: {
  /** The picture at each step, drawn on the server in the visitor's language (the browser holds no wording). */
  readonly bodies: readonly ReactNode[];
  readonly playLabel: ReactNode;
  readonly pauseLabel: ReactNode;
}) {
  const [step, setStep] = useState<ShareStep>(4);
  const [moves, setMoves] = useState(false);
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(box, moves);

  useEffect(() => {
    setStep(0);
    setMoves(true);
  }, []);

  const running = moves && visible && !paused;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setStep((value) => ((value + 1) % SHARE_STEPS) as ShareStep),
      SHARE_TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div className="kit-timed" ref={box}>
      {bodies[step]}
      {/* Always in the markup so its space is reserved before hydration (no layout shift); idle,
          invisible and out of the tab order until the picture really moves. */}
      <button
        type="button"
        className="pub-button pub-button-secondary kit-pause"
        {...(moves ? {} : { 'data-idle': '', 'aria-hidden': true, tabIndex: -1 })}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? playLabel : pauseLabel}
      </button>
    </div>
  );
}
