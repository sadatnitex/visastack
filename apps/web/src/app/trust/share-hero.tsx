'use client';

import { type ReactNode, cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import { useOnScreen } from '../../components/public-site/kit/use-on-screen';

/** How long each step rests, in milliseconds (the same pace as the kit's timed share sheet). */
export const SHARE_HERO_TICK_MS = 2200;

/**
 * Every step is the same picture, so it is given one key: React then keeps the same elements and
 * only changes their step, which lets the parts fade (a different key per step would swap the whole
 * picture at once, with no fade even in the gentle mode).
 */
function sheet(node: ReactNode): ReactNode {
  return isValidElement(node) ? cloneElement(node, { key: 'sheet' }) : node;
}

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
      {/* PUBFIX2 P2-6: all five steps sit in one cell, four of them hidden and only there to hold the
          height of the tallest, so the hero never grows or shrinks while the steps change (before:
          66 px on a phone, a layout shift of 0.04). */}
      <div className="tr-share-art">
        {steps.map((ghost, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the five steps are fixed and never reorder
          <div className="tr-share-ghost" aria-hidden="true" key={index}>
            {ghost}
          </div>
        ))}
        <div className="tr-share-live">{sheet(steps[step])}</div>
      </div>
      {/* Always in the markup so its space is reserved before hydration (no layout shift); idle,
          invisible and out of the tab order until the picture really moves. */}
      <button
        type="button"
        className="tr-pause"
        {...(moves ? {} : { 'data-idle': '', 'aria-hidden': true, tabIndex: -1 })}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? playFace : pauseFace}
      </button>
    </div>
  );
}
