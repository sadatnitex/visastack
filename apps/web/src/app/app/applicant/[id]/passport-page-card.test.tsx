// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureEssentials, fixtureView } from '../../../../lib/master-profile-fixture';
import type { EditorFieldDef, EditorSection } from '../../../../lib/master-profile-types';

/**
 * WAL4 (owner decision 17 Nov 2026, option B): the Passport Page Card prints the profile's own
 * values for the eleven passport details, masks the protected ones until Show, never shows the
 * stand-in "[protected]", says Not Added Yet with Add for empty ones, and every tap opens that
 * detail's own edit row with every function kept. Every other single detail is one value row.
 * Made-up values only.
 */

const reveal = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
vi.mock('./profile-reveal-actions', () => ({ revealProfileValueAction: reveal }));
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

const field = (
  key: string,
  label: string,
  extra: Partial<EditorFieldDef> = {},
): EditorFieldDef => ({ key, label, sensitivity: 'STANDARD', ...extra });

const section = (
  key: string,
  layer: string,
  label: string,
  singles: EditorFieldDef[],
  notApplicable: string[] = [],
  open = true,
): EditorSection => ({
  key,
  label,
  description: `${label} details.`,
  layer,
  open,
  reason: open ? 'default' : 'locked',
  canClose: false,
  suggested: false,
  detailCount: singles.length,
  answered: 0,
  total: singles.length,
  singles,
  groups: [],
  notApplicable,
  previewLabels: [],
  otherItem: {
    pack: 'universal',
    sectionFieldKey: 'other_item_universal_section',
    fields: [field('other_item_universal_title', 'What It Is')],
  },
});

/** The live layout: seven identity details plus email in Identity, four passport details in Travel Documents. */
function view(
  options: { notApplicable?: string[]; essentials?: boolean; identityClosed?: boolean } = {},
) {
  return fixtureView({
    ...(options.essentials ? { essentials: fixtureEssentials() } : {}),
    layers: [
      {
        key: 'identity',
        label: 'Identity and Civil Status',
        description: 'Names.',
        openCount: 1,
        sections: [
          section(
            'identity_basics',
            'identity',
            'Identity Basics',
            [
              field('given_name', 'Given Name'),
              field('family_name', 'Family Name'),
              field('date_of_birth', 'Date of Birth', { type: 'date', sensitivity: 'SENSITIVE' }),
              field('nationality', 'Nationality'),
              field('marital_status', 'Marital Status', {
                options: ['Single', 'Married', 'Other'],
                otherDetail: field('marital_status_other', 'Other Marital Status'),
              }),
              field('sex', 'Sex', { options: ['Female', 'Male', 'Unspecified'] }),
              field('place_of_birth', 'Place of Birth'),
              field('email', 'Email Address'),
            ],
            options.notApplicable,
            !options.identityClosed,
          ),
        ],
      },
      {
        key: 'travel_documents',
        label: 'Travel Documents',
        description: 'Passports.',
        openCount: 1,
        sections: [
          section('passport', 'travel_documents', 'Passport', [
            field('passport_number', 'Passport Number', { sensitivity: 'SENSITIVE' }),
            field('passport_issuing_country', 'Passport Issuing Country'),
            field('passport_issue_date', 'Passport Issue Date', { type: 'date' }),
            field('passport_expiry', 'Passport Expiry Date', { type: 'date' }),
          ]),
        ],
      },
    ],
  });
}

type Value = {
  factId: string;
  value: string | null;
  status: string | null;
  locked?: 'no_key' | 'unreadable' | 'lost' | null;
  sourceDocumentId?: string | null;
  updatedAt?: string | null;
  effectiveFrom?: string | null;
  withheld?: boolean;
};

const FULL: Record<string, Value> = {
  given_name: { factId: 'f1', value: 'EXAMPLE', status: 'DOCUMENT_SUPPORTED' },
  family_name: { factId: 'f2', value: 'SAMPLE', status: 'DECLARED' },
  date_of_birth: { factId: 'f3', value: '1990-04-12', status: 'APPLICANT_CONFIRMED' },
  nationality: { factId: 'f4', value: 'Testland', status: 'DECLARED' },
  marital_status: { factId: 'f5', value: 'Other', status: 'DECLARED' },
  marital_status_other: { factId: 'f5o', value: 'Made-up status', status: 'DECLARED' },
  sex: { factId: 'f6', value: 'Unspecified', status: 'DECLARED' },
  place_of_birth: { factId: 'f7', value: 'Example Town', status: 'DECLARED' },
  passport_number: {
    factId: 'f8',
    value: 'X1234567',
    status: 'DOCUMENT_SUPPORTED',
    sourceDocumentId: 'doc-1',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  passport_issuing_country: { factId: 'f9', value: 'Testland', status: 'DECLARED' },
  passport_issue_date: { factId: 'f10', value: '2020-01-15', status: 'DECLARED' },
  passport_expiry: { factId: 'f11', value: '2030-01-14', status: 'DECLARED' },
  email: { factId: 'f12', value: 'person@example.test', status: 'DECLARED' },
};

let root: Root;
let container: HTMLDivElement;

function render(
  values: Record<string, Value>,
  options: {
    notApplicable?: string[];
    essentials?: boolean;
    startWithAll?: boolean;
    identityClosed?: boolean;
  } = {},
) {
  act(() =>
    root.render(
      <ProfileEditor
        applicantId="synthetic-person"
        values={values}
        repeatingValues={{}}
        assurance={
          new Map([
            [
              'f8',
              {
                applicantDeclared: true,
                documentSupplied: true,
                machineChecks: [],
                agencyReviews: [],
                issuerConfirmations: [],
                tier: 'E1',
              },
            ],
          ])
        }
        view={view(options)}
        startWithAll={options.startWithAll ?? true}
      />,
    ),
  );
}

const card = () => {
  const found = container.querySelector<HTMLElement>('.passport-page-card');
  if (!found) throw new Error('No Passport Page Card');
  return found;
};
const line = (key: string) => {
  const found = card().querySelector<HTMLElement>(`[data-detail="${key}"]`);
  if (!found) throw new Error(`No line for ${key}`);
  return found;
};
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error('Nothing to click');
  act(() => (element as HTMLElement).click());
};
/** A click whose work finishes after a promise (Edit opens its box once any value is opened). */
const clickAndSettle = async (element: Element | null | undefined) => {
  if (!element) throw new Error('Nothing to click');
  await act(async () => (element as HTMLElement).click());
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Passport Page Card', () => {
  it('prints the eleven details from the profile, and says it does not verify identity', () => {
    render(FULL);
    const lines = [...card().querySelectorAll('[data-detail]')].map((el) =>
      el.getAttribute('data-detail'),
    );
    expect(lines.sort()).toEqual(
      [
        'given_name',
        'family_name',
        'date_of_birth',
        'nationality',
        'marital_status',
        'sex',
        'passport_number',
        'passport_issuing_country',
        'passport_issue_date',
        'passport_expiry',
        'place_of_birth',
      ].sort(),
    );
    expect(card().textContent).toContain('This does not verify identity.');
    expect(line('given_name').textContent).toContain('EXAMPLE');
    expect(line('family_name').textContent).toContain('SAMPLE');
    expect(line('nationality').textContent).toContain('Testland');
    expect(line('sex').textContent).toContain('Unspecified');
    expect(line('place_of_birth').textContent).toContain('Example Town');
    expect(line('marital_status').textContent).toContain('Other: Made-up status');
    expect(line('passport_issuing_country').textContent).toContain('Testland');
    expect(line('passport_expiry').textContent).toContain('2030');
    expect(line('passport_issue_date').textContent).toContain('2020');
    // The drawing is schematic: no picture file, no photo.
    expect(card().querySelector('img, image')).toBeNull();
    // Labels come from the catalogue, not from the card's own fallback list.
    expect(line('passport_expiry').querySelector('dt')?.textContent).toBe('Passport Expiry Date');
  });

  it('masks protected values until Show, and never writes them into a label or the drawing', () => {
    render(FULL);
    const html = card().innerHTML;
    expect(html).not.toContain('X1234567');
    expect(html).not.toContain('1990');
    expect(line('passport_number').querySelector('[data-masked="true"]')).not.toBeNull();
    // The value rows mask them too.
    const rowSummary = container.querySelector('#profile-row-passport_number summary');
    expect(rowSummary?.textContent).not.toContain('X1234567');

    const show = line('passport_number').querySelector<HTMLButtonElement>(
      'button.passport-page-show',
    );
    expect(show?.textContent).toBe('Show Passport Number');
    // The name says what a press does; a pressed state on top would read as a double negative.
    expect(show?.hasAttribute('aria-pressed')).toBe(false);
    // The status button names its detail.
    expect(
      line('passport_number').querySelector('.explain-tip-trigger .sr-only')?.textContent,
    ).toBe('Passport Number: Backed by a Document');
    click(show);
    expect(line('passport_number').textContent).toContain('X1234567');
    expect(show?.textContent).toBe('Hide Passport Number');
    // Only the chosen detail is shown.
    expect(line('date_of_birth').innerHTML).not.toContain('1990');
    for (const el of card().querySelectorAll('[aria-label], [title]')) {
      expect(`${el.getAttribute('aria-label')} ${el.getAttribute('title')}`).not.toContain(
        'X1234567',
      );
    }
    click(show);
    expect(line('passport_number').innerHTML).not.toContain('X1234567');
  });

  it.each(['[protected]', '[Protected]', '[protected: could not decrypt]'])(
    'never shows the stand-in %j, and offers no Show for it',
    (standIn) => {
      render({
        ...FULL,
        date_of_birth: { factId: 'f3', value: standIn, status: 'APPLICANT_CONFIRMED' },
        passport_number: { factId: 'f8', value: standIn, status: 'APPLICANT_CONFIRMED' },
      });
      expect(container.innerHTML.toLowerCase()).not.toContain('[protected');
      expect(line('passport_number').querySelector('button.passport-page-show')).toBeNull();
      expect(line('passport_number').textContent).toMatch(
        /Protected detail|Could not read this detail/,
      );
    },
  );

  it.each([
    ['no_key', 'Protected detail'],
    ['unreadable', 'Could not read this detail'],
    ['lost', 'Needs to be added again'],
  ] as const)('a %s value shows the existing words, never a value', (locked, words) => {
    render({
      ...FULL,
      passport_number: { factId: 'f8', value: null, status: 'DECLARED', locked },
    });
    expect(line('passport_number').textContent).toContain(words);
    expect(line('passport_number').querySelector('button.passport-page-show')).toBeNull();
  });

  it('says Not Added Yet with Add for empty details, and Add opens the detail to edit', () => {
    render({});
    for (const key of ['given_name', 'passport_expiry', 'date_of_birth']) {
      expect(line(key).textContent).toContain('Not Added Yet');
      expect(line(key).querySelector('a')?.textContent).toMatch(/^Add /);
    }
    click(line('passport_expiry').querySelector('a'));
    const row = container.querySelector('#profile-row-passport_expiry');
    expect(row?.querySelector('details')?.open).toBe(true);
    expect(row?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement?.id).toBe('f-passport_expiry');
  });

  it('a tap on a value in another area opens its row with every function there', async () => {
    render(FULL);
    await clickAndSettle(line('passport_number').querySelector('a.passport-page-value'));
    const row = container.querySelector<HTMLElement>('#profile-row-passport_number');
    expect(row?.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('#profile-panel-travel_documents')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(document.activeElement?.id).toBe('f-passport_number');
    const text = row?.textContent ?? '';
    expect(row?.querySelector('form.field-row button[type="submit"]')?.textContent).toBe('Save');
    expect(text).toContain('Add the Date This Became True');
    expect(row?.querySelector('input[name="effectiveFrom"]')).not.toBeNull();
    expect(text).toContain('Where This Came From');
    expect(text).toContain('How This Was Checked');
    expect(text).toContain('No Longer Current');
    // One box per detail on the page: the card holds none.
    expect(container.querySelectorAll('#f-passport_number')).toHaveLength(1);
    expect(card().querySelector('input, select, textarea, form')).toBeNull();
  });

  it('a detail that does not apply says so, and its row still offers the switch back', () => {
    render({}, { notApplicable: ['place_of_birth'] });
    expect(line('place_of_birth').textContent).toContain('Does not apply');
    expect(container.querySelector('#profile-row-place_of_birth')?.textContent).toContain(
      'This does not apply to me',
    );
    // A tap moves the focus into the row, onto its switch back (there is no value box).
    click(line('place_of_birth').querySelector('a'));
    expect(
      container.querySelector('#profile-row-place_of_birth')?.contains(document.activeElement),
    ).toBe(true);
  });

  it('a protected detail in a closed section is never called missing', () => {
    render(
      { date_of_birth: { factId: 'f3', value: null, status: 'APPLICANT_CONFIRMED' } },
      { identityClosed: true },
    );
    expect(line('date_of_birth').textContent).toContain('Protected detail');
    expect(line('date_of_birth').textContent).not.toContain('Not recorded');
    expect(line('date_of_birth').querySelector('a')).toBeNull();
  });

  it('a click with a modifier key keeps the link for a new tab', () => {
    render(FULL);
    const link = line('passport_number').querySelector('a.passport-page-value');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => {
      link?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(
      container.querySelector('#profile-row-passport_number details')?.hasAttribute('open'),
    ).toBe(false);
  });

  it('the card and the row say the same for an empty and for a lost detail', () => {
    render({
      ...FULL,
      passport_number: { factId: 'f8', value: null, status: 'DOCUMENT_SUPPORTED', locked: 'lost' },
      email: { factId: 'f12', value: null, status: null },
      given_name: { factId: 'f1', value: null, status: null },
    });
    expect(line('given_name').textContent).toContain('Not Added Yet');
    expect(
      container.querySelector('#profile-row-given_name .expandable-section-summary')?.textContent,
    ).toBe('Not Added Yet');
    expect(line('passport_number').querySelector('.status-picture')).toBeNull();
    expect(
      container.querySelector('#profile-row-passport_number .expandable-section-status'),
    ).toBeNull();
  });

  it('with only the essentials showing, a tap opens the detail in its own row (ESS1)', async () => {
    render({}, { essentials: true, startWithAll: false });
    // Essentials First does not repeat the card, so every line leads to the detail's own row.
    expect(line('given_name').querySelector('a')?.getAttribute('href')).toBe(
      '?view=all#profile-row-given_name',
    );
    expect(line('passport_expiry').querySelector('a')?.getAttribute('href')).toBe(
      '?view=all#profile-row-passport_expiry',
    );
    expect(container.querySelector('.profile-essentials #f-given_name')).toBeNull();
    await clickAndSettle(line('given_name').querySelector('a'));
    expect(document.activeElement?.id).toBe('f-given_name');
    await clickAndSettle(line('passport_expiry').querySelector('a'));
    expect(document.activeElement?.id).toBe('f-passport_expiry');
  });

  it('is hidden while searching, so the search results stand alone', () => {
    render(FULL);
    const search = container.querySelector<HTMLInputElement>('#profile-search');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'email',
      );
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.passport-page-card')).toBeNull();
  });
});

describe('value rows for every single detail', () => {
  it('draws one row per detail: name, value and one status picture', () => {
    render(FULL);
    const row = container.querySelector<HTMLElement>('#profile-row-email');
    expect(row?.classList.contains('profile-value-row')).toBe(true);
    expect(row?.querySelector('h5')?.textContent).toBe('Email Address');
    expect(row?.querySelector('.expandable-section-summary')?.textContent).toBe(
      'person@example.test',
    );
    const pictures = row?.querySelectorAll('.expandable-section-status .status-picture');
    expect(pictures).toHaveLength(1);
    expect(pictures?.[0]?.getAttribute('data-status')).toBe('DECLARED');
    // The row's status button names its detail, as on the card.
    expect(
      row?.querySelector('.expandable-section-status .explain-tip-trigger .sr-only')?.textContent,
    ).toBe('Email Address: Entered');
    // Closed until opened; inside, the saved value reads as a row with Edit, and no box (ESS1).
    expect(row?.querySelector('details')?.open).toBe(false);
    expect(row?.querySelector('button[data-edit="email"]')?.textContent).toBe('Edit Email Address');
    expect(row?.querySelector('#f-email')).toBeNull();
  });

  it('Add Information opens the first row and focuses its box', () => {
    render(FULL);
    act(() => {
      window.location.hash = '#profile-editor';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const first = container.querySelector('#profile-panel-identity .profile-value-row details');
    expect((first as HTMLDetailsElement | null)?.open).toBe(true);
    // Every detail here is added, so the focus lands on the first one's Edit, not a box.
    expect(document.activeElement?.getAttribute('data-edit')).toBe('given_name');
    window.location.hash = '';
  });
});

describe('ESS1: read rows, one Details per row, one date style', () => {
  const rowOf = (key: string) => {
    const found = container.querySelector<HTMLElement>(`.profile-field-row[data-field="${key}"]`);
    if (!found) throw new Error(`No row for ${key}`);
    return found;
  };

  it('draws a saved detail as a read row: name, value and Edit, with no box', () => {
    render(FULL);
    const row = rowOf('given_name');
    expect(row.querySelector('.field-label')?.textContent).toBe('Given Name');
    expect(row.querySelector('.profile-read-value')?.textContent).toBe('EXAMPLE');
    expect(row.querySelector('button[data-edit]')?.textContent).toBe('Edit Given Name');
    expect(row.querySelector('input[name="value"], select[name="value"]')).toBeNull();
    expect(container.querySelectorAll('form.field-row')).toHaveLength(0);
  });

  it('keeps every history tool behind one closed Details per row', () => {
    render(FULL);
    const row = rowOf('passport_number');
    const details = row.querySelectorAll('details');
    expect(details).toHaveLength(1);
    const disclosure = details[0] as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')?.textContent).toBe('Details Passport Number');
    const inside = disclosure.textContent ?? '';
    for (const words of [
      'Last confirmed',
      'Where This Came From',
      'How This Was Checked',
      'No Longer Current',
    ]) {
      expect(inside, words).toContain(words);
    }
    // Nothing of the history sits outside the disclosure.
    const outside = [...row.children]
      .filter((child) => child !== disclosure)
      .map((child) => child.textContent ?? '')
      .join(' ');
    expect(outside).not.toMatch(/Last confirmed|Where This Came From|How This Was Checked/);
    expect(outside).not.toContain('No Longer Current');
  });

  it('opens the box only on Edit, focuses it, and Cancel and a save go back to Edit', async () => {
    const { saveFactAction } = await import('./actions');
    render(FULL);
    const edit = () => rowOf('family_name').querySelector<HTMLButtonElement>('button[data-edit]');
    await clickAndSettle(edit());
    const box = container.querySelector<HTMLInputElement>('#f-family_name');
    expect(box?.value).toBe('SAMPLE');
    expect(document.activeElement).toBe(box);
    // The date it became true is in the row's Details, and goes with the same form.
    const date = rowOf('family_name').querySelector<HTMLInputElement>(
      'details input[name="effectiveFrom"]',
    );
    expect(date?.getAttribute('form')).toBe(box?.form?.id);
    const cancel = [...rowOf('family_name').querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel Family Name',
    );
    click(cancel);
    expect(container.querySelector('#f-family_name')).toBeNull();
    expect(document.activeElement).toBe(edit());
    vi.mocked(saveFactAction).mockResolvedValue({ ok: true, message: 'Family Name saved.' });
    await clickAndSettle(edit());
    const form = container.querySelector<HTMLInputElement>('#f-family_name')?.form;
    await act(async () => {
      form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(container.querySelector('#f-family_name')).toBeNull();
    expect(document.activeElement).toBe(edit());
    expect(rowOf('family_name').textContent).toContain('Family Name saved.');
  });

  it('opens a detail not added yet in its box at once, with no Cancel', () => {
    render({});
    const row = rowOf('given_name');
    expect(row.querySelector('#f-given_name')).not.toBeNull();
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Cancel Given Name',
    );
    expect(row.querySelector('details')?.open).toBe(false);
  });

  it('prints every date on the page in one style', () => {
    render({
      ...FULL,
      passport_issue_date: {
        factId: 'f10',
        value: '2020-01-15',
        status: 'DECLARED',
        effectiveFrom: '2020-01-10T00:00:00.000Z',
        updatedAt: '2026-11-04T10:00:00.000Z',
      },
    });
    expect(line('passport_expiry').textContent).toContain('14 Jan 2030');
    expect(rowOf('passport_expiry').querySelector('.profile-read-value')?.textContent).toBe(
      '14 Jan 2030',
    );
    expect(
      container.querySelector('#profile-row-passport_expiry .expandable-section-summary')
        ?.textContent,
    ).toBe('14 Jan 2030');
    const issue = rowOf('passport_issue_date').textContent ?? '';
    expect(issue).toContain('15 Jan 2020');
    expect(issue).toContain('Effective as of 10 Jan 2020');
    expect(issue).toContain('Last confirmed 4 Nov 2026');
    expect(rowOf('passport_number').textContent).toContain('Last confirmed 2 Jan 2026');
    const text = container.textContent ?? '';
    // No other style anywhere: no 04/17/1994, no Jan 14, 2030.
    expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    expect(text).not.toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });

  it('opens a withheld value on the card only on Show, and says so when it cannot', async () => {
    reveal.mockReset();
    const withheld = {
      ...FULL,
      date_of_birth: {
        factId: 'f3',
        value: null,
        status: 'APPLICANT_CONFIRMED',
        withheld: true,
      },
    };
    render(withheld);
    expect(container.innerHTML).not.toContain('1990');
    const show = () =>
      [...line('date_of_birth').querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Show'),
      );
    reveal.mockResolvedValueOnce({ ok: false });
    await clickAndSettle(show());
    expect(card().querySelector('output')?.textContent).toMatch(/could not be shown/);
    expect(line('date_of_birth').textContent).not.toContain('1990');
    reveal.mockResolvedValueOnce({ ok: true, value: '1990-04-12' });
    await clickAndSettle(show());
    expect(reveal).toHaveBeenLastCalledWith('synthetic-person', 'f3');
    expect(line('date_of_birth').textContent).toContain('12 Apr 1990');
    expect(card().querySelector('output')).toBeNull();
  });
});
