/**
 * The scroll engine for the public site's scroll scenes (WP-PUB1, ADR 0029). Pure and
 * dependency-free, small enough to ride on any public page (budget: 2 KB gzipped, checked by
 * `scripts/programme/check-public-budget.mjs`).
 *
 * Markup contract, written by `<Scene>` on the server:
 * - `[data-scene]` marks a scene; `data-steps` is how many steps it has and `data-step` is the
 *   step it shows; `data-rest` repeats the finished step and never changes. The server always
 *   writes the FINISHED step, so a page without JavaScript shows every scene complete and still.
 * - While motion is allowed the engine sets `html[data-scenes="live"]` (the stylesheet pins scenes
 *   only then), and keeps `--p` (0..1, how far through the scene) and `data-step` up to date.
 * - MOT1 (ADR 0029 amendment, 18 Nov 2026): three motion modes from one rule, `sceneMode()`.
 *   "pinned" (above) where SCENE_SCREEN_QUERY matches; "reveal" everywhere else (phones, short or
 *   zoomed windows): `html[data-scenes="reveal"]`, nothing pinned, no added height, each scene plays
 *   its steps once as it comes into view (scene-reveal.ts); "gentle" for anyone whose device asks
 *   for less motion, on any screen: the same steps as crossfades and moves of 8 px or less, nothing
 *   pinned, slid or scaled. `html[data-scene-mode]` names the mode. Data saver never stops motion.
 *
 * One passive scroll listener, throttled to one update per animation frame, plus one
 * IntersectionObserver so only scenes near the screen are measured. Resizing and coming back
 * from the back-forward cache measure again. `stop()` removes every listener, the observer and
 * every attribute the engine wrote, and puts back the finished step.
 */

import { startReveal } from './scene-reveal';

export interface SceneBox {
  /** The scene's top edge relative to the top of the screen, in CSS pixels. */
  readonly top: number;
  /** The scene's full height, in CSS pixels. */
  readonly height: number;
}

export interface SceneOptions {
  /** "pinned" (scroll scenes, the default), "reveal" (phones, short windows) or "gentle" (less motion). */
  readonly mode?: SceneMode;
  /** Reveal and gentle only: false rests every scene finished (a mode switch, so nothing replays). Default true. */
  readonly animate?: boolean;
}

/** How scenes move for this visitor (see the header). */
export type SceneMode = 'pinned' | 'reveal' | 'gentle';

export interface SceneHandle {
  stop(): void;
}

/** The attribute on `html` that tells the stylesheet scenes are moving ("live" pinned, "reveal", "gentle"). */
export const SCENES_ATTRIBUTE = 'data-scenes';
/** The attribute on `html` that names the mode, set with SCENES_ATTRIBUTE and removed with it. */
export const SCENE_MODE_ATTRIBUTE = 'data-scene-mode';

/**
 * How far through a pinned scene the visitor has scrolled, from 0 (its top has just reached the
 * pinned line) to 1 (its end is leaving). `offset` is where the stage pins, below the sticky
 * header; the stage is the screen height minus it. A scene no taller than that counts as finished
 * once its top has reached the line. Never outside 0..1, never NaN.
 */
export function progressFor(box: SceneBox, viewportHeight: number, offset = 0): number {
  const travel = box.height - (viewportHeight - offset);
  const scrolled = offset - box.top;
  const raw = travel > 0 ? scrolled / travel : box.top <= offset ? 1 : 0;
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
}

/** The step a progress shows, from 0 to `steps - 1`, with equal parts per step. */
export function stepFor(progress: number, steps: number): number {
  const count = Math.max(1, Math.floor(Number.isFinite(steps) ? steps : 1));
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.min(count - 1, Math.floor(p * count));
}

/** Below this width scenes are not pinned (owner, 18 Nov 2026: phones get reveal motion instead). */
export const SCENE_MIN_WIDTH = 760;
/**
 * Below this height scenes are not pinned either: a pinned stage is one screen high, so on a short or
 * zoomed screen its words could be cut off (WCAG 1.4.10 reflow). They reveal instead.
 */
export const SCENE_MIN_HEIGHT = 600;
/** The screens on which scenes may be pinned. */
export const SCENE_SCREEN_QUERY = `(min-width: ${SCENE_MIN_WIDTH}px) and (min-height: ${SCENE_MIN_HEIGHT}px)`;

/**
 * The one rule for the mode: gentle for a visitor whose device asks for less motion (any screen),
 * else pinned where the screen matches SCENE_SCREEN_QUERY, else reveal. Data saver changes nothing.
 */
export function sceneMode(screenMatches: boolean, reduceMotion: boolean): SceneMode {
  return reduceMotion ? 'gentle' : screenMatches ? 'pinned' : 'reveal';
}

/**
 * The early scenes mark: a tiny same-site file the root layout loads in the page head, nonce'd and
 * synchronous, so it runs before the first paint and a scene has its scroll length from the start
 * (nothing jumps when the page comes to life). It runs the same rule as the runtime: sceneMode() of
 * SCENE_SCREEN_QUERY and the reduced-motion query. Without JavaScript it never runs
 * and every scene stays an ordinary finished section. The file itself (public/scenes-boot.js) is
 * the one source; a test runs it and checks it uses this query and attribute.
 */
export const SCENES_BOOT_SRC = '/scenes-boot.js';

interface Tracked {
  readonly element: HTMLElement;
  readonly stage: HTMLElement | null;
  readonly steps: number;
  /** The narrowest screen on which this scene moves (data-min-width); below it, it rests finished. */
  readonly minWidth: number;
  readonly finished: string | null;
  /** Reveal mode only: the step a scene plays up to (data-play-to), or null. */
  readonly playTo: number | null;
  /** What the engine last wrote, so an unchanged value is never written again. */
  p: string;
  step: string;
}

/** The pinned line below the sticky header, read from a stage's own sticky top. */
function pinLine(win: Window, scenes: readonly Tracked[]): number {
  const stage = scenes.find((scene) => scene.stage)?.stage;
  const top = stage ? Number.parseFloat(win.getComputedStyle(stage).top) : 0;
  return Number.isFinite(top) ? Math.max(0, top) : 0;
}

/**
 * Starts the scenes under `root` in `options.mode`. In "reveal" and "gentle" mode the scenes play
 * once as they come into view instead of being pinned. The returned handle undoes everything it
 * did and puts back every scene's finished step. Without a window nothing is written.
 */
export function startScenes(root: Document | Element, options: SceneOptions): SceneHandle {
  const doc = 'documentElement' in root ? root : root.ownerDocument;
  const win = doc.defaultView;
  const html = doc.documentElement;
  const scenes: Tracked[] = [...root.querySelectorAll<HTMLElement>('[data-scene]')].map(
    (element) => ({
      element,
      stage: element.querySelector<HTMLElement>('.pub-scene-stage'),
      steps: Number(element.getAttribute('data-steps') ?? '1') || 1,
      minWidth: Number(element.getAttribute('data-min-width') ?? '0') || 0,
      finished: element.getAttribute('data-step'),
      playTo: element.hasAttribute('data-play-to')
        ? Number(element.getAttribute('data-play-to'))
        : null,
      p: '',
      step: element.getAttribute('data-step') ?? '',
    }),
  );
  const clearMarks = () => {
    html.removeAttribute(SCENES_ATTRIBUTE);
    html.removeAttribute(SCENE_MODE_ATTRIBUTE);
  };
  if (!win) return { stop() {} };
  const mode = options.mode ?? 'pinned';
  if (scenes.length === 0 && mode === 'pinned') {
    // No scenes here, but the page's other parts (rises, timed pictures) read the mode marks.
    html.setAttribute(SCENES_ATTRIBUTE, 'live');
    html.setAttribute(SCENE_MODE_ATTRIBUTE, 'pinned');
    return { stop: clearMarks };
  }
  if (mode !== 'pinned')
    return startReveal(win, scenes, options.animate !== false, mode === 'gentle', {
      set() {
        html.setAttribute(SCENES_ATTRIBUTE, mode);
        html.setAttribute(SCENE_MODE_ATTRIBUTE, mode);
      },
      clear: clearMarks,
    });

  const near = new Set<Tracked>(typeof win.IntersectionObserver === 'function' ? [] : scenes);
  let frame = 0;
  let viewport = win.innerHeight;
  let line = 0;

  // Every box is read before anything is written, so the browser lays the page out once.
  const paint = (list: Iterable<Tracked>) => {
    const batch = [...list];
    const boxes = batch.map((scene) => scene.element.getBoundingClientRect());
    batch.forEach((scene, index) => {
      if (scene.minWidth > win.innerWidth) {
        // Too narrow for this scene to move: leave it finished and still.
        if (scene.p !== '') {
          scene.element.style.removeProperty('--p');
          if (scene.finished !== null) scene.element.setAttribute('data-step', scene.finished);
        }
        scene.p = '';
        scene.step = scene.finished ?? '';
        return;
      }
      const box = boxes[index] as DOMRect;
      const progress = progressFor({ top: box.top, height: box.height }, viewport, line);
      const p = progress.toFixed(4);
      const step = String(stepFor(progress, scene.steps));
      if (p !== scene.p) scene.element.style.setProperty('--p', p);
      if (step !== scene.step) scene.element.setAttribute('data-step', step);
      scene.p = p;
      scene.step = step;
    });
  };
  const update = () => {
    frame = 0;
    paint(near);
  };
  const schedule = () => {
    if (frame === 0) frame = win.requestAnimationFrame(update);
  };
  const measure = () => {
    viewport = win.innerHeight;
    line = pinLine(win, scenes);
    paint(scenes);
  };

  const observer =
    typeof win.IntersectionObserver === 'function'
      ? new win.IntersectionObserver(
          (entries) => {
            const leaving: Tracked[] = [];
            for (const entry of entries) {
              const scene = scenes.find((s) => s.element === entry.target);
              if (!scene) continue;
              if (entry.isIntersecting) near.add(scene);
              else {
                near.delete(scene);
                leaving.push(scene);
              }
            }
            paint(leaving);
            schedule();
          },
          { rootMargin: '50% 0px' },
        )
      : null;

  html.setAttribute(SCENES_ATTRIBUTE, 'live');
  html.setAttribute(SCENE_MODE_ATTRIBUTE, 'pinned');
  for (const scene of scenes) observer?.observe(scene.element);
  measure();
  const passive = { passive: true } as const;
  win.addEventListener('scroll', schedule, passive);
  win.addEventListener('resize', measure, passive);
  win.addEventListener('pageshow', measure, passive);

  return {
    stop() {
      win.removeEventListener('scroll', schedule);
      win.removeEventListener('resize', measure);
      win.removeEventListener('pageshow', measure);
      observer?.disconnect();
      if (frame !== 0) win.cancelAnimationFrame(frame);
      frame = 0;
      near.clear();
      clearMarks();
      for (const scene of scenes) {
        scene.element.style.removeProperty('--p');
        if (scene.finished === null) scene.element.removeAttribute('data-step');
        else scene.element.setAttribute('data-step', scene.finished);
      }
    },
  };
}
