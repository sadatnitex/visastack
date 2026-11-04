// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mounted: vi.fn(),
  send: vi.fn(),
}));
// The real steps are tested with the Documents page. Here: only what this panel adds around them.
vi.mock('../documents/manage/replace/replace-action', () => ({
  ReplaceAction: (props: {
    applicantId: string;
    documentId: string;
    documentName: string;
    onClose: () => void;
  }) => {
    mocks.mounted(props.applicantId, props.documentId, props.documentName);
    return (
      <div data-testid="steps">
        <button type="button" onClick={props.onClose}>
          Finish
        </button>
      </div>
    );
  },
}));
vi.mock('./actions', () => ({ submitEvidenceResponseAction: mocks.send }));

import { ClearerCopyPanel } from './clearer-copy-panel';
import { chooseLegendId } from './response-choices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useRealTimers();
  mocks.mounted.mockReset();
  mocks.send.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (primary = false) =>
  act(() => {
    root.render(
      <>
        <p id={chooseLegendId('r1')} tabIndex={-1}>
          Choose the Copy to Send
        </p>
        <ClearerCopyPanel
          applicantId="a1"
          requestId="r1"
          documentId="d1"
          documentName="statement.pdf"
          primary={primary}
        />
      </>,
    );
  });

const summary = () => container.querySelector('summary') as HTMLElement;

describe('Upload a Clearer Copy', () => {
  it('names the item for a screen reader and reads nothing until it is opened', () => {
    mount();
    expect(summary().textContent).toBe('Upload a Clearer Copy: statement.pdf');
    expect(summary().querySelector('.sr-only')?.textContent).toBe(': statement.pdf');
    expect(mocks.mounted).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="steps"]')).toBeNull();
  });

  it('opens the same replace steps, started from the copy that was sent back', () => {
    mount();
    act(() => {
      const details = container.querySelector('details') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(mocks.mounted).toHaveBeenCalledWith('a1', 'd1', 'statement.pdf');
    expect(container.querySelector('[data-testid="steps"]')).not.toBeNull();
  });

  it('reads as the main action only when no other copy can be sent', () => {
    mount(true);
    expect(summary().className).toContain('evidence-clearer-primary');
    mount(false);
    expect(summary().className).not.toContain('evidence-clearer-primary');
  });

  it('closes when the steps finish, puts focus on the choices heading, and sends nothing', async () => {
    mount();
    act(() => {
      const details = container.querySelector('details') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    act(() => {
      (container.querySelector('[data-testid="steps"] button') as HTMLElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(container.querySelector('[data-testid="steps"]')).toBeNull();
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement?.id).toBe(chooseLegendId('r1'));
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
