'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useOnScreen } from '../../components/public-site/kit/use-on-screen';

/** How long each step rests, in milliseconds (the same pace as the kit's timed share sheet). */
export const SHARE_HERO_TICK_MS = 2200;

/**
 * The hero's share picture on its own clock, with the pause control WCAG 2.2.2 asks for: the five
 * steps loop every 2.2 s with no end, so a visible button stops them. It rests on the finished step
 * (Access Ended) with no script. With script it plays for every visitor and on every screen (MOT1,
 * owner 18 Nov 2026: motion is always on, gentle fades with reduced motion, see kit/kit.css), but
 * only while it is on screen and the tab is showing. Paused shows the finished step too; Play
 * restarts from step 0.
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
  const box = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(box, moves);

  useEffect(() => {
    setMoves(true);
  }, []);

  // Starting, or pressing Play, begins at step 0; Pause shows the finished step.
  useEffect(() => {
    setStep(moves && !paused ? 0 : last);
  }, [moves, paused, last]);

  const running = moves && !paused && visible;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setStep((value) => (value + 1) % steps.length),
      SHARE_HERO_TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, [running, steps.length]);

  return (
    <div className="tr-share" ref={box}>
      {steps[step]}
      {moves ? (
        <button type="button" className="tr-pause" onClick={() => setPaused((value) => !value)}>
          {paused ? playFace : pauseFace}
        </button>
      ) : null}
    </div>
  );
}
