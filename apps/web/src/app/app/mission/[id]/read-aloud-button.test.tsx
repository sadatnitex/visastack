// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudButton } from './read-aloud-button';

class Utterance {
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}
let host: HTMLDivElement;
let root: Root;
const spoken: Utterance[] = [];
const cancel = vi.fn();

function withSpeech() {
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: (u: Utterance) => spoken.push(u), cancel },
  });
}
const control = () => host.querySelector('button') as HTMLButtonElement | null;
async function show() {
  await act(async () =>
    root.render(
      <>
        <span id="line">Dubai &middot; Tourist &middot; In Progress</span>
        <ReadAloudButton sourceId="line" />
      </>,
    ),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  spoken.length = 0;
  cancel.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'speechSynthesis');
});

describe('ReadAloudButton', () => {
  it('is not drawn where the browser cannot speak', async () => {
    await show();
    expect(control()).toBeNull();
  });
  it('reads the visible line, says Stop Reading while speaking, and stops on a second press', async () => {
    withSpeech();
    await show();
    expect(control()?.getAttribute('aria-label')).toBe('Read This Aloud');
    await act(async () => control()?.click());
    expect(spoken[0]?.text).toContain('Dubai');
    expect(control()?.getAttribute('aria-label')).toBe('Stop Reading');
    await act(async () => control()?.click());
    expect(cancel).toHaveBeenCalled();
    expect(control()?.getAttribute('aria-label')).toBe('Read This Aloud');
  });
  it('stops when the page is hidden', async () => {
    withSpeech();
    await show();
    await act(async () => control()?.click());
    cancel.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(cancel).toHaveBeenCalled();
    expect(control()?.getAttribute('aria-label')).toBe('Read This Aloud');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
});
