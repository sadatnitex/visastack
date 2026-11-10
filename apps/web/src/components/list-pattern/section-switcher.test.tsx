// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SwitcherTabs } from './section-switcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  container.setAttribute('data-depth-scope', 'case');
  container.setAttribute('data-depth', 'browse');
  document.body.append(container);
  root = createRoot(container);
  // jsdom has no layout, so scrolling is a no-op here.
  (Element.prototype as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
  // jsdom draws nothing, so say which elements are "drawn": those without a display:none ancestor
  // carrying a hiding depth. The component asks getClientRects, so give drawn ones a box.
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value(this: HTMLElement) {
      const hiddenByDepth =
        this.getAttribute('data-level') === 'everything' &&
        container.getAttribute('data-depth') !== 'everything';
      return this.closest('[hidden]') || hiddenByDepth ? [] : [{}];
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const sections = [
  {
    key: 'evidence',
    title: 'Select Evidence',
    level: 'everything' as const,
    content: <p id="evidence">Evidence</p>,
  },
  {
    key: 'work',
    title: 'Tasks and Letters',
    level: 'browse' as const,
    content: <p id="work">Work</p>,
  },
  { key: 'notes', title: 'Notes', level: 'browse' as const, content: <p id="notes">Notes</p> },
];
const draw = (initial?: string) =>
  act(() => root.render(<SwitcherTabs label="Sections" sections={sections} initial={initial} />));
const panel = (key: string) => container.querySelector<HTMLElement>(`#sw-panel-${key}`);
const tab = (key: string) => container.querySelector<HTMLElement>(`#sw-tab-${key}`);

describe('SwitcherTabs', () => {
  it('draws the tabs and no section until one is asked for', () => {
    draw();
    expect(container.querySelector('[role="tablist"]')?.hasAttribute('hidden')).toBe(false);
    for (const key of ['evidence', 'work', 'notes']) expect(panel(key)?.hidden).toBe(true);
    expect(tab('work')?.getAttribute('aria-selected')).toBe('false');
    expect(panel('work')?.getAttribute('role')).toBe('tabpanel');
    expect(panel('work')?.getAttribute('aria-labelledby')).toBe('sw-tab-work');
  });

  it('starts on the section it is asked to', () => {
    draw('notes');
    expect(panel('notes')?.hidden).toBe(false);
    expect(panel('work')?.hidden).toBe(true);
  });

  it('chooses a section by click and by arrow keys, and only the chosen tab is a tab stop', () => {
    draw();
    act(() => tab('notes')?.click());
    expect(panel('notes')?.hidden).toBe(false);
    expect(panel('work')?.hidden).toBe(true);
    expect(tab('notes')?.tabIndex).toBe(0);
    expect(tab('work')?.tabIndex).toBe(-1);
    act(() => {
      tab('notes')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(panel('work')?.hidden).toBe(false);
    expect(document.activeElement).toBe(tab('work'));
  });

  it('opens the section that holds the target of a link to it', () => {
    draw();
    const link = document.createElement('a');
    link.href = '#notes';
    container.append(link);
    act(() => link.click());
    expect(panel('notes')?.hidden).toBe(false);
    link.remove();
  });

  it('opens a section asked for at start as soon as depth shows its tab', async () => {
    // The notes tab is Browse; evidence is Everything. Start wanting evidence at Browse depth.
    draw('evidence');
    expect(panel('evidence')?.hidden).toBe(true);
    await act(async () => {
      container.setAttribute('data-depth', 'everything');
      await Promise.resolve();
    });
    expect(panel('evidence')?.hidden).toBe(false);
  });

  it('goes to the target of a link once its section shows', () => {
    draw();
    const target = container.querySelector<HTMLElement>('#notes') as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const link = document.createElement('a');
    link.href = '#notes';
    container.append(link);
    act(() => link.click());
    expect(scroll).toHaveBeenCalled();
    link.remove();
  });

  it('has a tab stop in the row before the first drawn tab is known', () => {
    act(() => root.render(<SwitcherTabs label="Sections" sections={sections} />));
    // Whatever the moment, at least one tab can be reached by keyboard.
    const stops = [...container.querySelectorAll<HTMLElement>('.sw-tab')].filter(
      (el) => el.tabIndex === 0,
    );
    expect(stops.length).toBeGreaterThan(0);
  });

  it('goes to the target at once when its section is already showing, and leaves nothing waiting', () => {
    draw('notes');
    const target = container.querySelector<HTMLElement>('#notes') as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const link = document.createElement('a');
    link.href = '#notes';
    container.append(link);
    act(() => link.click());
    expect(scroll).toHaveBeenCalledTimes(1);
    // Away to another section and back: focus does not jump to the old target again.
    act(() => tab('work')?.click());
    act(() => tab('notes')?.click());
    expect(scroll).toHaveBeenCalledTimes(1);
    link.remove();
  });

  it('gives one tab stop while nothing is chosen: the first drawn tab', () => {
    draw();
    expect(tab('work')?.tabIndex).toBe(0);
    expect(tab('notes')?.tabIndex).toBe(-1);
  });

  it('moves to a drawn section when depth hides the chosen one', async () => {
    container.setAttribute('data-depth', 'everything');
    draw('evidence');
    expect(panel('evidence')?.hidden).toBe(false);
    await act(async () => {
      container.setAttribute('data-depth', 'browse');
      await Promise.resolve();
    });
    expect(panel('evidence')?.hidden).toBe(true);
    // Nothing else is chosen in its place.
    expect(panel('work')?.hidden).toBe(true);
    expect(tab('work')?.getAttribute('aria-selected')).toBe('false');
  });
});
