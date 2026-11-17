/**
 * The scroll engine for the public site's scroll scenes (WP-PUB1, ADR 0029). Pure and
 * dependency-free, small enough to ride on any public page (budget: 2 KB gzipped, checked by
 * `scripts/programme/check-public-budget.mjs`).
 *
 * Markup contract, written by `<Scene>` on the server:
 * - `[data-scene]` marks a scene; `data-steps` is how many steps it has and `data-step` is the
 *   step it shows. The server always writes the FINISHED step, so a page without JavaScript, with
 *   reduced motion or with data saver shows every scene complete and still.
 * - While motion is allowed the engine sets `html[data-scenes="live"]` (the stylesheet pins scenes
 *   only then), and keeps `--p` (0..1, how far through the scene) and `data-step` up to date.
 *
 * One passive scroll listener, throttled to one update per animation frame, plus one
 * IntersectionObserver so only scenes near the screen are measured. Resizing and coming back
 * from the back-forward cache measure again. `stop()` removes every listener, the observer and
 * every attribute the engine wrote, and puts back the finished step.
 */

export interface SceneBox {
  /** The scene's top edge relative to the top of the screen, in CSS pixels. */
  readonly top: number;
  /** The scene's full height, in CSS pixels. */
  readonly height: number;
}

export interface SceneOptions {
  /** True when the visitor asked for less motion (or the screen is too small for scenes). */
  readonly reduce: boolean;
  /** True when the browser says data saver is on. */
  readonly saveData: boolean;
}

export interface SceneHandle {
  stop(): void;
}

/** The attribute on `html` that tells the stylesheet scenes are moving. */
export const SCENES_ATTRIBUTE = 'data-scenes';

/**
 * How far through a pinned scene the visitor has scrolled, from 0 (its top has just reached the
 * top of the screen) to 1 (its end is leaving). A scene no taller than the screen counts as
 * finished once its top has reached the top. Never outside 0..1, never NaN.
 */
export function progressFor(box: SceneBox, viewportHeight: number): number {
  const travel = box.height - viewportHeight;
  const raw = travel > 0 ? -box.top / travel : box.top <= 0 ? 1 : 0;
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
}

/** The step a progress shows, from 0 to `steps - 1`, with equal parts per step. */
export function stepFor(progress: number, steps: number): number {
  const count = Math.max(1, Math.floor(Number.isFinite(steps) ? steps : 1));
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.min(count - 1, Math.floor(p * count));
}

interface Tracked {
  readonly element: HTMLElement;
  readonly steps: number;
  readonly finished: string | null;
}

/**
 * Starts the scenes under `root`. With reduced motion or data saver it writes nothing: the
 * server-rendered finished steps stay. The returned handle undoes everything it did.
 */
export function startScenes(root: Document | Element, options: SceneOptions): SceneHandle {
  const doc = 'documentElement' in root ? root : root.ownerDocument;
  const win = doc.defaultView;
  const scenes: Tracked[] = [...root.querySelectorAll<HTMLElement>('[data-scene]')].map(
    (element) => ({
      element,
      steps: Number(element.getAttribute('data-steps') ?? '1') || 1,
      finished: element.getAttribute('data-step'),
    }),
  );
  if (options.reduce || options.saveData || !win || scenes.length === 0) return { stop() {} };

  const html = doc.documentElement;
  const near = new Set<Tracked>(typeof win.IntersectionObserver === 'function' ? [] : scenes);
  let frame = 0;
  let viewport = win.innerHeight;

  const paint = (scene: Tracked) => {
    const box = scene.element.getBoundingClientRect();
    const p = progressFor({ top: box.top, height: box.height }, viewport);
    scene.element.style.setProperty('--p', p.toFixed(4));
    scene.element.setAttribute('data-step', String(stepFor(p, scene.steps)));
  };
  const update = () => {
    frame = 0;
    for (const scene of near) paint(scene);
  };
  const schedule = () => {
    if (frame === 0) frame = win.requestAnimationFrame(update);
  };
  const measure = () => {
    viewport = win.innerHeight;
    for (const scene of scenes) paint(scene);
  };

  const observer =
    typeof win.IntersectionObserver === 'function'
      ? new win.IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const scene = scenes.find((s) => s.element === entry.target);
              if (!scene) continue;
              if (entry.isIntersecting) near.add(scene);
              else {
                near.delete(scene);
                paint(scene);
              }
            }
            schedule();
          },
          { rootMargin: '50% 0px' },
        )
      : null;

  html.setAttribute(SCENES_ATTRIBUTE, 'live');
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
      html.removeAttribute(SCENES_ATTRIBUTE);
      for (const scene of scenes) {
        scene.element.style.removeProperty('--p');
        if (scene.finished === null) scene.element.removeAttribute('data-step');
        else scene.element.setAttribute('data-step', scene.finished);
      }
    },
  };
}
