// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ changeAiAccessAction: vi.fn() }));
vi.mock('./ai-connection-actions', () => ({ changeAiAccessAction: mocks.changeAiAccessAction }));
const { ChangeAccessForm } = await import('./ai-connection-change');

const CASE = '33333333-3333-4333-8333-333333333333';
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  vi.resetAllMocks();
});

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ChangeAccessForm
        applicantId="a1"
        connectionId="c1"
        appName="Claude"
        cases={[{ id: CASE, title: 'UK Visit' }]}
        initial={{
          layers: ['identity'],
          cases: 'all',
          documentList: true,
          documentText: false,
          revealIdentifiers: false,
        }}
        durations={[
          { value: 'keep', label: 'Keep the Current End' },
          { value: '7d', label: '7 Days from Now' },
        ]}
        defaultDuration="keep"
      />,
    ),
  );
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host;
}

const input = (host: HTMLElement, selector: string) => {
  const found = host.querySelector<HTMLInputElement>(selector);
  if (!found) throw new Error(selector);
  return found;
};

describe('Change Access after a refused save', () => {
  it('keeps what the person chose for the retry, and points to the case choice', async () => {
    mocks.changeAiAccessAction.mockResolvedValue({
      ok: false,
      message: 'Choose a case, all current cases or none.',
      field: 'cases',
      choices: {
        layers: ['money'],
        cases: CASE,
        documentList: false,
        documentText: true,
        revealIdentifiers: false,
        duration: '7d',
      },
    });
    const host = await mount();
    input(host, 'input[value="identity"]').click();
    input(host, 'input[value="money"]').click();
    input(host, `input[value="${CASE}"]`).click();
    const form = host.querySelector('form');
    await act(async () => {
      form?.requestSubmit();
    });
    await act(async () => {});

    expect(mocks.changeAiAccessAction).toHaveBeenCalledTimes(1);
    // The form shows the submitted choices again, not the stored ones it started from.
    expect(input(host, 'input[value="money"]').checked).toBe(true);
    expect(input(host, 'input[value="identity"]').checked).toBe(false);
    expect(input(host, 'input[name="document_text"]').checked).toBe(true);
    expect(input(host, `input[value="${CASE}"]`).checked).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[name="duration"]')?.value).toBe('7d');
    // Every radio of the group is marked and described; focus is on the chosen one.
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="cases"]'));
    expect(radios.every((radio) => radio.getAttribute('aria-invalid') === 'true')).toBe(true);
    const messageId = radios[0]?.getAttribute('aria-describedby');
    expect(host.querySelector('fieldset:nth-of-type(2)')?.getAttribute('aria-describedby')).toBe(
      messageId,
    );
    expect(document.getElementById(messageId ?? '')?.textContent).toContain('Choose a case');
    expect(document.activeElement).toBe(input(host, `input[value="${CASE}"]`));
  });
});
