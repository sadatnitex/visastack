// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { FocusFirstFieldOnOpen } from './u8-fold-focus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FocusFirstFieldOnOpen (U8)', () => {
  it('moves focus to the first field when the section is opened by its row, and not when it closes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <details>
          <summary>Add Task</summary>
          <FocusFirstFieldOnOpen />
          <form>
            <input type="hidden" name="organizationId" value="o1" />
            <input name="description" aria-label="Task Description" />
          </form>
        </details>,
      ),
    );
    const details = host.querySelector('details') as HTMLDetailsElement;
    const summary = host.querySelector('summary') as HTMLElement;
    // A press on the closed row: the browser opens it after the click handlers have run.
    summary.click();
    details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement?.getAttribute('name')).toBe('description');
    (document.activeElement as HTMLElement).blur();
    // A press on the open row closes it: focus is not pulled back in.
    summary.click();
    details.open = false;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement?.getAttribute('name')).not.toBe('description');
    await act(async () => root.unmount());
    host.remove();
  });
});
