// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FormResult } from './form-feedback';
import {
  type LatestResult,
  LatestResultArea,
  useLatestOf,
  useLatestResult,
  useLatestResultArea,
} from './latest-result';

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
  return <output>{useLatestOf(...results).message}</output>;
}

describe('useLatestOf: one line for several forms in one component', () => {
  it('shows only the answer that changed last, whichever form gave it', () => {
    const added = line('Task added.');
    const started = line('Task started.');
    act(() => root.render(<Latest results={[EMPTY, EMPTY]} />));
    expect(container.textContent).toBe('');
    act(() => root.render(<Latest results={[added, EMPTY]} />));
    expect(container.textContent).toBe('Task added.');
    act(() => root.render(<Latest results={[added, started]} />));
    expect(container.textContent).toBe('Task started.');
    // A re-render with nothing new keeps the latest; it does not fall back to the first form.
    act(() => root.render(<Latest results={[added, started]} />));
    expect(container.textContent).toBe('Task started.');
  });

  it('treats a second answer with the same words as new (it compares answers, not wording)', () => {
    const started = line('Task started.');
    act(() => root.render(<Latest results={[line('Task added.'), EMPTY]} />));
    act(() => root.render(<Latest results={[line('Task added.'), started]} />));
    // The first form answered again (another task added): same words, a new answer.
    expect(container.textContent).toBe('Task added.');
    act(() => root.render(<Latest results={[line('Task added.'), started]} />));
    expect(container.textContent).toBe('Task added.');
    expect(container.querySelectorAll('output')).toHaveLength(1);
  });
});

describe('useLatestResult: one line for an area of separate forms', () => {
  let area: LatestResult<FormResult> | null = null;
  function Area() {
    const value = useLatestResult(EMPTY);
    area = value;
    return <output>{value.result.message}</output>;
  }

  function deferred() {
    let resolve: (value: FormResult) => void = () => undefined;
    const promise = new Promise<FormResult>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('shows the action started last, even when an earlier one answers after it', async () => {
    act(() => root.render(<Area />));
    const slow = deferred();
    const fast = deferred();
    const tracked = area as LatestResult<FormResult>;
    let first: Promise<FormResult> = Promise.resolve(EMPTY);
    let second: Promise<FormResult> = Promise.resolve(EMPTY);
    act(() => {
      first = tracked.track(() => slow.promise)(EMPTY, new FormData());
      second = tracked.track(() => fast.promise)(EMPTY, new FormData());
    });
    await act(async () => {
      fast.resolve(line('Invitation revoked.'));
      await second;
    });
    expect(container.textContent).toBe('Invitation revoked.');
    await act(async () => {
      slow.resolve(line('Invitation ready to share.'));
      // The form that started first still gets its own answer back.
      await expect(first).resolves.toEqual(line('Invitation ready to share.'));
    });
    expect(container.textContent).toBe('Invitation revoked.');
  });

  it('keeps an answer even when the form that acted has left the page', async () => {
    let reported: LatestResult<FormResult> | null = null;
    function Row() {
      reported = useLatestResultArea<FormResult>();
      return <span>Row</span>;
    }
    function Page({ withRow }: { readonly withRow: boolean }) {
      const value = useLatestResult(EMPTY);
      return (
        <LatestResultArea area={value}>
          {withRow ? <Row /> : null}
          <output>{value.result.message}</output>
        </LatestResultArea>
      );
    }
    act(() => root.render(<Page withRow />));
    const revoke = deferred();
    let pending: Promise<FormResult> = Promise.resolve(EMPTY);
    act(() => {
      pending = (reported as LatestResult<FormResult> | null)?.track(() => revoke.promise)(
        EMPTY,
        new FormData(),
      ) as Promise<FormResult>;
    });
    // The page refreshes and the revoked row is gone before the answer is shown.
    act(() => root.render(<Page withRow={false} />));
    await act(async () => {
      revoke.resolve(line('Invitation revoked.'));
      await pending;
    });
    expect(container.textContent).toBe('Invitation revoked.');
  });

  it('gives a form outside any area nothing to report to, so it keeps its own line', () => {
    let found: unknown = 'unset';
    function Alone() {
      found = useLatestResultArea();
      return null;
    }
    act(() => root.render(<Alone />));
    expect(found).toBeNull();
  });
});
