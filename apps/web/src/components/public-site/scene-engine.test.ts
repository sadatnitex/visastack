// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCENES_ATTRIBUTE,
  SCENES_BOOT_SCRIPT,
  SCENE_SCREEN_QUERY,
  progressFor,
  startScenes,
  stepFor,
} from './scene-engine';

describe('progressFor', () => {
  it('runs from 0 at the top of a pinned scene to 1 at its end', () => {
    expect(progressFor({ top: 0, height: 3000 }, 1000)).toBe(0);
    expect(progressFor({ top: -1000, height: 3000 }, 1000)).toBe(0.5);
    expect(progressFor({ top: -2000, height: 3000 }, 1000)).toBe(1);
  });
  it('clamps before and after the scene', () => {
    expect(progressFor({ top: 500, height: 3000 }, 1000)).toBe(0);
    expect(progressFor({ top: -9000, height: 3000 }, 1000)).toBe(1);
  });
  it('treats a scene no taller than the screen as finished once it reaches the top', () => {
    expect(progressFor({ top: 10, height: 800 }, 1000)).toBe(0);
    expect(progressFor({ top: 0, height: 1000 }, 1000)).toBe(1);
  });
  it('pins below the sticky header when given its offset', () => {
    // An 84 px header: the stage is 916 px high, so a 3000 px scene travels 2084 px.
    expect(progressFor({ top: 84, height: 3000 }, 1000, 84)).toBe(0);
    expect(progressFor({ top: 84 - 1042, height: 3000 }, 1000, 84)).toBe(0.5);
    expect(progressFor({ top: 84 - 2084, height: 3000 }, 1000, 84)).toBe(1);
    expect(progressFor({ top: 100, height: 900 }, 1000, 84)).toBe(0);
    expect(progressFor({ top: 84, height: 900 }, 1000, 84)).toBe(1);
  });
  it('never returns NaN', () => {
    expect(progressFor({ top: Number.NaN, height: 3000 }, 1000)).toBe(0);
    expect(progressFor({ top: -1, height: Number.POSITIVE_INFINITY }, 1000)).toBe(0);
  });
});

describe('stepFor', () => {
  it('splits progress into equal steps and ends on the last one', () => {
    expect([0, 0.32, 0.34, 0.66, 0.67, 0.99, 1].map((p) => stepFor(p, 3))).toEqual([
      0, 0, 1, 1, 2, 2, 2,
    ]);
  });
  it('keeps odd inputs inside the steps', () => {
    expect(stepFor(-1, 3)).toBe(0);
    expect(stepFor(2, 3)).toBe(2);
    expect(stepFor(Number.NaN, 3)).toBe(0);
    expect(stepFor(0.5, 0)).toBe(0);
    expect(stepFor(0.5, Number.NaN)).toBe(0);
  });
});

/** A scene laid out at `top` (relative to the screen) and `height`, both changeable. */
function scene(steps: number, finished: number) {
  const element = document.createElement('section');
  element.setAttribute('data-scene', 'test');
  element.setAttribute('data-steps', String(steps));
  element.setAttribute('data-step', String(finished));
  const box = { top: 0, height: 3000 };
  element.getBoundingClientRect = () =>
    ({ top: box.top, height: box.height, bottom: box.top + box.height }) as DOMRect;
  document.body.append(element);
  return { element, box };
}

describe('startScenes', () => {
  let frames: FrameRequestCallback[];
  const flush = () => {
    const run = frames;
    frames = [];
    for (const callback of run) callback(0);
  };
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // jsdom has no IntersectionObserver: every scene counts as near, which is the fallback path.
    vi.stubGlobal('IntersectionObserver', undefined);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.removeAttribute(SCENES_ATTRIBUTE);
  });

  it('marks the page live and follows the scroll, one update per frame', () => {
    const { element, box } = scene(3, 2);
    const handle = startScenes(document, { reduce: false, saveData: false });
    expect(document.documentElement.getAttribute(SCENES_ATTRIBUTE)).toBe('live');
    expect(element.getAttribute('data-step')).toBe('0');
    expect(element.style.getPropertyValue('--p')).toBe('0.0000');
    box.top = -1000;
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(frames).toHaveLength(1);
    flush();
    expect(element.style.getPropertyValue('--p')).toBe('0.5000');
    expect(element.getAttribute('data-step')).toBe('1');
    handle.stop();
  });

  it('measures again on resize and on a return from the back-forward cache', () => {
    const { element, box } = scene(2, 1);
    const handle = startScenes(document, { reduce: false, saveData: false });
    box.top = -500;
    Object.defineProperty(window, 'innerHeight', { value: 2000, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(element.style.getPropertyValue('--p')).toBe('0.5000');
    box.top = -1000;
    window.dispatchEvent(new Event('pageshow'));
    expect(element.style.getPropertyValue('--p')).toBe('1.0000');
    handle.stop();
  });

  it('stop() removes the listeners and every mark, and puts back the finished step', () => {
    const { element, box } = scene(3, 2);
    const handle = startScenes(document, { reduce: false, saveData: false });
    handle.stop();
    expect(document.documentElement.hasAttribute(SCENES_ATTRIBUTE)).toBe(false);
    expect(element.style.getPropertyValue('--p')).toBe('');
    expect(element.getAttribute('data-step')).toBe('2');
    box.top = -1000;
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(0);
    expect(element.getAttribute('data-step')).toBe('2');
  });

  for (const options of [
    { reduce: true, saveData: false },
    { reduce: false, saveData: true },
  ])
    it(`writes nothing and keeps the finished step (${JSON.stringify(options)})`, () => {
      const { element } = scene(3, 2);
      const handle = startScenes(document, options);
      expect(document.documentElement.hasAttribute(SCENES_ATTRIBUTE)).toBe(false);
      expect(element.getAttribute('data-step')).toBe('2');
      expect(element.style.getPropertyValue('--p')).toBe('');
      window.dispatchEvent(new Event('scroll'));
      expect(frames).toHaveLength(0);
      handle.stop();
      expect(element.getAttribute('data-step')).toBe('2');
    });

  it('does nothing on a page without scenes', () => {
    const handle = startScenes(document, { reduce: false, saveData: false });
    expect(document.documentElement.hasAttribute(SCENES_ATTRIBUTE)).toBe(false);
    handle.stop();
  });

  it('measures only scenes the observer reports near, and settles one that leaves', () => {
    const observed: Element[] = [];
    let report: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    let disconnected = false;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {
          disconnected = true;
        }
      },
    );
    const a = scene(2, 1);
    const b = scene(2, 1);
    const handle = startScenes(document, { reduce: false, saveData: false });
    expect(observed).toEqual([a.element, b.element]);
    report([{ target: a.element, isIntersecting: true }]);
    flush();
    a.box.top = -2000;
    b.box.top = -2000;
    window.dispatchEvent(new Event('scroll'));
    flush();
    expect(a.element.style.getPropertyValue('--p')).toBe('1.0000');
    expect(b.element.style.getPropertyValue('--p')).toBe('0.0000');
    report([{ target: b.element, isIntersecting: false }]);
    expect(b.element.style.getPropertyValue('--p')).toBe('1.0000');
    handle.stop();
    expect(disconnected).toBe(true);
  });
});

describe('startScenes reads before it writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.removeAttribute(SCENES_ATTRIBUTE);
  });

  it('reads every box first, then writes, and writes a step only when it changes', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const log: string[] = [];
    const scenes = [0, 1, 2].map((n) => {
      const element = document.createElement('section');
      element.setAttribute('data-scene', `s${n}`);
      element.setAttribute('data-steps', '4');
      element.setAttribute('data-step', '3');
      const box = { top: 0 };
      element.getBoundingClientRect = () => {
        log.push('read');
        return { top: box.top, height: 3000 } as DOMRect;
      };
      const set = element.setAttribute.bind(element);
      element.setAttribute = (name: string, value: string) => {
        if (name === 'data-step') log.push(`step ${value}`);
        set(name, value);
      };
      const setProperty = element.style.setProperty.bind(element.style);
      element.style.setProperty = (name: string, value: string | null) => {
        log.push('write');
        setProperty(name, value);
      };
      document.body.append(element);
      return { element, box };
    });
    const handle = startScenes(document, { reduce: false, saveData: false });
    const firstWrite = log.findIndex((entry) => entry !== 'read');
    expect(log.slice(0, firstWrite)).toEqual(['read', 'read', 'read']);
    expect(log.slice(firstWrite).every((entry) => entry !== 'read')).toBe(true);
    // Each scene moved from its finished step 3 to step 0: written once each.
    expect(log.filter((entry) => entry.startsWith('step'))).toEqual(['step 0', 'step 0', 'step 0']);
    log.length = 0;
    for (const scene of scenes) scene.box.top = -10;
    window.dispatchEvent(new Event('scroll'));
    for (const cb of frames.splice(0)) cb(0);
    expect(log.filter((entry) => entry === 'read')).toHaveLength(3);
    // Still step 0: no step written again, only the new progress.
    expect(log.filter((entry) => entry.startsWith('step'))).toEqual([]);
    expect(log.filter((entry) => entry === 'write')).toHaveLength(3);
    handle.stop();
  });

  it('reads the pinned line from the stage and measures progress from it', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const element = document.createElement('section');
    element.setAttribute('data-scene', 'a');
    element.setAttribute('data-steps', '2');
    const stage = document.createElement('div');
    stage.className = 'pub-scene-stage';
    stage.style.top = '84px';
    element.append(stage);
    element.getBoundingClientRect = () => ({ top: 84 - 1042, height: 3000 }) as DOMRect;
    document.body.append(element);
    const handle = startScenes(document, { reduce: false, saveData: false });
    expect(element.style.getPropertyValue('--p')).toBe('0.5000');
    handle.stop();
  });

  it('clears the early mark when motion is not welcome after all', () => {
    document.documentElement.setAttribute(SCENES_ATTRIBUTE, 'live');
    startScenes(document, { reduce: true, saveData: false });
    expect(document.documentElement.hasAttribute(SCENES_ATTRIBUTE)).toBe(false);
  });
});

/** Runs the exact script the layout puts in the page, as the browser would (global scope). */
function runBoot() {
  // biome-ignore lint/security/noGlobalEval: the boot script is a fixed string from the engine
  const run: (code: string) => unknown = globalThis.eval;
  run(SCENES_BOOT_SCRIPT);
}

describe('the early mark before the first paint', () => {
  const media = { reduce: false, screen: true };
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute(SCENES_ATTRIBUTE);
    document.documentElement.removeAttribute('data-save-data');
    media.reduce = false;
    media.screen = true;
  });
  const boot = () => {
    const queries: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return { matches: query.includes('reduce') ? media.reduce : media.screen };
    });
    runBoot();
    return { live: document.documentElement.getAttribute(SCENES_ATTRIBUTE), queries };
  };

  it('marks the page live with the same tests as the runtime', () => {
    const { live, queries } = boot();
    expect(live).toBe('live');
    expect(queries).toEqual(['(prefers-reduced-motion: reduce)', SCENE_SCREEN_QUERY]);
  });
  it('stays still with reduced motion, a small screen or data saver', () => {
    media.reduce = true;
    expect(boot().live).toBe(null);
    media.reduce = false;
    media.screen = false;
    expect(boot().live).toBe(null);
    media.screen = true;
    document.documentElement.setAttribute('data-save-data', '');
    expect(boot().live).toBe(null);
  });
  it('never throws, even without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(runBoot).not.toThrow();
  });
});
