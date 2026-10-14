import type {
  ChoiceGroup,
  EditorFieldDef,
  EditorSection,
  MasterProfileView,
} from './master-profile-types';

/**
 * A small, hand-written profile view for tests and visual fixtures. It has no link to the catalogue,
 * so tests that only draw the screen stay light. The real builder is covered by its own test.
 */

const field = (
  key: string,
  label: string,
  extra: Partial<EditorFieldDef> = {},
): EditorFieldDef => ({ key, label, sensitivity: 'STANDARD', ...extra });

const otherItem = (pack: string): EditorSection['otherItem'] => ({
  pack,
  sectionFieldKey: `other_item_${pack}_section`,
  fields: [
    field(`other_item_${pack}_title`, 'What It Is'),
    field(`other_item_${pack}_details`, 'Details or Value'),
    field(`other_item_${pack}_date`, 'Date', { type: 'date' }),
    field(`other_item_${pack}_note`, 'Note'),
  ],
});

const MARITAL = field('marital_status', 'Marital Status', {
  options: ['Single', 'Married', 'Other'],
  otherDetail: field('marital_status_other', 'Other Marital Status'),
});

export const FIXTURE_OPEN_SECTION: EditorSection = {
  key: 'identity_basics',
  label: 'Identity Basics',
  description: 'Your name, date of birth, nationality and how to reach you.',
  layer: 'identity',
  open: true,
  reason: 'default',
  canClose: false,
  suggested: false,
  detailCount: 4,
  answered: 0,
  total: 4,
  singles: [
    field('given_name', 'Given Name'),
    field('date_of_birth', 'Date of Birth', { type: 'date', sensitivity: 'SENSITIVE' }),
    field('passport_number', 'Passport Number', { sensitivity: 'RESTRICTED' }),
    MARITAL,
  ],
  groups: [],
  notApplicable: [],
  previewLabels: [],
  otherItem: otherItem('universal'),
};

export const FIXTURE_LOCKED_SECTION: EditorSection = {
  key: 'visa_history',
  label: 'Visa History',
  description: 'Visas you held or were refused.',
  layer: 'identity',
  open: false,
  reason: 'locked',
  canClose: false,
  suggested: false,
  detailCount: 2,
  answered: 0,
  total: 0,
  singles: [],
  groups: [],
  notApplicable: [],
  previewLabels: ['Visa Country', 'Visa Expiry Date'],
  otherItem: otherItem('universal'),
};

export const FIXTURE_PASSPORT_SECTION: EditorSection = {
  key: 'passport',
  label: 'Passport',
  description: 'Your current passport and any earlier ones.',
  layer: 'travel_documents',
  open: true,
  reason: 'default',
  canClose: false,
  suggested: false,
  detailCount: 1,
  answered: 0,
  total: 1,
  singles: [],
  groups: [
    {
      key: 'historical_passport',
      label: 'Historical / Additional Passport',
      noneDeclared: false,
      fields: [field('historical_passport_number', 'Historical Passport Number')],
    },
  ],
  notApplicable: [],
  previewLabels: [],
  otherItem: otherItem('universal'),
};

export function fixtureView(overrides: Partial<MasterProfileView> = {}): MasterProfileView {
  return {
    percent: 0,
    answered: 0,
    total: 5,
    openSections: 2,
    totalSections: 3,
    layers: [
      {
        key: 'identity',
        label: 'Identity and Civil Status',
        description: 'Names, birth and personal details.',
        sections: [FIXTURE_OPEN_SECTION, FIXTURE_LOCKED_SECTION],
        openCount: 1,
      },
      {
        key: 'travel_documents',
        label: 'Travel Documents',
        description: 'Passports, permits and visas held.',
        sections: [FIXTURE_PASSPORT_SECTION],
        openCount: 1,
      },
    ],
    families: [
      { key: 'visit', label: 'Visit' },
      { key: 'study', label: 'Study' },
    ],
    suggestedFamily: null,
    suggestedLockedCount: 0,
    ...overrides,
  };
}

/** Pick-lists for the agency evidence form, hand-written so the form's tests stay light. */
export const fixtureFieldGroups: readonly ChoiceGroup[] = [
  {
    key: 'universal',
    label: 'Identity and Contact',
    choices: [
      { key: 'passport_number', label: 'Passport Number' },
      { key: 'full_name', label: 'Full Name' },
    ],
  },
  {
    key: 'study',
    label: 'Study',
    choices: [{ key: 'study_institution_name', label: 'Institution Name' }],
  },
];

export const fixtureDocumentGroups: readonly ChoiceGroup[] = [
  {
    key: 'identity_civil',
    label: 'Identity and Civil',
    choices: [{ key: 'PASSPORT', label: 'Passport' }],
  },
  {
    key: 'financial',
    label: 'Financial',
    choices: [{ key: 'BANK_STATEMENT', label: 'Bank Statement' }],
  },
  {
    key: 'other_documents',
    label: 'Other Documents',
    choices: [{ key: 'OTHER', label: 'Other Document' }],
  },
];
