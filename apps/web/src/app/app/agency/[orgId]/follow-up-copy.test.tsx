// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpCopy } from './follow-up-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = 'Hello Rahim Uddin,\n\nWe are still waiting for one document we asked you for.';
let root: Root;
let container: HTMLDivElement;

function render(agencyNoteLeftOut = false) {
  act(() => root.render(<FollowUpCopy text={text} agencyNoteLeftOut={agencyNoteLeftOut} />));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function clickCopy() {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === 'Copy Message',
  );
  if (!button) throw new Error('Missing Copy Message button');
  await act(async () => button.click());
}

describe('follow-up message copy', () => {
  it('shows the message for review behind one control, and says it is not sent', () => {
    render();
    expect(container.querySelector('summary')?.textContent).toBe('Review Follow-Up Message');
    expect(container.querySelector('textarea')?.value).toBe(text);
    expect(container.querySelector('textarea')?.readOnly).toBe(true);
    expect(container.textContent).toContain('It is not sent for you');
    expect(container.textContent).not.toContain('Your note was left out');
  });

  it('announces Copied through a polite live region once the clipboard accepts the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render();
    const status = container.querySelector('output');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('');
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith(text);
    expect(status?.textContent).toBe('Copied');
  });

  it('selects the text for copying by hand when the clipboard is refused, and never claims Copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
      configurable: true,
    });
    render();
    await clickCopy();
    const field = container.querySelector('textarea');
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(text.length);
    expect(container.querySelector('output')?.textContent).toContain('Copying is blocked here');
    expect(container.querySelector('output')?.textContent).not.toContain('Copied');
  });

  it('falls back the same way when the browser has no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render();
    await clickCopy();
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    expect(container.querySelector('output')?.textContent).toContain('Copying is blocked here');
  });

  it('explains when the agency note was left out', () => {
    render(true);
    expect(container.textContent).toContain(
      'Your note was left out because it has a link, an email address or a long number.',
    );
  });
});
