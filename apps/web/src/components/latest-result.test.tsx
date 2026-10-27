// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FormResult } from './form-feedback';
import { useLatestOf } from './latest-result';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY: FormResult = { ok: true, message: '' };
const line = (message: string, ok = true): FormResult => ({ ok, message });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Latest({ results }: { readonly results: readonly FormResult[] }) {
  const [result, source] = useLatestOf(...results);
  return <output data-from={source}>{result.message}</output>;
}
const shown = () => container.querySelector('output');
const render = (results: readonly FormResult[]) =>
  act(() => root.render(<Latest results={results} />));

describe('useLatestOf: one line for several forms in one component', () => {
  it('shows whichever form answered last, and says which form it was', () => {
    const added = line('Task added.');
    const started = line('Task started.');
    render([EMPTY, EMPTY]);
    expect(shown()?.textContent).toBe('');
    render([added, EMPTY]);
    expect(shown()?.textContent).toBe('Task added.');
    expect(shown()?.getAttribute('data-from')).toBe('0');
    render([added, started]);
    expect(shown()?.textContent).toBe('Task started.');
    expect(shown()?.getAttribute('data-from')).toBe('1');
    // The same words again are a new answer, and come back to the front.
    render([line('Task added.'), started]);
    expect(shown()?.getAttribute('data-from')).toBe('0');
  });

  it('keeps the latest line while nothing changes', () => {
    const started = line('Task started.');
    render([EMPTY, EMPTY]);
    render([EMPTY, started]);
    render([EMPTY, started]);
    expect(shown()?.textContent).toBe('Task started.');
  });

  it('prefers a problem over a success that arrives in the same render', () => {
    render([EMPTY, EMPTY, EMPTY]);
    render([line('Task added.'), line('That task was already closed.', false), line('Saved.')]);
    expect(shown()?.textContent).toBe('That task was already closed.');
    expect(shown()?.getAttribute('data-from')).toBe('1');
  });

  it('of several successes at once, shows the last form', () => {
    render([EMPTY, EMPTY]);
    render([line('First.'), line('Second.')]);
    expect(shown()?.textContent).toBe('Second.');
  });
});
