// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DoneNotice } from './done-notice';

// The React test environment flag, so act() updates synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the line a change to access leaves on Sharing', () => {
  it('is read out once running, then leaves the address so it never shows again', () => {
    window.history.replaceState(null, '', '/app/applicant/a1/sharing?done=revoked&document=d1');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(<DoneNotice line="Access revoked. They lose it on their next request." />),
    );
    expect(container.querySelector('p')?.textContent).toBe(
      'Access revoked. They lose it on their next request.',
    );
    expect(container.querySelector('output')?.textContent).toBe(
      'Access revoked. They lose it on their next request.',
    );
    expect(window.location.search).toBe('?document=d1');
    act(() => root.unmount());
    container.remove();
  });
});
