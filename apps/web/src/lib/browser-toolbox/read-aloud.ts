/**
 * Reads already-visible text aloud with the browser's own voice (speech synthesis), in the page's
 * language. Nothing is sent anywhere and nothing hidden is read. Absent when unsupported.
 */

interface SynthesisLike {
  speak: (utterance: unknown) => void;
  cancel: () => void;
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

export function pageLanguage(): string {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang || 'en';
}

/** Held until the voice finishes: a browser may drop a spoken line that nothing refers to. */
let speaking: unknown = null;

/** Starts reading `text`; `onEnd` runs when it ends, fails or is stopped. Returns a stop function. */
export function readAloud(text: string, onEnd: () => void): () => void {
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
  const finish = () => {
    if (ended) return;
    ended = true;
    speaking = null;
    onEnd();
  };
  try {
    api.cancel();
    const utterance = new Utterance(clean);
    utterance.lang = pageLanguage();
    speaking = utterance;
    utterance.onend = finish;
    utterance.onerror = finish;
    api.speak(utterance);
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
