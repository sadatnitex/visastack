'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { countriesPublicCatalog } from '../../i18n/countries-public';
import { useT } from '../i18n-provider';

/**
 * One switch for everything on the Countries page that moves by itself (WCAG 2.2.2): the typing
 * demo and the flag ribbon. The state lives on the page's root element, so the ribbon (plain CSS)
 * and the search (a client part) both read the same place, and a reload starts moving again.
 */
const ATTRIBUTE = 'data-r4-motion';
const EVENT = 'r4-motion';

function read(): boolean {
  return document.documentElement.getAttribute(ATTRIBUTE) === 'paused';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** True while a person has paused the page's motion. Always false on the server. */
export function useMotionPaused(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

function write(paused: boolean): void {
  if (paused) document.documentElement.setAttribute(ATTRIBUTE, 'paused');
  else document.documentElement.removeAttribute(ATTRIBUTE);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The visible Pause or Play button. It exists only where something moves: not without script and
 * not under reduced motion, where nothing starts by itself.
 */
export function MotionToggle() {
  const t = useT(countriesPublicCatalog);
  const paused = useMotionPaused();
  const [moves, setMoves] = useState(false);
  useEffect(() => {
    setMoves(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return () => write(false);
  }, []);
  if (!moves) return null;
  return (
    <button
      type="button"
      className="pub-button pub-button-secondary r4-motion-toggle"
      aria-pressed={paused}
      onClick={() => write(!paused)}
    >
      {paused ? t.node('countriesPublic.motion.play') : t.node('countriesPublic.motion.pause')}
    </button>
  );
}
