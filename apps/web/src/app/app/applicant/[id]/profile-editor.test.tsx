// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_LOCKED_SECTION,
  FIXTURE_OPEN_SECTION,
  FIXTURE_PASSPORT_SECTION,
  fixtureView,
} from '../../../../lib/master-profile-fixture';
import type { MasterProfileView } from '../../../../lib/master-profile-types';
vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
vi.mock('./section-actions', () => ({
  openSuggestedSectionsAction: vi.fn(),
  saveOtherItemAction: vi.fn(),
  setExemptionAction: vi.fn(),
  setSectionOpenAction: vi.fn(),
}));
const { ProfileEditor } = await import('./profile-editor');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

type Values = Record<
  string,
  { factId: string; value: string | null; status: string | null; updatedAt?: string | null }
>;

function render(
  options: {
    values?: Values;
    repeatingValues?: Record<string, Record<string, Values[string]>>;
    view?: MasterProfileView;
  } = {},
) {
  act(() =>
    root.render(
      <ProfileEditor
        applicantId="synthetic-person"
        values={options.values ?? {}}
        repeatingValues={options.repeatingValues ?? {}}
        assurance={new Map()}
        view={options.view ?? fixtureView()}
      />,
    ),
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  render({
    repeatingValues: {
      historical_passport_number: {
        'existing-record': { factId: 'fact', value: 'SYNTHETIC', status: 'DECLARED' },
      },
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function tab(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (node) => node.textContent === label,
  );
  if (!button) throw new Error(`Missing profile tab ${label}`);
  return button;
}
function typeInto(input: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

describe('section cards keep every real editing path', () => {
  it('supports keyboard selection across the areas and shows only the chosen panel', () => {
    const first = tab('Identity and Civil Status');
    first.focus();
    act(() =>
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(document.activeElement).toBe(tab('Travel Documents'));
    expect(tab('Travel Documents').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#profile-panel-travel_documents')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(container.querySelector('#profile-panel-identity')?.hasAttribute('hidden')).toBe(true);
    act(() =>
      tab('Travel Documents').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tab('Identity and Civil Status'));
  });

  it('retains applicant, canonical field and repeating-record identity in versioned edit forms', () => {
    act(() => tab('Travel Documents').click());
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
  });

  it('adds an additional passport without overwriting the existing record', () => {
    act(() => tab('Travel Documents').click());
    const add = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('+ Add historical / additional passport'),
    );
    if (!add) throw new Error('Missing add-record action');
    act(() => add.click());
    const records = [
      ...container.querySelectorAll<HTMLInputElement>(
        '#profile-panel-travel_documents [name="repeatingRecordKey"]',
      ),
    ].map((node) => node.value);
    expect(new Set(records).size).toBe(2);
    expect(records).toContain('existing-record');
  });

  it('shows a locked section with what it holds, a tick box, and no editing', () => {
    const card = container.querySelector('#section-visa_history');
    expect(card?.className).toContain('is-locked');
    expect(card?.textContent).toContain('Locked');
    expect(card?.textContent).toContain('See the 2 details inside');
    expect(card?.textContent).toContain('Visa Expiry Date');
    expect(card?.querySelector('input:not([type="hidden"]):not([type="checkbox"])')).toBeNull();
    const toggle = card?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle?.checked).toBe(false);
    const form = toggle?.closest('form');
    const data = form ? new FormData(form) : new FormData();
    expect(data.get('sectionKey')).toBe('visa_history');
    expect(data.get('open')).toBe('true');
    expect(data.get('applicantId')).toBe('synthetic-person');
  });

  it('keeps the common sections open for everyone, with no way to close them', () => {
    const card = container.querySelector('#section-identity_basics');
    expect(card?.className).toContain('is-open');
    expect(card?.textContent).toContain('Open for everyone');
    expect(card?.querySelector('input[type="checkbox"][checked]')).toBeNull();
  });

  it('lets a section the person opened on purpose be closed, and says so when it cannot', () => {
    render({
      view: fixtureView({
        layers: [
          {
            key: 'identity',
            label: 'Identity and Civil Status',
            description: 'Names.',
            sections: [
              { ...FIXTURE_LOCKED_SECTION, open: true, reason: 'opened', canClose: true },
              {
                ...FIXTURE_OPEN_SECTION,
                key: 'with_data',
                label: 'With Data',
                reason: 'has_data',
                canClose: false,
              },
            ],
            openCount: 2,
          },
        ],
      }),
    });
    const closable = container.querySelector('#section-visa_history');
    const box = closable?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    const data = new FormData(box?.closest('form') as HTMLFormElement);
    expect(data.get('open')).toBe('false');
    expect(container.querySelector('#section-with_data')?.textContent).toContain(
      'Open because it holds your details',
    );
  });

  it('searches inside locked sections too and leaves history reachable', () => {
    const input = container.querySelector<HTMLInputElement>('#profile-search');
    if (!input) throw new Error('Missing search');
    typeInto(input, 'visa expiry');
    expect(container.querySelector('#profile-panel-identity')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#section-visa_history')).not.toBeNull();
    expect(container.querySelector('#section-identity_basics')).toBeNull();
    expect(container.querySelector('#section-visa_history details')?.hasAttribute('open')).toBe(
      true,
    );
    expect(
      container.querySelector('a[href="/app/applicant/synthetic-person/history"]'),
    ).not.toBeNull();
  });

  it('opens the "Other" text box as soon as Other is chosen', () => {
    expect(container.querySelector('#f-marital_status_other')).toBeNull();
    const select = container.querySelector<HTMLSelectElement>('#f-marital_status');
    if (!select) throw new Error('Missing choice');
    expect([...select.options].map((option) => option.value)).toContain('Other');
    typeInto(select, 'Other');
    const detail = container.querySelector<HTMLInputElement>('#f-marital_status_other');
    expect(detail).not.toBeNull();
    expect(new FormData(detail?.closest('form') as HTMLFormElement).get('fieldKey')).toBe(
      'marital_status_other',
    );
  });

  it('offers "does not apply" for an empty detail and shows it once marked', () => {
    const toggles = container.querySelectorAll('#section-identity_basics .profile-exempt');
    expect(toggles.length).toBeGreaterThan(0);
    const form = toggles[0] as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get('kind')).toBe('FIELD_NOT_APPLICABLE');
    expect(data.get('on')).toBe('true');
    render({
      view: fixtureView({
        layers: [
          {
            key: 'identity',
            label: 'Identity and Civil Status',
            description: 'Names.',
            sections: [{ ...FIXTURE_OPEN_SECTION, notApplicable: ['given_name'] }],
            openCount: 1,
          },
        ],
      }),
    });
    expect(container.querySelector('#section-identity_basics')?.textContent).toContain(
      'Given Name: marked as not applying to you.',
    );
    expect(container.querySelector('#section-identity_basics')?.textContent).toContain(
      'Does not apply',
    );
  });

  it('offers a "none" choice for a repeating record with nothing recorded', () => {
    render({ view: fixtureView() });
    act(() => tab('Travel Documents').click());
    const none = [
      ...container.querySelectorAll<HTMLFormElement>('#section-passport .profile-exempt'),
    ].map((form) => new FormData(form));
    expect(none.some((data) => data.get('kind') === 'RECORD_NONE')).toBe(true);
    expect(none.find((data) => data.get('kind') === 'RECORD_NONE')?.get('targetKey')).toBe(
      'historical_passport',
    );
  });

  it('gives every open section a "something else" form tied to that section', () => {
    const form = container.querySelector<HTMLFormElement>(
      '#section-identity_basics .profile-other-items form',
    );
    if (!form) throw new Error('Missing other-item form');
    const data = new FormData(form);
    expect(data.get('sectionKey')).toBe('identity_basics');
    expect(form.querySelector('[name="title"]')).not.toBeNull();
    expect(form.querySelector('[name="details"]')).not.toBeNull();
    expect(form.querySelector('[name="date"]')).not.toBeNull();
  });

  it('shows saved something-else items beside the section they were filed under', () => {
    render({
      repeatingValues: {
        other_item_universal_section: {
          one: { factId: 's1', value: 'identity_basics', status: 'DECLARED' },
          two: { factId: 's2', value: 'passport', status: 'DECLARED' },
        },
        other_item_universal_title: {
          one: { factId: 't1', value: 'Village certificate', status: 'DECLARED' },
          two: { factId: 't2', value: 'Old permit', status: 'DECLARED' },
        },
      },
    });
    const text = container.querySelector('#section-identity_basics')?.textContent ?? '';
    expect(
      container.querySelector<HTMLInputElement>('#f-other_item_universal_title-one')?.value,
    ).toBe('Village certificate');
    expect(text).not.toContain('Old permit');
  });

  it('offers purpose suggestions and a way to open them all at once', () => {
    expect(container.querySelector('#profile-purpose')).not.toBeNull();
    expect(container.textContent).not.toContain('Open suggested sections');
    render({ view: fixtureView({ suggestedFamily: 'study', suggestedLockedCount: 3 }) });
    expect(container.textContent).toContain('3 suggested sections are still locked.');
    expect(container.textContent).toContain('Open suggested sections');
    const data = new FormData(container.querySelector('.profile-suggest-open') as HTMLFormElement);
    expect(data.get('family')).toBe('study');
    render({ view: fixtureView({ suggestedFamily: 'study', suggestedLockedCount: 0 }) });
    expect(container.textContent).toContain('already open');
  });
});

it('shows protected date states without trying to format them as dates', () => {
  render({
    values: {
      date_of_birth: { factId: 'birth', value: '[protected]', status: 'DECLARED' },
      passport_number: {
        factId: 'number',
        value: '[protected: could not decrypt]',
        status: 'DECLARED',
      },
    },
    view: fixtureView({
      layers: [
        {
          key: 'identity',
          label: 'Identity and Civil Status',
          description: 'Names.',
          sections: [FIXTURE_OPEN_SECTION, FIXTURE_PASSPORT_SECTION],
          openCount: 2,
        },
      ],
    }),
  });
  const text = container.querySelector('#profile-panel-identity')?.textContent ?? '';
  expect(text).toContain('Protected detail');
  expect(text).toContain('Could not read this detail');
  expect(container.querySelector('.profile-read-summary')?.textContent).not.toContain(
    'Invalid Date',
  );
});
