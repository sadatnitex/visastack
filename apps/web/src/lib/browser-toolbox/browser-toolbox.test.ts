// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionAllowed } from './motion';
import { readAloud, readAloudSupported } from './read-aloud';
import { tapSuccess } from './vibrate';
import { withViewTransition } from './view-transition';
import { holdScreenAwake, wakeLockSupported } from './wake-lock';

function reducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduce })),
  );
  window.matchMedia = globalThis.matchMedia;
}
function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  reducedMotion(false);
  visibility('visible');
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'wakeLock');
  Reflect.deleteProperty(navigator, 'vibrate');
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('motionAllowed', () => {
  it('follows the reduced-motion setting', () => {
    reducedMotion(true);
    expect(motionAllowed()).toBe(false);
    reducedMotion(false);
    expect(motionAllowed()).toBe(true);
  });
});

describe('holdScreenAwake', () => {
  function stubLock() {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    return { release, request };
  }
  it('is silent when the browser has no wake lock', () => {
    expect(wakeLockSupported()).toBe(false);
    expect(() => holdScreenAwake()()).not.toThrow();
  });
  it('asks on open, lets go on close', async () => {
    const { request, release } = stubLock();
    const stop = holdScreenAwake();
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    stop();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('lets go when the page is hidden and asks again when it returns', async () => {
    const { request, release } = stubLock();
    const stop = holdScreenAwake();
    await flush();
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(release).toHaveBeenCalledTimes(1);
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });
  it('lets go of a lock that arrives after the close', async () => {
    const { request, release } = stubLock();
    const stop = holdScreenAwake();
    stop();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('lets go at once when the page was hidden while the request was pending', async () => {
    const { release } = stubLock();
    const stop = holdScreenAwake();
    visibility('hidden');
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    stop();
  });
  it('survives a refused request', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn(async () => Promise.reject(new Error('no'))) },
    });
    const stop = holdScreenAwake();
    await flush();
    expect(() => stop()).not.toThrow();
  });
});

describe('withViewTransition', () => {
  it('runs the change straight away when the browser has no view transitions', () => {
    const change = vi.fn();
    withViewTransition(change);
    expect(change).toHaveBeenCalledTimes(1);
  });
  it('runs the change inside a transition when supported and motion is allowed', () => {
    const start = vi.fn((update: () => void) => update());
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;
    const change = vi.fn();
    withViewTransition(change);
    expect(start).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
  });
  it('skips the transition when motion is reduced', () => {
    const start = vi.fn((update: () => void) => update());
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;
    reducedMotion(true);
    const change = vi.fn();
    withViewTransition(change);
    expect(start).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(1);
  });
  it('still changes the view when starting the transition throws', () => {
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = () => {
      throw new Error('no');
    };
    const change = vi.fn();
    withViewTransition(change);
    expect(change).toHaveBeenCalledTimes(1);
  });
});

describe('tapSuccess', () => {
  it('does nothing where the browser cannot vibrate', () => {
    expect(tapSuccess()).toBe(false);
  });
  it('taps once when it can and motion is allowed', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    expect(tapSuccess()).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
  it('stays still when motion is reduced', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    reducedMotion(true);
    expect(tapSuccess()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('readAloud', () => {
  class Utterance {
    lang = '';
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  function stubSpeech() {
    const spoken: Utterance[] = [];
    const api = {
      speak: vi.fn((u: Utterance) => spoken.push(u)),
      cancel: vi.fn(),
    };
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: api });
    return { api, spoken };
  }
  afterEach(() => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    vi.useRealTimers();
  });
  it('is unsupported without speech synthesis', () => {
    expect(readAloudSupported()).toBe(false);
    const done = vi.fn();
    readAloud('Hello', done);
    expect(done).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  it('reads the given text once, in the page language, and reports the end', () => {
    const { api, spoken } = stubSpeech();
    document.documentElement.lang = 'bn';
    const done = vi.fn();
    readAloud('  Dubai   \n Tourist  ', done);
    // Speaking waits one tick after cancel(): some browsers drop a line spoken in the same tick.
    expect(api.speak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe('Dubai Tourist');
    expect(spoken[0]?.lang).toBe('bn');
    expect(api.speak).toHaveBeenCalledTimes(1);
    spoken[0]?.onend?.();
    expect(done).toHaveBeenCalledTimes(1);
    document.documentElement.lang = '';
  });
  it('uses the language of the element being read, then the page', () => {
    const { spoken } = stubSpeech();
    document.documentElement.lang = 'en';
    document.body.innerHTML = '<div lang="bn"><p id="src">x</p></div><p id="plain">y</p>';
    readAloud('a', vi.fn(), document.getElementById('src'));
    vi.advanceTimersByTime(1);
    readAloud('b', vi.fn(), document.getElementById('plain'));
    vi.advanceTimersByTime(1);
    expect(spoken.map((u) => u.lang)).toEqual(['bn', 'en']);
    document.body.innerHTML = '';
    document.documentElement.lang = '';
  });
  it('stops on request and reports the end exactly once', () => {
    const { api, spoken } = stubSpeech();
    const done = vi.fn();
    const stop = readAloud('Hello', done);
    vi.advanceTimersByTime(1);
    stop();
    spoken[0]?.onerror?.();
    expect(api.cancel).toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('stopping before the line starts never speaks it', () => {
    const { api } = stubSpeech();
    const done = vi.fn();
    readAloud('Hello', done)();
    vi.advanceTimersByTime(10);
    expect(api.speak).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('resets when the browser drops the line and neither end nor error fires', () => {
    stubSpeech();
    const done = vi.fn();
    readAloud('Hello', done);
    vi.advanceTimersByTime(1);
    expect(done).not.toHaveBeenCalled();
    const { api } = {
      api: (window as { speechSynthesis: { cancel: { mockClear: () => void } } }).speechSynthesis,
    };
    api.cancel.mockClear();
    vi.advanceTimersByTime(4000);
    expect(done).toHaveBeenCalledTimes(1);
    // The voice is silenced too, so the label and the sound agree.
    expect(api.cancel).toHaveBeenCalled();
  });
  it('resets when the voice stops without telling us', () => {
    const { api } = stubSpeech();
    const state = api as { speaking?: boolean };
    const done = vi.fn();
    readAloud('Hello '.repeat(200), done);
    vi.advanceTimersByTime(1);
    state.speaking = true;
    vi.advanceTimersByTime(500);
    expect(done).not.toHaveBeenCalled();
    state.speaking = false;
    vi.advanceTimersByTime(500);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('reads nothing when there is no visible text', () => {
    const { api } = stubSpeech();
    const done = vi.fn();
    readAloud('   ', done);
    expect(api.speak).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
