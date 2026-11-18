// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startScenes } from './scene-engine';
import {
  REVEAL_MIN_STEP_MS,
  REVEAL_STEP_MS,
  REVEAL_THRESHOLDS,
  REVEAL_TOTAL_MS,
  stepEvery,
} from './scene-reveal';

type Callback = (entries: IntersectionObserverEntry[]) => void;

/** A hand-driven IntersectionObserver: the test decides what is on screen. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: Callback) {
    FakeObserver.all.push(this);
  }
  observe(element: Element) {
    this.targets.add(element);
  }
  unobserve(element: Element) {
    this.targets.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
}

/** The arming observer (first created) reports a scene within a screen of coming into view. */
function near(element: Element) {
  FakeObserver.all[0]?.callback([
    { target: element, isIntersecting: true } as IntersectionObserverEntry,
  ]);
}

function see(
  element: Element,
  visible: 'yes' | 'barely' | 'below' | 'above',
  ratio = 0.5,
  share = 0,
) {
  const observer = FakeObserver.all[1];
  const rect = (bottom: number) => ({ bottom, height: share }) as DOMRectReadOnly;
  observer?.callback([
    {
      target: element,
      isIntersecting: visible === 'yes' || visible === 'barely',
      intersectionRatio: visible === 'yes' ? ratio : visible === 'barely' ? 0.05 : 0,
      intersectionRect: rect(0),
      boundingClientRect: rect(visible === 'above' ? -10 : 1200),
    } as IntersectionObserverEntry,
  ]);
}

function scene(steps: number, finished: number, name = 'test') {
  const element = document.createElement('section');
  element.setAttribute('data-scene', name);
  element.setAttribute('data-steps', String(steps));
  element.setAttribute('data-step', String(finished));
  document.body.append(element);
  return element;
}

const html = document.documentElement;
const markedMode = () => html.getAttribute('data-scene-mode');
const step = (element: Element) => element.getAttribute('data-step');

describe('reveal mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeObserver.all = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    Object.defineProperty(window, 'IntersectionObserver', {
      value: FakeObserver,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    html.removeAttribute('data-scenes');
    html.removeAttribute('data-scene-mode');
    document.body.replaceChildren();
  });
  let mode: 'reveal' | 'gentle' = 'reveal';
  const start = (animate = true) => startScenes(document, { mode, animate });

  it('marks the page revealing, pins nothing and adds no scroll listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const element = scene(3, 2);
    const handle = start();
    expect(html.getAttribute('data-scenes')).toBe('reveal');
    expect(markedMode()).toBe('reveal');
    expect(add.mock.calls.map(([type]) => type)).not.toContain('scroll');
    expect(add.mock.calls.map(([type]) => type)).not.toContain('resize');
    // Far from the screen a scene keeps the server's finished step: nothing is written yet.
    expect(step(element)).toBe('2');
    expect(element.hasAttribute('data-reveal')).toBe(false);
    near(element);
    expect(element.getAttribute('data-reveal')).toBe('ready');
    handle.stop();
    add.mockRestore();
  });

  it('waits at the first step off screen, plays once when meaningfully visible, and rests finished', () => {
    const element = scene(4, 3);
    const handle = start();
    expect(step(element)).toBe('3');
    near(element);
    expect(step(element)).toBe('0');
    expect(element.style.getPropertyValue('--p')).toBe('0.000');
    see(element, 'barely');
    vi.advanceTimersByTime(5000);
    expect(step(element)).toBe('0');
    see(element, 'yes');
    expect(element.getAttribute('data-reveal')).toBe('playing');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    expect(element.style.getPropertyValue('--p')).toBe('0.333');
    vi.advanceTimersByTime(REVEAL_STEP_MS * 2);
    expect(step(element)).toBe('3');
    expect(element.getAttribute('data-reveal')).toBe('done');
    expect(element.style.getPropertyValue('--p')).toBe('');
    // Once: scrolling away and back never plays it again.
    see(element, 'yes');
    vi.advanceTimersByTime(5000);
    expect(step(element)).toBe('3');
    handle.stop();
  });

  it('counts a tall scene once enough of the screen shows of it', () => {
    const element = scene(3, 2);
    const handle = start();
    near(element);
    see(element, 'yes', 0.1, 400);
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    handle.stop();
  });

  it('never plays longer than the whole-play limit, however many steps', () => {
    const element = scene(12, 11);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_TOTAL_MS + 200);
    expect(step(element)).toBe('11');
    expect(element.getAttribute('data-reveal')).toBe('done');
    handle.stop();
  });

  it('snaps a scene that leaves the screen mid-play to its finished step (never half drawn)', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    see(element, 'below');
    expect(step(element)).toBe('3');
    expect(element.getAttribute('data-reveal')).toBe('snapped');
    expect(element.style.getPropertyValue('--p')).toBe('');
    vi.advanceTimersByTime(5000);
    expect(step(element)).toBe('3');
    handle.stop();
  });

  it('keeps playing a scene that dips below the threshold while it is still partly on screen', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    see(element, 'barely');
    vi.advanceTimersByTime(REVEAL_STEP_MS * 2 + 10);
    expect(step(element)).toBe('3');
    expect(element.getAttribute('data-reveal')).toBe('done');
    handle.stop();
  });

  it('rests a scene finished when it was scrolled past before it ever played', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    see(element, 'above');
    expect(step(element)).toBe('3');
    handle.stop();
  });

  it('pauses with the tab hidden and continues from the same step when it shows again', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    let hidden = true;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10_000);
    expect(step(element)).toBe('1');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(REVEAL_STEP_MS * 2 + 10);
    expect(step(element)).toBe('3');
    Reflect.deleteProperty(document, 'hidden');
    handle.stop();
  });

  it('plays a scene that became meaningful while the tab was hidden as soon as the tab shows', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    let hidden = true;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    see(element, 'yes');
    vi.advanceTimersByTime(10_000);
    expect(step(element)).toBe('0');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(REVEAL_STEP_MS * 3 + 10);
    expect(step(element)).toBe('3');
    Reflect.deleteProperty(document, 'hidden');
    handle.stop();
  });

  it('reports often enough for a scene far taller than the screen to count once enough of it shows', () => {
    expect(REVEAL_THRESHOLDS.length).toBeGreaterThanOrEqual(20);
    expect(REVEAL_THRESHOLDS[0]).toBe(0);
    expect(REVEAL_THRESHOLDS.at(-1)).toBe(1);
    expect(
      Math.max(
        ...REVEAL_THRESHOLDS.slice(1).map((value, at) => value - (REVEAL_THRESHOLDS[at] ?? 0)),
      ),
    ).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('rests every scene finished when told not to animate (a mode switch never replays)', () => {
    const element = scene(4, 3);
    const handle = start(false);
    expect(step(element)).toBe('3');
    expect(element.getAttribute('data-reveal')).toBe('done');
    expect(html.getAttribute('data-scenes')).toBe('reveal');
    handle.stop();
  });

  it('after a mode switch rests scenes already on screen or above, and still plays the ones below when they arrive', () => {
    const shown = scene(4, 3, 'shown');
    const below = scene(4, 3, 'below');
    shown.getBoundingClientRect = () => ({ top: 100, height: 400 }) as DOMRect;
    below.getBoundingClientRect = () => ({ top: 2000, height: 400 }) as DOMRect;
    const handle = start(false);
    expect(shown.getAttribute('data-reveal')).toBe('done');
    expect(step(shown)).toBe('3');
    expect(below.hasAttribute('data-reveal')).toBe(false);
    near(below);
    expect(step(below)).toBe('0');
    see(below, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS * 3 + 10);
    expect(step(below)).toBe('3');
    expect(below.getAttribute('data-reveal')).toBe('done');
    handle.stop();
  });

  it('plays the progress from 0 to 1 over the steps it plays, so the last one lands on the finished look', () => {
    const element = scene(6, 3);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(element.style.getPropertyValue('--p')).toBe('0.333');
    vi.advanceTimersByTime(REVEAL_STEP_MS);
    expect(element.style.getPropertyValue('--p')).toBe('0.667');
    vi.advanceTimersByTime(REVEAL_STEP_MS);
    expect(step(element)).toBe('3');
    expect(element.style.getPropertyValue('--p')).toBe('');
    handle.stop();
  });

  it('rests finished without an observer, and a one-step scene has nothing to play', () => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
    const element = scene(4, 3);
    const handle = start();
    expect(step(element)).toBe('3');
    handle.stop();
  });

  it('stop() removes every mark, timer and observer and puts back the finished step', () => {
    const element = scene(4, 3);
    const handle = start();
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    handle.stop();
    expect(html.hasAttribute('data-scenes')).toBe(false);
    expect(html.hasAttribute('data-scene-mode')).toBe(false);
    expect(element.hasAttribute('data-reveal')).toBe(false);
    expect(element.style.getPropertyValue('--p')).toBe('');
    expect(step(element)).toBe('3');
    expect(FakeObserver.all.every((observer) => observer.disconnected)).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(step(element)).toBe('3');
  });

  it('gentle mode plays the same steps but never writes the progress that slides or scales things', () => {
    mode = 'gentle';
    const element = scene(4, 3);
    const handle = start();
    expect(html.getAttribute('data-scenes')).toBe('gentle');
    expect(markedMode()).toBe('gentle');
    near(element);
    see(element, 'yes');
    vi.advanceTimersByTime(REVEAL_STEP_MS + 10);
    expect(step(element)).toBe('1');
    expect(element.style.getPropertyValue('--p')).toBe('');
    vi.advanceTimersByTime(stepEvery(3) * 2);
    expect(step(element)).toBe('3');
    expect(element.getAttribute('data-reveal')).toBe('done');
    handle.stop();
    expect(html.hasAttribute('data-scenes')).toBe(false);
    mode = 'reveal';
  });

  it('never changes a scene more than three times a second, however many steps it has', () => {
    for (let last = 1; last <= 11; last++) {
      expect(stepEvery(last)).toBeGreaterThanOrEqual(334);
      expect(stepEvery(last) * Math.max(0, last - 1)).toBeLessThanOrEqual(REVEAL_TOTAL_MS + 400);
    }
    expect(REVEAL_MIN_STEP_MS).toBeGreaterThanOrEqual(334);
    expect(stepEvery(11) * 11).toBeLessThanOrEqual(5000);
  });
});
