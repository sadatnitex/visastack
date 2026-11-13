// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import {
  FIXTURE_OPEN_SECTION,
  FIXTURE_PASSPORT_SECTION,
  fixtureEssentials,
  fixtureView,
} from '../../../../lib/master-profile-fixture';

/**
 * The profile editor under Bengali in the states profile-locale.test.tsx does not reach (refill 7):
 * every essential added, a purpose whose sections are all open, a section opened because it holds
 * details, the documents that back a section, a field that does not apply, an "Other" answer, a
 * date a value took effect, a record with none and a record that can be ended, and a search that
 * finds nothing. The real editor is mounted; the actions stand in.
 */

vi.mock('./actions', () => ({
  saveFactAction: vi.fn(),
  decideProposalAction: vi.fn(),
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
vi.mock('./section-actions', () => ({
  markEndedAction: vi.fn(),
  markNotCurrentAction: vi.fn(),
  openSuggestedSectionsAction: vi.fn(),
  saveOtherItemAction: vi.fn(),
  setExemptionAction: vi.fn(),
  setSectionOpenAction: vi.fn(),
}));

const { ProfileEditor } = await import('./profile-editor');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const E = 'appApplicant.appApplicantIdProfileEditor.';
const BENGALI = /[ঀ-৿]/;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const text = () => (host.textContent ?? '').replace(/\s+/g, ' ');

/** The identity section opened because it holds details, marked suggested, with its documents. */
const identity = {
  ...FIXTURE_OPEN_SECTION,
  reason: 'has_data' as const,
  suggested: true,
  notApplicable: ['passport_number'],
  documents: [
    { key: 'PASSPORT', label: 'Passport', original: false, uploaded: 0 },
    { key: 'NATIONAL_ID', label: 'National ID Card', original: false, uploaded: 2 },
  ],
};

async function mount(
  locale: 'en' | 'bn',
  props: Partial<React.ComponentProps<typeof ProfileEditor>> = {},
) {
  const view = fixtureView({
    essentials: fixtureEssentials({ givenName: true, address: true }),
    suggestedFamily: 'visit',
    suggestedLockedCount: 0,
    layers: [
      {
        key: 'identity',
        label: 'Identity and Civil Status',
        description: 'Names, birth and personal details.',
        sections: [identity],
        openCount: 1,
      },
      {
        key: 'travel_documents',
        label: 'Travel Documents',
        description: 'Passports, permits and visas held.',
        sections: [
          {
            ...FIXTURE_PASSPORT_SECTION,
            groups: [{ ...FIXTURE_PASSPORT_SECTION.groups[0], noneDeclared: true } as never],
          },
        ],
        openCount: 1,
      },
    ],
  });
  await act(async () => {
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        <ProfileEditor
          applicantId="synthetic-person"
          values={{
            given_name: {
              factId: 'f1',
              value: 'Karim',
              status: 'APPLICANT_CONFIRMED',
              updatedAt: '2026-10-10T12:00:00Z',
              effectiveFrom: '2026-03-01T00:00:00Z',
            },
            marital_status: { factId: 'f2', value: 'Other', status: 'DECLARED' },
            marital_status_other: { factId: 'f3', value: 'Made-up status', status: 'DECLARED' },
          }}
          repeatingValues={{}}
          assurance={new Map()}
          view={view}
          {...props}
        />
      </I18nProvider>,
    );
  });
}

async function chooseArea(label: string) {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
    (b) => b.querySelector('.profile-area-name')?.textContent === label,
  );
  await act(async () => tab?.click());
}

describe('the profile editor under Bengali, in its fuller states', () => {
  it('says every essential is added and offers Show Essentials Only in Bengali', async () => {
    await mount('bn');
    for (const key of [
      'everyEssentialIsAddedAddMore',
      'showEssentialsOnly',
      'everySectionSuggestedForThisPurpose',
    ]) {
      expect(text(), key).toContain(bn[`${E}${key}`]);
      expect(text(), key).not.toContain(en[`${E}${key}`]);
    }
    // The purposes and the button that opens suggested sections are named as they are.
    expect(text()).toContain('Visit');
  });

  it('marks a section opened for its details and suggested, and lists its documents, in Bengali', async () => {
    await mount('bn');
    for (const key of [
      'openBecauseItHoldsYourDetails',
      'suggested',
      'documentsForThisSection',
      'notUploadedYet',
      'uploaded',
      'upload',
      'addAnother',
    ])
      expect(text(), key).toContain(bn[`${E}${key}`]);
    // The document kinds stay as they are, also inside the link names.
    expect(text()).toContain(`${bn[`${E}upload`]} Passport`);
    expect(text()).toContain(`${bn[`${E}addAnother`]} National ID Card`);
    expect(text()).not.toContain('Documents for This Section');
    expect(text()).not.toContain('Not Uploaded Yet');
  });

  it('shows a detail that does not apply, an Other answer and the date a value took effect in Bengali', async () => {
    await mount('bn');
    expect(text()).toContain(bn[`${E}doesNotApply`]);
    expect(text()).toContain(bn[`${E}otherOthertext`]?.replace('{otherText}', 'Made-up status'));
    const words = bn[`${E}effectiveAsOfFormatdateonly`]?.replace('{formatDateOnly}', '').trim();
    expect(words).toMatch(BENGALI);
    const effective = [...host.querySelectorAll('p')].find((p) =>
      p.textContent?.includes(words ?? '\u0000'),
    );
    expect(effective?.textContent).toMatch(BENGALI);
    expect(effective?.textContent).toMatch(/১/);
    expect(effective?.textContent).not.toMatch(/[0-9]/);
    expect(text()).not.toContain('Does not apply');
    expect(text()).not.toContain('Effective as of');
  });

  it('says the person has none of a record in Bengali, and offers the end date on a record', async () => {
    await mount('bn');
    await chooseArea('Travel Documents');
    expect(text()).toContain(bn[`${E}youSaidYouHaveNone`]);
    expect(text()).not.toContain('You said you have none.');

    act(() => root.unmount());
    root = createRoot(host);
    await mount('bn', {
      repeatingValues: {
        historical_passport_number: {
          'existing-record': { factId: 'fact', value: 'SYNTHETIC', status: 'DECLARED' },
        },
      },
    });
    await chooseArea('Travel Documents');
    const label = [...host.querySelectorAll('label')].find(
      (l) => l.textContent === bn[`${E}dateItEnded`],
    );
    expect(label, 'Date It Ended').toBeTruthy();
    // Held (refill 2): the line that opens it names the record label, which is English.
    expect(bn[`${E}thisLabelEndedPosition`]).toBeUndefined();
  });

  it('says no field matches a search in Bengali', async () => {
    await mount('bn');
    const search = host.querySelector('#profile-search') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(search, 'zzzz no such field');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('output')?.textContent).toBe(bn[`${E}noFieldsMatchTryAnotherField`]);
  });

  it('is the same English as before under English', async () => {
    await mount('en');
    expect(text()).not.toMatch(BENGALI);
    for (const words of [
      'Every essential is added. Add more from any section when a case needs it.',
      'Show Essentials Only',
      'Open because it holds your details',
      'Documents for This Section',
      'Does not apply',
      'Other: Made-up status',
      'Effective as of',
    ])
      expect(text()).toContain(words);
  });
});
