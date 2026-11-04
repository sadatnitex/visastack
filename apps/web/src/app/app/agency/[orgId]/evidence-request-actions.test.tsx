// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('./actions', () => ({
  decideEvidenceResponseAction: mocks.decide,
  startEvidenceReviewAction: mocks.start,
  cancelEvidenceRequestAction: mocks.cancel,
}));

import { EvidenceRequestActions } from './evidence-request-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.decide.mockResolvedValue({ ok: true, message: '' });
  mocks.start.mockResolvedValue({ ok: true, message: '' });
  mocks.cancel.mockResolvedValue({ ok: true, message: '' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (props: Partial<Parameters<typeof EvidenceRequestActions>[0]> = {}) =>
  act(() => {
    root.render(
      <EvidenceRequestActions
        organizationId="o1"
        requestId="r1"
        status="RECEIVED"
        submissionId="s1"
        {...props}
      />,
    );
  });

const fieldsOf = (form: Element | null | undefined) =>
  Object.fromEntries(
    [...(form?.querySelectorAll<HTMLInputElement>('input') ?? [])].map((i) => [i.name, i.value]),
  );
const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLElement;

describe('the decision buttons are about the copy the reviewer was shown', () => {
  it('posts the copy id with Accept', () => {
    mount();
    const accept = buttonNamed('Accept').closest('form');
    expect(fieldsOf(accept)).toEqual({
      organizationId: 'o1',
      requestId: 'r1',
      outcome: 'ACCEPTED',
      submissionId: 's1',
    });
  });

  it('posts the copy id with every reason that sends the copy back', () => {
    mount();
    for (const [button, outcome] of [
      ['Needs Replacement', 'NEEDS_REPLACEMENT'],
      ['Contradiction', 'CONTRADICTION'],
      ['Propose Correction', 'CORRECTION_PROPOSED'],
    ] as const) {
      act(() => buttonNamed(button).click());
      const reason = container.querySelector('input[name="reason"]')?.closest('form');
      expect(fieldsOf(reason)).toMatchObject({ outcome, submissionId: 's1', reason: '' });
      act(() => buttonNamed(button).click());
    }
  });

  it('posts no copy id when nothing is pinned (a send before exact copies were kept)', () => {
    mount({ submissionId: undefined });
    expect(fieldsOf(buttonNamed('Accept').closest('form'))).not.toHaveProperty('submissionId');
    act(() => buttonNamed('Needs Replacement').click());
    expect(
      fieldsOf(container.querySelector('input[name="reason"]')?.closest('form')),
    ).not.toHaveProperty('submissionId');
  });

  it('offers no decision when the copy could not be shown, but still allows withdrawing', () => {
    mount({ canDecide: false });
    expect(buttonNamed('Accept')).toBeUndefined();
    expect(buttonNamed('Needs Replacement')).toBeUndefined();
    expect(buttonNamed('Start Review')).toBeUndefined();
    expect(buttonNamed('Cancel Request')).toBeDefined();
  });

  it('keeps Start Review for a request that has only been received', () => {
    mount({ status: 'UNDER_REVIEW' });
    expect(buttonNamed('Start Review')).toBeUndefined();
    mount({ status: 'RECEIVED' });
    expect(buttonNamed('Start Review')).toBeDefined();
  });
});

describe('every button is a 44 pixel target and says whether its reason is open', () => {
  it('uses the shared decision class, never inline padding', () => {
    mount();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button.className).toContain('request-decision-button');
      expect(button.getAttribute('style')).toBeNull();
    }
    act(() => buttonNamed('Contradiction').click());
    expect(buttonNamed('Contradiction').getAttribute('aria-expanded')).toBe('true');
    expect(buttonNamed('Needs Replacement').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('when a newer copy arrived since the page was drawn', () => {
  const stale =
    'A newer copy was sent, or this one was already decided. Refresh to see the copy now waiting.';

  it('shows the plain sentence and a Refresh link back to this request', async () => {
    mocks.decide.mockResolvedValue({ ok: false, message: stale });
    mount();
    await act(async () => {
      buttonNamed('Accept').closest('form')?.requestSubmit();
    });
    expect(container.textContent).toContain(stale);
    const link = container.querySelector<HTMLAnchorElement>('a.request-decision-refresh');
    expect(link?.textContent).toBe('Refresh');
    expect(link?.getAttribute('href')).toBe('/app/agency/o1/clients?request=r1#request-r1');
  });

  it('offers no Refresh link for any other refusal', async () => {
    mocks.decide.mockResolvedValue({
      ok: false,
      message: 'Explain the reason for the traveller to see.',
    });
    mount();
    await act(async () => {
      buttonNamed('Accept').closest('form')?.requestSubmit();
    });
    expect(container.querySelector('a.request-decision-refresh')).toBeNull();
  });
});
