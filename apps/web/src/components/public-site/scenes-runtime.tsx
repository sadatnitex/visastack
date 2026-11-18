'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { SCENE_SCREEN_QUERY, type SceneHandle, sceneMode, startScenes } from './scene-engine';

/**
 * Starts the scroll engine for the scenes on the page and renders nothing. It starts again when
 * the visitor's motion setting or the screen changes, and stops on the way out. The motion setting
 * and the screen decide the mode (sceneMode: gentle for less motion, else pinned scroll scenes, or
 * reveal on phones and short or zoomed windows); data saver changes nothing. A restart after the
 * first one never replays a scene, it just rests it finished.
 */
export function ScenesRuntime() {
  // A new page brings new scenes: start again on every navigation, even inside a shared layout.
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path means new scenes to find
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia(SCENE_SCREEN_QUERY);
    let handle: SceneHandle = { stop() {} };
    let first = true;
    const start = () => {
      handle.stop();
      handle = startScenes(document, {
        mode: sceneMode(wide.matches, lessMotion.matches),
        animate: first,
      });
      first = false;
    };
    start();
    lessMotion.addEventListener('change', start);
    wide.addEventListener('change', start);
    return () => {
      lessMotion.removeEventListener('change', start);
      wide.removeEventListener('change', start);
      handle.stop();
    };
  }, [pathname]);
  return null;
}
