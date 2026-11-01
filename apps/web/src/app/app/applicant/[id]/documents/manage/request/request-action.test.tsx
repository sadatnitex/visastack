// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  requestRemovalAction: mocks.request,
  cancelRemovalRequestAction: mocks.cancel,
}));
vi.mock('../replace/actions', () => ({
  replaceOptionsAction: vi.fn(),
  replaceDocumentAction: vi.fn(),
}));
vi.mock('../../../actions', () => ({ uploadDocumentAction: vi.fn() }));

import { MANAGE_ACTIONS } from '../registry';
import { CancelRemovalRequestAction } from './cancel-action';
import { REASON_CHOICES } from './messages';
import { RequestRemovalAction } from './request-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = '11111111-1111-4111-8111-111111111111';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

describe('Ask Us to Remove This File', () => {
  it('is registered for REQUEST_REMOVAL and CANCEL_REMOVAL_REQUEST under the D anchor', () => {
    expect(MANAGE_ACTIONS.REQUEST_REMOVAL?.label).toBe('Ask Us to Remove This File');
    expect(MANAGE_ACTIONS.CANCEL_REMOVAL_REQUEST?.label).toBe('Cancel Removal Request');
  });

  it('asks for a reason from the list, with no typed text, then sends the request', async () => {
    const onClose = vi.fn();
    mocks.request.mockResolvedValue({ ok: true, message: 'Removal requested.' });
    await act(async () => {
      root.render(
        <RequestRemovalAction
          applicantId="a1"
          documentId={DOC}
          documentName="Passport"
          onClose={onClose}
        />,
      );
    });
    expect(container.querySelector('textarea, input[type="text"]')).toBeNull();
    const radios = container.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(REASON_CHOICES.length);
    expect(container.textContent).toContain('Backup copies expire within 90 days');

    await act(async () => {
      button('Send Request').click();
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose a reason');

    await act(async () => {
      (radios[2] as HTMLInputElement).click();
    });
    await act(async () => {
      button('Send Request').click();
    });
    expect(mocks.request).toHaveBeenCalledWith('a1', DOC, 'NO_LONGER_NEEDED');
    expect(container.querySelector('output')?.textContent).toBe('Removal requested.');
    expect(document.activeElement?.textContent).toBe('Removal Requested');
    await act(async () => {
      button('Done').click();
    });
    expect(onClose).toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('shows a refusal in plain words and keeps the choice', async () => {
    mocks.request.mockResolvedValue({ ok: false, message: 'We have to keep this document.' });
    await act(async () => {
      root.render(
        <RequestRemovalAction
          applicantId="a1"
          documentId={DOC}
          documentName="Passport"
          onClose={vi.fn()}
        />,
      );
    });
    await act(async () => {
      (container.querySelector('input[type="radio"]') as HTMLInputElement).click();
    });
    await act(async () => {
      button('Send Request').click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'We have to keep this document.',
    );
  });
});

describe('Removal Requested', () => {
  it('shows the waiting request and cancels it', async () => {
    mocks.cancel.mockResolvedValue({ ok: true, message: 'Request cancelled.' });
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <CancelRemovalRequestAction
          applicantId="a1"
          documentId={DOC}
          documentName="Passport"
          onClose={onClose}
        />,
      );
    });
    expect(container.querySelector('h3')?.textContent).toBe('Removal Requested');
    await act(async () => {
      button('Keep Request').click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      button('Cancel Request').click();
    });
    expect(mocks.cancel).toHaveBeenCalledWith('a1', DOC);
    expect(container.querySelector('output')?.textContent).toBe('Request cancelled.');
  });
});
