import { ProfileEditor } from '../../src/app/app/applicant/[id]/profile-editor';
import { fixtureEssentials, fixtureView } from '../../src/lib/master-profile-fixture';
import type { EditorFieldDef, EditorSection } from '../../src/lib/master-profile-types';

/**
 * WAL4: My Profile's real editor with the Passport Page Card and the value rows, on the real
 * stylesheet. The layout mirrors the live catalogue: seven identity details and the contact details
 * in Identity, four passport details in Travel Documents. Every value is made up. Used by
 * e2e/wallet/u4-profile.spec.ts (server actions are stand-ins that change nothing).
 */
export interface Wal4FixtureProps {
  /** Which values the profile holds. */
  readonly values?: 'full' | 'empty' | 'locked';
  /** Start on Essentials First instead of every section. */
  readonly essentials?: boolean;
}

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
): EditorSection => ({
  key,
  label,
  description: `${label} details.`,
  layer,
  open: true,
  reason: 'default',
  canClose: false,
  suggested: false,
  detailCount: singles.length,
  answered: 0,
  total: singles.length,
  singles,
  groups: [],
  notApplicable: [],
  previewLabels: [],
  otherItem: {
    pack: 'universal',
    sectionFieldKey: 'other_item_universal_section',
    fields: [field('other_item_universal_title', 'What It Is')],
  },
});

const LONG_PLACE =
  'Example Town Upon The Long River In The Very Long Made Up District Of Somewhere Far Away';

const FULL = {
  given_name: { factId: 'f1', value: 'EXAMPLE', status: 'DOCUMENT_SUPPORTED' },
  family_name: {
    factId: 'f2',
    value: 'SAMPLEWITHAVERYLONGFAMILYNAMETHATDOESNOTBREAK',
    status: 'DECLARED',
  },
  date_of_birth: { factId: 'f3', value: '1990-04-12', status: 'APPLICANT_CONFIRMED' },
  nationality: { factId: 'f4', value: 'Testland', status: 'DECLARED' },
  marital_status: { factId: 'f5', value: 'Single', status: 'EXTRACTED_PENDING' },
  sex: { factId: 'f6', value: 'Unspecified', status: 'DECLARED' },
  place_of_birth: { factId: 'f7', value: LONG_PLACE, status: 'CONFLICTED' },
  passport_number: { factId: 'f8', value: 'X1234567', status: 'DOCUMENT_SUPPORTED' },
  passport_issuing_country: { factId: 'f9', value: 'Testland', status: 'DECLARED' },
  passport_issue_date: { factId: 'f10', value: '2020-01-15', status: 'DECLARED' },
  passport_expiry: { factId: 'f11', value: '2030-01-14', status: 'STALE' },
  email: { factId: 'f12', value: 'person@example.test', status: 'DECLARED' },
};

const LOCKED = {
  ...FULL,
  date_of_birth: { factId: 'f3', value: null, status: 'APPLICANT_CONFIRMED', locked: 'no_key' },
  passport_number: { factId: 'f8', value: null, status: 'DECLARED', locked: 'unreadable' },
} as const;

export default function Wal4ProfileFixture({
  values = 'full',
  essentials = false,
}: Wal4FixtureProps) {
  const view = fixtureView({
    ...(essentials ? { essentials: fixtureEssentials() } : {}),
    layers: [
      {
        key: 'identity',
        label: 'Identity and Civil Status',
        description: 'Names, birth and personal details.',
        openCount: 1,
        sections: [
          section('identity_basics', 'identity', 'Identity Basics', [
            field('given_name', 'Given Name'),
            field('family_name', 'Family Name'),
            field('date_of_birth', 'Date of Birth', { type: 'date', sensitivity: 'SENSITIVE' }),
            field('nationality', 'Nationality'),
            field('marital_status', 'Marital Status', { options: ['Single', 'Married', 'Other'] }),
            field('sex', 'Sex', { options: ['Female', 'Male', 'Unspecified'] }),
            field('place_of_birth', 'Place of Birth'),
            field('email', 'Email Address'),
            field('phone', 'Phone Number'),
          ]),
        ],
      },
      {
        key: 'travel_documents',
        label: 'Travel Documents',
        description: 'Passports, permits and visas held.',
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
  return (
    <ProfileEditor
      applicantId="synthetic-person"
      values={values === 'empty' ? {} : values === 'locked' ? LOCKED : FULL}
      repeatingValues={{}}
      assurance={new Map()}
      view={view}
      startWithAll={!essentials}
    />
  );
}
