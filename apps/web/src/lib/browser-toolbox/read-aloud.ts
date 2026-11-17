/**
 * Reads already-visible text aloud with the browser's own voice (speech synthesis), in the page's
 * language. Nothing is sent anywhere and nothing hidden is read. Absent when unsupported.
 */

interface SynthesisLike {
  speak: (utterance: unknown) => void;
  cancel: () => void;
  speaking?: boolean;
}

function synthesis(): SynthesisLike | null {
  if (typeof window === 'undefined') return null;
  const api = (window as { speechSynthesis?: SynthesisLike }).speechSynthesis;
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  return api && typeof api.speak === 'function' && typeof Utterance === 'function' ? api : null;
}

export function readAloudSupported(): boolean {
  return synthesis() !== null;
}

/** The language of the element being read (its own or an ancestor's), else the page's, else English. */
export function pageLanguage(source?: Element | null): string {
  if (typeof document === 'undefined') return 'en';
  const own = source?.closest('[lang]')?.getAttribute('lang');
  return own || document.documentElement.lang || 'en';
}

/** Longest a spoken line is waited for: about 12 characters a second, with generous slack. */
const SAFETY_MIN_MS = 4000;
const SAFETY_PER_CHAR_MS = 150;

/** Held until the voice finishes: a browser may drop a spoken line that nothing refers to. */
const speaking = new Set<unknown>();

/** Starts reading `text`; `onEnd` runs when it ends, fails or is stopped. Returns a stop function. */
export function readAloud(text: string, onEnd: () => void, source?: Element | null): () => void {
  const api = synthesis();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!api || clean === '') {
    onEnd();
    return () => undefined;
  }
  const Utterance = (
    globalThis as unknown as {
      SpeechSynthesisUtterance: new (
        text: string,
      ) => {
        lang: string;
        onend: (() => void) | null;
        onerror: (() => void) | null;
      };
    }
  ).SpeechSynthesisUtterance;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearInterval(poll);
    speaking.clear();
    onEnd();
  };
  try {
    api.cancel();
    const utterance = new Utterance(clean);
    utterance.lang = pageLanguage(source);
    utterance.onend = finish;
    utterance.onerror = finish;
    // Some Chromium builds drop a line spoken in the same tick as cancel(), and then neither
    // onend nor onerror ever fires: speak on the next tick, and reset on a safety timer.
    timer = setTimeout(() => {
      if (ended) return;
      speaking.clear();
      speaking.add(utterance);
      try {
        api.speak(utterance);
      } catch {
        finish();
        return;
      }
      // Once the voice has started, the browser's own state says when it has stopped.
      let started = false;
      poll = setInterval(() => {
        if (api.speaking === true) started = true;
        else if (started) finish();
      }, 500);
      timer = setTimeout(finish, Math.max(SAFETY_MIN_MS, clean.length * SAFETY_PER_CHAR_MS));
    }, 0);
  } catch {
    finish();
    return () => undefined;
  }
  return () => {
    try {
      api.cancel();
    } catch {
      // Nothing to stop.
    }
    finish();
  };
}
