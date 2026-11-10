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
  const draw = (rows: number, minRows?: number, extra: { activeFilters?: number } = {}) =>
    act(() =>
      root.render(
        <ListFilterBar
          rows={rows}
          {...(minRows !== undefined ? { minRows } : {})}
          {...extra}
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

  it('puts the named search box first, then a Filters button', () => {
    draw(1, 1);
    const bar = container.querySelector('[data-pattern="filter-bar"]') as HTMLElement;
    const input = bar.querySelector('input[type="search"]') as HTMLInputElement;
    expect(bar.firstElementChild?.contains(input)).toBe(true);
    expect(input.value).toBe('pass');
    expect(bar.querySelector('.sr-only')?.textContent).toBe('Search Items');
    expect(bar.querySelector('button')?.textContent).toBe('Filters');
  });

  it('keeps the screen filters folded until Filters is pressed, and counts the ones in use', () => {
    draw(1, 1, { activeFilters: 2 });
    const toggle = container.querySelector('.lp-filters-toggle') as HTMLButtonElement;
    const panel = container.querySelector('.lp-filters-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.textContent).toBe('Filters2, 2 in use');
    act(() => toggle.click());
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelector('[data-testid="extra"]')).not.toBeNull();
  });

  it('draws no Filters button when the screen has no filters of its own', () => {
    act(() =>
      root.render(
        <ListFilterBar rows={9} query="" onQuery={() => undefined} searchLabel="Search Items" />,
      ),
    );
    expect(container.querySelector('.lp-filters-toggle')).toBeNull();
  });
});
