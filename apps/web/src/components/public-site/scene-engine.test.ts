// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENES_ATTRIBUTE, progressFor, startScenes, stepFor } from './scene-engine';

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
