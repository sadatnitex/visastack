// @vitest-environment jsdom
import { act, useRef } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListFilterBar } from './list-filter-bar';
import { useSheetBehaviour } from './use-sheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  document.body.style.overflow = '';
});

function Panel({ trap, onClose }: { trap: boolean; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useSheetBehaviour({ open: true, trap, panel, onClose });
  return (
    <section ref={panel} tabIndex={-1} data-testid="panel">
      <button type="button">One</button>
      <button type="button">Two</button>
    </section>
  );
}

const press = (key: string, shiftKey = false) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });

describe('useSheetBehaviour', () => {
  it('takes focus, closes on Escape and leaves the page scrollable when it is not a full screen', () => {
    const onClose = vi.fn();
    act(() => root.render(<Panel trap={false} onClose={onClose} />));
    expect(document.activeElement).toBe(container.querySelector('section'));
    expect(document.body.style.overflow).toBe('');
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the page behind a full screen and keeps Tab inside it, both ways round', () => {
    act(() => root.render(<Panel trap={true} onClose={() => undefined} />));
    expect(document.body.style.overflow).toBe('hidden');
    const [one, two] = [...container.querySelectorAll('button')] as HTMLButtonElement[];
    // offsetParent is null in jsdom, so give the two buttons a layout box the trap can see.
    for (const button of [one, two])
      Object.defineProperty(button, 'offsetParent', { value: container });
    act(() => two?.focus());
    press('Tab');
    expect(document.activeElement).toBe(one);
    press('Tab', true);
    expect(document.activeElement).toBe(two);
  });

  it('leaves the page as it found it when the panel closes', () => {
    act(() => root.render(<Panel trap={true} onClose={() => undefined} />));
    act(() => root.unmount());
    expect(document.body.style.overflow).toBe('');
    root = createRoot(container);
  });
});

describe('ListFilterBar', () => {
  const draw = (rows: number, minRows?: number) =>
    act(() =>
      root.render(
        <ListFilterBar
          rows={rows}
          {...(minRows !== undefined ? { minRows } : {})}
          query="pass"
          onQuery={() => undefined}
          searchLabel="Search Items"
        >
          <span data-testid="extra">Category</span>
        </ListFilterBar>,
      ),
    );

  it('is not drawn for a short list, and is drawn from about eight rows', () => {
    draw(7);
    expect(container.querySelector('[data-pattern="filter-bar"]')).toBeNull();
    draw(8);
    expect(container.querySelector('[data-pattern="filter-bar"]')).not.toBeNull();
  });

  it('draws the screen filters first, then a named search box', () => {
    draw(1, 1);
    const bar = container.querySelector('[data-pattern="filter-bar"]') as HTMLElement;
    expect(bar.firstElementChild?.getAttribute('data-testid')).toBe('extra');
    const input = bar.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.value).toBe('pass');
    expect(bar.querySelector('.sr-only')?.textContent).toBe('Search Items');
  });
});
