// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { caseCountryOptions, casePurposeGroups } from '../../../../lib/case-choices';

const actions = vi.hoisted(() => ({ startTripAction: vi.fn() }));
vi.mock('./actions', () => actions);
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const { TripStartForm } = await import('./start-form');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const people = [{ applicantId: 'p1', name: 'Rahima Akter' }];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  actions.startTripAction.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () =>
  act(() =>
    root.render(
      <TripStartForm
        countries={caseCountryOptions()}
        purposes={casePurposeGroups()}
        travellers={people}
      />,
    ),
  );
const box = () => container.querySelector<HTMLInputElement>('input[name="destination"]');

function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Start a Trip: where are you going?', () => {
  it('is one text box with the list of names, in place of a 150-line pick list', async () => {
    render();
    expect(container.querySelector('select[name="destination"]')).toBeNull();
    const input = box();
    expect(input?.type).toBe('text');
    const listed = container.querySelectorAll(
      `datalist[id="${input?.getAttribute('list')}"] option`,
    );
    expect(listed.length).toBe(caseCountryOptions().length);
    // The purpose stays a short grouped list.
    expect(container.querySelector('select[name="purpose"]')).not.toBeNull();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('is named by its question and keeps the plain hint', () => {
    render();
    const label = container.querySelector(`label[for="${box()?.id}"]`);
    expect(label?.textContent).toBe('Where Are You Going?');
    expect(container.textContent).toContain('Type a name or open the list.');
  });

  it('sends the typed text with the form, for the server to turn into one country', () => {
    actions.startTripAction.mockResolvedValue({ ok: true, message: '' });
    render();
    const input = box() as HTMLInputElement;
    type(input, 'Japan');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('destination')).toBe('Japan');
    expect(container.querySelector('output')?.textContent).toBe('Japan chosen.');
  });

  it('keeps what was typed after the server refuses the form', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'We could not match that to a country. Pick one from the list.',
      field: 'destination',
    });
    render();
    const input = box() as HTMLInputElement;
    type(input, 'Korea');
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(box()?.value).toBe('Korea');
    expect(container.textContent).toContain('We could not match that to a country.');
    expect(box()?.getAttribute('aria-invalid')).toBe('true');
  });
});
