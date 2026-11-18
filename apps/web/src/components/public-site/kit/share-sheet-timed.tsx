'use client';

import { useEffect, useState } from 'react';
import { SAVE_DATA_ATTRIBUTE } from '../../pictures/save-data-flag';
import { SHARE_STEPS, ShareSheetBody, type ShareStep } from './share-sheet-body';

/** How long each step rests, in milliseconds. */
export const SHARE_TICK_MS = 2200;

/**
 * The sharing picture on its own clock. It starts finished (the server's markup), so with no
 * JavaScript, reduced motion or data saver it rests on `Access Ended`. With motion it runs steps
 * 0 to 4 in turn, and starts again.
 */
export function ShareSheetTimed({ pageLang = 'en' }: { readonly pageLang?: string }) {
  const [step, setStep] = useState<ShareStep>(4);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const html = document.documentElement;
    const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (lessMotion.matches || html.hasAttribute(SAVE_DATA_ATTRIBUTE)) return;
    setStep(0);
    const timer = window.setInterval(
      () => setStep((value) => ((value + 1) % SHARE_STEPS) as ShareStep),
      SHARE_TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, []);
  return <ShareSheetBody step={step} pageLang={pageLang} />;
}
