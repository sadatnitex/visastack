/**
 * Reveal and gentle modes for the public site's scenes (MOT1, ADR 0029 amendment of 18 November
 * 2026): reveal is the light motion for phones and for short or zoomed windows, gentle is the same
 * play for visitors whose device asks for less motion (crossfades and moves of 8 px or less: the
 * engine then writes no `--p`, so nothing slides or scales). Nothing is pinned and no height is
 * added: when a scene is meaningfully on screen it plays its steps once, from the first to the
 * finished one, and then rests finished. A scene far from the screen keeps the server's finished
 * step; it is set to its first step only when it is within a screen of coming into view (the
 * arming observer), and plays when a quarter of it shows (the playing observer). There is no
 * scroll listener, and a few timers run only while a scene is playing on a visible tab. Leaving
 * the screen mid-play snaps the scene to its finished step, so nothing is ever left half drawn.
 * Known limit: a scene already on screen at load was painted finished by the server, so right after
 * the page comes to life it goes back to its first step and plays (no layout change, only the
 * picture restarts).
 *
 * The stylesheet moves things with transform and opacity only, from `data-step` and `--p`, and
 * only under `html[data-scenes="reveal"]` (kit.css). The whole play is kept under 5 seconds, so no
 * Pause button is needed (WCAG 2.2.2); longer loops carry one (kit/share-sheet-timed.tsx).
 */

import type { SceneHandle } from './scene-engine';

/** What reveal mode needs to know about a scene (the engine's own record satisfies it). */
export interface RevealScene {
  readonly element: HTMLElement;
  readonly steps: number;
  /** The finished step the server wrote, or null when the scene had none. */
  readonly finished: string | null;
  /** Reveal mode only: the step to play up to and rest on, when it is not the finished step. */
  readonly playTo?: number | null;
}

/** How the engine marks and unmarks the page, so the attribute names live in one place (scene-engine.ts). */
export interface RevealMarks {
  set(): void;
  clear(): void;
}

/** The longest a step rests, in milliseconds. */
export const REVEAL_STEP_MS = 600;
/** The whole play of a scene never takes longer than this (steps get shorter instead). */
export const REVEAL_TOTAL_MS = 4000;
/**
 * A step never rests less than this, so a scene (12 steps at most) never changes more than three
 * times a second (WCAG 2.3.1: nothing flashes more than 3 times per second).
 */
export const REVEAL_MIN_STEP_MS = 340;

/** How long each step rests for a scene with `last` steps to play (the first step is already shown). */
export function stepEvery(last: number): number {
  return Math.max(
    REVEAL_MIN_STEP_MS,
    Math.min(REVEAL_STEP_MS, Math.floor(REVEAL_TOTAL_MS / Math.max(1, last))),
  );
}
/** The ratios at which the playing observer reports, fine enough for scenes far taller than the screen. */
export const REVEAL_THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);
/** The share of a scene that must show for it to count as meaningfully on screen. */
export const REVEAL_RATIO = 0.25;
/** A tall scene counts once this share of the screen height shows of it. */
export const REVEAL_SCREEN_SHARE = 0.4;
/** How far below the screen a scene is set to its first step, so it is ready before it shows. */
export const REVEAL_ARM_MARGIN = '0px 0px 80% 0px';
/**
 * The mark on a scene once armed: "ready" (at its first step, waiting), "playing", "done" (played to
 * its end) or "snapped" (finished without playing: it left the screen or was passed).
 */
export const REVEAL_ATTRIBUTE = 'data-reveal';

interface Playing {
  readonly scene: RevealScene;
  readonly last: number;
  readonly every: number;
  at: number;
  timer: number;
  state: 'idle' | 'ready' | 'playing' | 'done';
  /** Meaningfully on screen while the tab was hidden: plays as soon as the tab shows. */
  wants: boolean;
}

function lastStep(scene: RevealScene, gentle: boolean): number {
  const top = Math.max(0, Math.floor(scene.steps) - 1);
  // A scene with its own end (data-play-to) plays to it in reveal mode; gentle mode, with its
  // fades only, keeps the finished step the server wrote.
  if (
    !gentle &&
    scene.playTo !== undefined &&
    scene.playTo !== null &&
    Number.isFinite(scene.playTo)
  )
    return Math.min(top, Math.max(0, Math.floor(scene.playTo)));
  const finished = Number(scene.finished);
  return scene.finished !== null && Number.isFinite(finished)
    ? Math.min(top, Math.max(0, finished))
    : top;
}

/**
 * Starts reveal or gentle mode for `scenes`. With `animate` false (a mode switch, or a visitor who
 * just turned something on) a scene already at or above the bottom of the screen rests finished and
 * is never replayed; scenes still below it wait and play when they come into view. The handle
 * undoes everything.
 */
export function startReveal(
  win: Window & typeof globalThis,
  scenes: readonly RevealScene[],
  animate: boolean,
  gentle: boolean,
  marks: RevealMarks,
): SceneHandle {
  const doc = win.document;
  marks.set();

  const items = new Map<Element, Playing>();
  const timers = (item: Playing) => {
    win.clearTimeout(item.timer);
    item.timer = 0;
  };
  /** Rests a scene finished. `snap` (it left the screen or was scrolled past) skips the easing of --p. */
  const rest = (item: Playing, snap = false) => {
    timers(item);
    item.state = 'done';
    const { element } = item.scene;
    // The scene's own end (its last played step), else the finished step the server wrote.
    const end = !gentle && item.scene.playTo != null ? String(item.last) : item.scene.finished;
    element.style.removeProperty('--p');
    if (end === null) element.removeAttribute('data-step');
    else element.setAttribute('data-step', end);
    element.setAttribute(REVEAL_ATTRIBUTE, snap ? 'snapped' : 'done');
    arming?.unobserve(element);
    observer?.unobserve(element);
  };
  const show = (item: Playing, step: number) => {
    const { element } = item.scene;
    element.setAttribute('data-step', String(step));
    // Progress runs 0 to 1 over the steps that are played, so the last one lands on the finished look.
    if (!gentle)
      element.style.setProperty('--p', (item.last > 0 ? step / item.last : 1).toFixed(3));
  };
  const tick = (item: Playing) => {
    item.timer = 0;
    item.at += 1;
    show(item, item.at);
    if (item.at >= item.last) rest(item);
    else item.timer = win.setTimeout(() => tick(item), item.every);
  };
  const play = (item: Playing) => {
    if (item.state === 'done' || item.timer !== 0) return;
    if (item.state === 'ready') {
      item.state = 'playing';
      item.scene.element.setAttribute(REVEAL_ATTRIBUTE, 'playing');
    }
    if (item.at >= item.last) return rest(item);
    item.timer = win.setTimeout(() => tick(item), item.every);
  };

  const arm = (item: Playing) => {
    if (item.state !== 'idle') return;
    item.state = 'ready';
    // The reset to the first step: the mark "ready" keeps transitions off for it.
    item.scene.element.setAttribute(REVEAL_ATTRIBUTE, 'ready');
    show(item, 0);
    arming?.unobserve(item.scene.element);
    observer?.observe(item.scene.element);
  };

  const meaningful = (entry: IntersectionObserverEntry) =>
    entry.isIntersecting &&
    (entry.intersectionRatio >= REVEAL_RATIO ||
      entry.intersectionRect.height >= win.innerHeight * REVEAL_SCREEN_SHARE);

  const watching = typeof win.IntersectionObserver === 'function';
  const arming = watching
    ? new win.IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const item = items.get(entry.target);
            if (item && entry.isIntersecting) arm(item);
          }
        },
        { rootMargin: REVEAL_ARM_MARGIN },
      )
    : null;
  const observer = watching
    ? new win.IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const item = items.get(entry.target);
            if (!item || item.state === 'done') continue;
            item.wants = meaningful(entry);
            if (item.wants) {
              if (!doc.hidden) play(item);
            } else if (!entry.isIntersecting) {
              // Left the screen mid-play, or was scrolled past before it ever played. A scene still
              // partly on screen that dips below the threshold keeps playing.
              if (item.state === 'playing' || entry.boundingClientRect.bottom <= 0)
                rest(item, true);
            }
          }
        },
        { threshold: REVEAL_THRESHOLDS },
      )
    : null;

  for (const scene of scenes) {
    const last = lastStep(scene, gentle);
    const item: Playing = {
      scene,
      last,
      every: stepEvery(last),
      at: 0,
      timer: 0,
      state: 'idle',
      wants: false,
    };
    const behind = !animate && scene.element.getBoundingClientRect().top < win.innerHeight;
    if (!arming || last === 0 || behind) {
      scene.element.setAttribute(REVEAL_ATTRIBUTE, 'done');
      item.state = 'done';
    } else {
      item.state = 'idle';
      items.set(scene.element, item);
      arming.observe(scene.element);
    }
  }

  // A hidden tab pauses the plays; coming back continues the ones still on screen.
  const visibility = () => {
    for (const item of items.values()) {
      if (doc.hidden) timers(item);
      else if (item.state === 'playing' || (item.state === 'ready' && item.wants)) play(item);
    }
  };
  doc.addEventListener('visibilitychange', visibility);

  return {
    stop() {
      doc.removeEventListener('visibilitychange', visibility);
      arming?.disconnect();
      observer?.disconnect();
      for (const item of items.values()) timers(item);
      items.clear();
      marks.clear();
      for (const { element, finished } of scenes) {
        element.style.removeProperty('--p');
        element.removeAttribute(REVEAL_ATTRIBUTE);
        if (finished === null) element.removeAttribute('data-step');
        else element.setAttribute('data-step', finished);
      }
    },
  };
}
