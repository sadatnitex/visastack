// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
const { ProfileEditor } = await import('./profile-editor');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ProfileEditor
        applicantId="synthetic-person"
        values={{}}
        repeatingValues={{
          historical_passport_number: {
            'existing-record': { factId: 'fact', value: 'SYNTHETIC', status: 'DECLARED' },
          },
        }}
        assurance={new Map()}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function tab(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (node) => node.textContent === label,
  );
  if (!button) throw new Error('Missing profile tab');
  return button;
}
describe('grouped profile editor preserves real editing paths', () => {
  it('supports keyboard tab selection and keeps only the chosen panel visible', () => {
    const personal = tab('Personal details');
    personal.focus();
    act(() =>
      personal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(document.activeElement).toBe(tab('Passports & IDs'));
    expect(tab('Passports & IDs').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#profile-panel-identity')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#profile-panel-personal')?.hasAttribute('hidden')).toBe(true);
    act(() =>
      tab('Passports & IDs').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tab('Additional information'));
  });
  it('retains applicant, canonical field and repeating-record identity in versioned edit forms', () => {
    act(() => tab('Passports & IDs').click());
    const input = container.querySelector<HTMLInputElement>(
      '#f-historical_passport_number-existing-record',
    );
    expect(input?.value).toBe('SYNTHETIC');
    const form = input?.closest('form');
    if (!form) throw new Error('Missing versioned form');
    const data = new FormData(form);
    expect(data.get('applicantId')).toBe('synthetic-person');
    expect(data.get('fieldKey')).toBe('historical_passport_number');
    expect(data.get('repeatingRecordKey')).toBe('existing-record');
    expect(form.querySelector('[name="effectiveFrom"]')).not.toBeNull();
    act(() => tab('Personal details').click());
    act(() => tab('Passports & IDs').click());
    expect(
      container.querySelector<HTMLInputElement>('#f-historical_passport_number-existing-record')
        ?.value,
    ).toBe('SYNTHETIC');
  });
  it('searches across hidden sections and leaves history and medical information reachable', () => {
    const input = container.querySelector<HTMLInputElement>('#profile-search');
    if (!input) throw new Error('Missing search');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'physician',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('#profile-panel-additional')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(container.querySelector('#profile-pack-medical')?.hasAttribute('open')).toBe(true);
    expect(container.querySelector('#f-treating_physician')).not.toBeNull();
    expect(
      container.querySelector('a[href="/app/applicant/synthetic-person/history"]'),
    ).not.toBeNull();
  });
  it('adds an additional passport without overwriting the existing record', () => {
    act(() => tab('Passports & IDs').click());
    const add = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('+ Add historical / additional passport'),
    );
    if (!add) throw new Error('Missing add-record action');
    act(() => add.click());
    const records = [
      ...container.querySelectorAll<HTMLInputElement>(
        '#profile-panel-identity [name="repeatingRecordKey"]',
      ),
    ].map((node) => node.value);
    expect(new Set(records).size).toBe(2);
    expect(records).toContain('existing-record');
  });
});

it('shows protected date states without trying to format them as dates', () => {
  act(() =>
    root.render(
      <ProfileEditor
        applicantId="synthetic-person"
        values={{
          date_of_birth: { factId: 'birth', value: '[protected]', status: 'DECLARED' },
          passport_expiry: {
            factId: 'expiry',
            value: '[protected: could not decrypt]',
            status: 'DECLARED',
          },
        }}
        repeatingValues={{}}
        assurance={new Map()}
      />,
    ),
  );
  expect(container.querySelector('#profile-panel-personal')?.textContent).toContain(
    'Protected detail',
  );
  act(() => tab('Passports & IDs').click());
  expect(container.querySelector('#profile-panel-identity')?.textContent).toContain(
    'Could not read this detail',
  );
  expect(container.querySelector('.profile-read-summary')?.textContent).not.toContain(
    'Invalid Date',
  );
});
