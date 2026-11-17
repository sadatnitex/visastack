'use client';

import { useEffect } from 'react';
import { SAVE_DATA_ATTRIBUTE } from '../pictures/save-data-flag';
import { type SceneHandle, startScenes } from './scene-engine';

/** Below this width scenes stay still (owner, 17 Nov 2026: phones keep still pictures). */
export const SCENE_MIN_WIDTH = 760;

/**
 * Starts the scroll engine for the scenes on the page and renders nothing. It starts again when
 * the visitor's motion setting, the screen width or data saver changes, and stops on the way out.
 */
export function ScenesRuntime() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const html = document.documentElement;
    const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia(`(min-width: ${SCENE_MIN_WIDTH}px)`);
    let handle: SceneHandle = { stop() {} };
    const start = () => {
      handle.stop();
      handle = startScenes(document, {
        reduce: lessMotion.matches || !wide.matches,
        saveData: html.hasAttribute(SAVE_DATA_ATTRIBUTE),
      });
    };
    start();
    lessMotion.addEventListener('change', start);
    wide.addEventListener('change', start);
    const saver = typeof MutationObserver === 'function' ? new MutationObserver(start) : null;
    saver?.observe(html, { attributes: true, attributeFilter: [SAVE_DATA_ATTRIBUTE] });
    return () => {
      lessMotion.removeEventListener('change', start);
      wide.removeEventListener('change', start);
      saver?.disconnect();
      handle.stop();
    };
  }, []);
  return null;
}
