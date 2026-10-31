// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_LOCKED_SECTION,
  FIXTURE_OPEN_SECTION,
  FIXTURE_PASSPORT_SECTION,
  fixtureEssentials,
  fixtureView,
} from '../../../../lib/master-profile-fixture';
import type { MasterProfileView } from '../../../../lib/master-profile-types';
vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
vi.mock('./section-actions', () => ({
  markEndedAction: vi.fn(),
  markNotCurrentAction: vi.fn(),
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
    startWithAll?: boolean;
    endedRecords?: Record<string, string>;
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
        startWithAll={options.startWithAll ?? false}
        {...(options.endedRecords ? { endedRecords: options.endedRecords } : {})}
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
    (node) => node.querySelector('.profile-area-name')?.textContent === label,
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

describe('a link to one section (WP-V3 part 3)', () => {
  /** Opens the page fresh, as arriving from a link does (the shared setup already mounted it). */
  function arrive() {
    act(() => root.unmount());
    root = createRoot(container);
    render();
  }

  afterEach(() => {
    window.location.hash = '';
  });

  it('opens the area holding the section named in the address, and follows a later change', () => {
    window.location.hash = '#section-passport';
    arrive();
    expect(tab('Travel Documents').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#profile-panel-travel_documents')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(container.querySelector('#section-passport')).not.toBeNull();
    act(() => {
      window.location.hash = '#section-identity_basics';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(tab('Identity and Civil Status').getAttribute('aria-selected')).toBe('true');
  });

  it('does not follow the link again when the page re-renders with a new view after a save', () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      window.location.hash = '#section-passport';
      arrive();
      expect(scroll).toHaveBeenCalledTimes(1);
      // The person moves to another area and types a search.
      act(() => tab('Identity and Civil Status').click());
      const search = container.querySelector<HTMLInputElement>('#profile-search');
      if (!search) throw new Error('search box');
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(search, 'passport');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(search.value).toBe('passport');
      // A save re-renders the page with a fresh view object.
      render({ view: fixtureView() });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(container.querySelector<HTMLInputElement>('#profile-search')?.value).toBe('passport');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('ignores a section name that is not on the page', () => {
    window.location.hash = '#section-nothing_here';
    arrive();
    expect(tab('Identity and Civil Status').getAttribute('aria-selected')).toBe('true');
  });
});

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

  it('links a value read from a document back to that document, and not a typed one', () => {
    const key = FIXTURE_OPEN_SECTION.singles[0]?.key as string;
    const other = FIXTURE_OPEN_SECTION.singles[1]?.key as string;
    render({
      values: {
        [key]: {
          factId: 'f1',
          value: 'Ayesha',
          status: 'DOCUMENT_SUPPORTED',
          sourceDocumentId: 'doc-9',
        },
        [other]: { factId: 'f2', value: 'Typed', status: 'APPLICANT_CONFIRMED' },
      } as never,
    });
    const links = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Where This Came From',
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(
      '/app/applicant/synthetic-person/documents?document=doc-9',
    );
  });

  it('adds an additional passport without overwriting the existing record', () => {
    act(() => tab('Travel Documents').click());
    const add = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Historical / Additional Passport'),
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

  it('lists the documents behind an open section, what is on file, and links to upload each', () => {
    render({
      view: fixtureView({
        layers: [
          {
            key: 'identity',
            label: 'Identity and Civil Status',
            description: 'Names.',
            sections: [
              {
                ...FIXTURE_OPEN_SECTION,
                documents: [
                  {
                    key: 'TAX_ACKNOWLEDGEMENT_SLIP',
                    label: 'Tax Return Acknowledgement Slip',
                    original: true,
                    uploaded: 0,
                  },
                  { key: 'VISA_STAMP', label: 'Visa Stamp', original: false, uploaded: 1 },
                ],
              },
            ],
            openCount: 1,
          },
        ],
      }),
    });
    const block = container.querySelector('.section-documents');
    expect(block?.querySelector('h5')?.textContent).toBe('Documents for This Section');
    const rows = [...(block?.querySelectorAll('li') ?? [])];
    expect(rows[0]?.textContent).toContain('Not Uploaded Yet');
    expect(rows[0]?.textContent).toContain('handed in as the original');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe(
      '/app/applicant/synthetic-person/documents?type=TAX_ACKNOWLEDGEMENT_SLIP#document-upload',
    );
    expect(rows[0]?.querySelector('.badge')?.className).toContain('badge-neutral');
    expect(rows[1]?.querySelector('.badge')?.textContent).toBe('Uploaded');
    expect(rows[1]?.querySelector('.badge')?.className).toContain('badge-success');
    expect(rows[1]?.textContent).not.toContain('original');
    expect(rows[1]?.querySelector('a')?.textContent).toContain('Add Another');
  });

  it('shows no badge when the counts could not load, and hides documents a search rules out', () => {
    render({
      view: fixtureView({
        layers: [
          {
            key: 'identity',
            label: 'Identity and Civil Status',
            description: 'Names.',
            sections: [
              {
                ...FIXTURE_OPEN_SECTION,
                documents: [
                  { key: 'VISA_STAMP', label: 'Visa Stamp', original: false, uploaded: null },
                ],
              },
            ],
            openCount: 1,
          },
        ],
      }),
    });
    const row = container.querySelector('.section-documents li');
    expect(row?.querySelector('.badge')).toBeNull();
    expect(row?.querySelector('a')?.textContent).toContain('Upload');
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
    expect(container.textContent).not.toContain('Open Suggested Sections');
    render({ view: fixtureView({ suggestedFamily: 'study', suggestedLockedCount: 3 }) });
    expect(container.textContent).toContain('3 suggested sections are still locked.');
    expect(container.textContent).toContain('Open Suggested Sections');
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

describe('the list of profile areas', () => {
  const counts = () =>
    [...container.querySelectorAll('.profile-area-rail button')].map((button) => [
      button.querySelector('.profile-area-name')?.textContent,
      button.querySelector('.profile-area-count')?.textContent ?? null,
    ]);

  it('lists every area down the side with how many details are filled, and nothing scrolls sideways', () => {
    const names = counts().map(([name]) => name);
    expect(names).toEqual(fixtureView().layers.map((layer) => layer.label));
    const identity = counts().find(([name]) => name === 'Identity and Civil Status');
    expect(identity?.[1]).toMatch(/^\d+\/\d+ details filled$/);
    expect(container.querySelector('.profile-section-tabs')).toBeNull();
  });

  it('names the count in words for a screen reader', () => {
    const first = container.querySelector('.profile-area-rail .profile-area-count .sr-only');
    expect(first?.textContent).toBe(' details filled');
  });

  it('moves between areas with the up and down arrows as well as left and right', () => {
    const first = tab('Identity and Civil Status');
    first.focus();
    act(() =>
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.activeElement).toBe(tab('Travel Documents'));
    act(() =>
      tab('Travel Documents').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tab('Identity and Civil Status'));
    act(() =>
      tab('Identity and Civil Status').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
  });

  it('gives a phone one "Area" box showing the current area, which opens the same list and closes when one is chosen', () => {
    const picker = container.querySelector<HTMLDetailsElement>('.profile-area-picker');
    if (!picker) throw new Error('Missing area picker');
    expect(picker.querySelector('summary')?.textContent).toContain('Area');
    expect(picker.querySelector('summary .profile-area-name')?.textContent).toBe(
      'Identity and Civil Status',
    );
    act(() => {
      picker.open = true;
      picker.dispatchEvent(new Event('toggle'));
    });
    const choice = [
      ...picker.querySelectorAll<HTMLButtonElement>('.profile-area-picker-list button'),
    ].find(
      (button) => button.querySelector('.profile-area-name')?.textContent === 'Travel Documents',
    );
    if (!choice) throw new Error('Missing choice');
    act(() => choice.click());
    expect(picker.querySelector('summary .profile-area-name')?.textContent).toBe(
      'Travel Documents',
    );
    expect(picker.open).toBe(false);
    expect(container.querySelector('#profile-panel-travel_documents')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(
      picker.querySelector('.profile-area-picker-list [aria-current="true"] .profile-area-name')
        ?.textContent,
    ).toBe('Travel Documents');
  });

  it('stops pretending to be tabs while a search is showing results from every area', () => {
    const search = container.querySelector<HTMLInputElement>('#profile-search');
    if (!search) throw new Error('Missing search');
    typeInto(search, 'passport');
    expect(container.querySelector('.profile-area-rail')?.getAttribute('role')).toBeNull();
    expect(container.querySelector('.profile-area-rail button[role="tab"]')).toBeNull();
  });
});

describe('Essentials First (owner finding 5)', () => {
  function arrive(view: MasterProfileView = fixtureView({ essentials: fixtureEssentials() })) {
    act(() => root.unmount());
    root = createRoot(container);
    render({ view });
  }
  const toggle = () => {
    const button = [...container.querySelectorAll('button')].find((node) =>
      ['Show All Sections', 'Show Essentials Only'].includes(node.textContent ?? ''),
    );
    if (!button) throw new Error('Missing the Show All Sections control');
    return button;
  };
  const badges = () =>
    [...container.querySelectorAll('.profile-essential-status .badge')].map(
      (node) => node.textContent,
    );

  afterEach(() => {
    window.location.hash = '';
  });

  it('opens on the short list with its own progress, before any section or overall count', () => {
    arrive();
    const text = container.textContent ?? '';
    expect(container.querySelector('.profile-essentials h3')?.textContent).toBe('Essentials First');
    // The count and bar sit once, in the page banner above this block.
    expect(text).not.toContain('essentials added');
    expect(badges()).toEqual(['Not Added Yet', 'Added', 'Not Added Yet']);
    // Each essential is edited right here: a single detail, and the home address record.
    expect(container.querySelector('#f-given_name')).not.toBeNull();
    expect(text).toContain('Home Address');
    expect(text).toContain('Add Address');
    // Everything else waits behind the control, including the full count and the area list.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('#profile-search')).toBeNull();
    expect(text).not.toContain('Full profile');
    expect(text).not.toContain('What is this profile for?');
    expect(toggle().textContent).toBe('Show All Sections');
  });

  it('shows every section and the full count behind Show All Sections, and comes back', () => {
    arrive();
    act(() => toggle().click());
    const text = container.textContent ?? '';
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('#profile-search')).not.toBeNull();
    expect(text).toContain(
      'Full profile: 0 of 5 details in your 2 open sections have values (0%).',
    );
    // The list itself steps aside, so no detail is drawn twice (one form, one id per detail).
    expect(container.querySelector('.profile-essentials-list')).toBeNull();
    expect(container.querySelectorAll('#f-given_name')).toHaveLength(1);
    expect(toggle().textContent).toBe('Show Essentials Only');
    act(() => toggle().click());
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelectorAll('#f-given_name')).toHaveLength(1);
  });

  it('opens on all sections once every essential is added, with the list one click away', () => {
    arrive(fixtureView({ essentials: fixtureEssentials({ givenName: true, address: true }) }));
    expect(container.textContent).toContain('Every essential is added.');
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(toggle().textContent).toBe('Show Essentials Only');
  });

  it('opens all sections when the person asked for purpose suggestions or a link asks for all', () => {
    arrive(fixtureView({ essentials: fixtureEssentials(), suggestedFamily: 'study' }));
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    render({ view: fixtureView({ essentials: fixtureEssentials() }), startWithAll: true });
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('opens all sections at once when a link names one section', () => {
    window.location.hash = '#section-passport';
    arrive();
    expect(tab('Travel Documents').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#section-passport')).not.toBeNull();
  });

  it('sends Add Information to the first essential still to add', () => {
    arrive();
    const link = document.createElement('a');
    link.href = '#profile-editor';
    document.body.append(link);
    try {
      act(() => link.click());
      expect(document.activeElement?.id).toBe('f-given_name');
    } finally {
      link.remove();
    }
  });

  it('says plainly when an essential was marked as not applying, and lets it be undone', () => {
    const essentials = fixtureEssentials();
    arrive(
      fixtureView({
        essentials: {
          ...essentials,
          answered: 2,
          items: essentials.items.map((item) =>
            item.key === 'given_name' ? { ...item, answered: true, notApplicable: true } : item,
          ),
        },
      }),
    );
    expect(badges()[0]).toBe('Does Not Apply');
    expect(container.textContent).toContain('Given Name: marked as not applying to you.');
    const undo = [...container.querySelectorAll('.profile-essential label')].find((node) =>
      node.textContent?.includes('This does not apply to me'),
    );
    expect(undo?.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
  });
});

describe('No Longer Current and Ended (LC-G1)', () => {
  const key = FIXTURE_OPEN_SECTION.singles[0]?.key as string;

  function notCurrentForms() {
    return [
      ...container.querySelectorAll<HTMLFormElement>(
        '#section-identity_basics .profile-lifecycle-mark form',
      ),
    ];
  }

  it('offers No Longer Current on a saved value, naming the detail, and posts that fact', () => {
    render({ values: { [key]: { factId: 'f1', value: 'Ayesha', status: 'APPLICANT_CONFIRMED' } } });
    const forms = notCurrentForms();
    expect(forms).toHaveLength(1);
    const data = new FormData(forms[0]);
    expect(data.get('applicantId')).toBe('synthetic-person');
    expect(data.get('factId')).toBe('f1');
    const button = forms[0]?.querySelector('button');
    expect(button?.textContent).toBe('No Longer Current');
    expect(button?.getAttribute('aria-label')).toBe('No Longer Current: Given Name');
  });

  it('shows a value marked no longer current as such, offers "does not apply" again, and no second mark', () => {
    render({ values: { [key]: { factId: 'f1', value: null, status: 'STALE' } } });
    const section = container.querySelector('#section-identity_basics');
    expect(section?.querySelector('.profile-read-summary dd')?.textContent).toBe(
      'No Longer Current',
    );
    expect(section?.textContent).toContain(
      'You marked this No Longer Current. Enter a new value above when you have one.',
    );
    expect(section?.textContent).not.toContain('Protected detail');
    expect(notCurrentForms()).toHaveLength(0);
    const exempt = [...(section?.querySelectorAll<HTMLFormElement>('.profile-exempt') ?? [])].map(
      (form) => new FormData(form).get('targetKey'),
    );
    expect(exempt).toContain(key);
  });

  it('offers Ended on a saved list entry, with a date, for that entry only', () => {
    act(() => tab('Travel Documents').click());
    const forms = [
      ...container.querySelectorAll<HTMLFormElement>(
        '#profile-panel-travel_documents .profile-record-end form',
      ),
    ];
    expect(forms).toHaveLength(1);
    const data = new FormData(forms[0]);
    expect(data.get('recordGroupKey')).toBe('historical_passport');
    expect(data.get('repeatingRecordKey')).toBe('existing-record');
    const date = forms[0]?.querySelector<HTMLInputElement>('input[name="endedOn"]');
    expect(date?.type).toBe('date');
    expect(date?.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const button = forms[0]?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe(
      'Mark as Ended: Historical / Additional Passport 1',
    );
    expect(date?.id && forms[0]?.querySelector(`label[for="${date.id}"]`)?.textContent).toBe(
      'Date It Ended',
    );
    // A new, unsaved entry has nothing to end yet.
    const add = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Historical / Additional Passport'),
    );
    act(() => add?.click());
    expect(
      container.querySelectorAll('#profile-panel-travel_documents .profile-record-end form'),
    ).toHaveLength(1);
  });

  it('shows an ended entry as Ended with its date, keeps its details editable, and offers no second end', () => {
    render({
      repeatingValues: {
        historical_passport_number: {
          'existing-record': { factId: 'fact', value: 'SYNTHETIC', status: 'DECLARED' },
        },
      },
      endedRecords: { 'existing-record': '2025-06-30T00:00:00.000Z' },
    });
    act(() => tab('Travel Documents').click());
    const panel = container.querySelector('#profile-panel-travel_documents');
    expect(panel?.querySelector('.profile-record-ended .badge')?.textContent).toBe('Ended');
    expect(panel?.textContent).toMatch(/Ended on [^.]*2025\./);
    expect(panel?.textContent).toContain('Save a change below to make it current again.');
    expect(panel?.querySelector('.profile-record-end')).toBeNull();
    expect(
      panel?.querySelector<HTMLInputElement>('#f-historical_passport_number-existing-record')
        ?.value,
    ).toBe('SYNTHETIC');
  });
});
