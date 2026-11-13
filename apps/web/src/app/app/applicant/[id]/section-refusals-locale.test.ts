import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The profile section and detail refusals in the visitor's language: each service refusal shown on
 * the profile goes through the services message list (checked Bangla where the register has it,
 * the exact English otherwise). Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({
  listMissions: vi.fn(),
  setSectionOpen: vi.fn(),
  setExemption: vi.fn(),
  editFact: vi.fn(),
  requireAccess: vi.fn(),
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
  registerFieldDefinition: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-test' }),
}));
vi.mock('./actions', () => ({}));

const {
  openSuggestedSectionsAction,
  saveOtherItemAction,
  setExemptionAction,
  setSectionOpenAction,
} = await import('./section-actions');

const BENGALI = /[ঀ-৿]/;
const initial = { ok: true, message: '' };
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

interface Row {
  readonly name: string;
  readonly key: ServiceMessageKey;
  readonly run: (error: ReturnType<typeof keyedError>) => Promise<{ ok: boolean; message: string }>;
}

const ROWS: readonly Row[] = [
  {
    name: 'close an always-open section',
    key: 'profile_sections.this_section_is_always_open',
    run: (error) => {
      mocks.setSectionOpen.mockResolvedValue({ ok: false, error });
      return setSectionOpenAction(
        initial,
        form({ applicantId: 'a1', sectionKey: 'identity_basics', open: 'false' }),
      );
    },
  },
  {
    name: 'open the suggested sections',
    key: 'profile.applicant_not_found',
    run: (error) => {
      mocks.setSectionOpen.mockResolvedValue({ ok: false, error });
      return openSuggestedSectionsAction(initial, form({ applicantId: 'a1', family: 'study' }));
    },
  },
  {
    name: 'does not apply',
    key: 'profile.applicant_not_found',
    run: (error) => {
      mocks.setExemption.mockResolvedValue({ ok: false, error });
      return setExemptionAction(
        initial,
        form({
          applicantId: 'a1',
          kind: 'RECORD_NONE',
          targetKey: 'historical_passport',
          on: 'true',
        }),
      );
    },
  },
  ...(
    [
      'profile.core_processing_consent_is_required',
      'profile.enter_a_real_date',
      'profile.applicant_not_found',
    ] as const
  ).map(
    (key): Row => ({
      name: `save a something-else item: ${key}`,
      key,
      run: (error) => {
        mocks.editFact.mockResolvedValue({ ok: false, error });
        return saveOtherItemAction(
          initial,
          form({
            applicantId: 'a1',
            sectionKey: 'identity_basics',
            title: 'Village certificate',
            details: 'No. 77',
            date: '2020-05-01',
            note: '',
          }),
        );
      },
    }),
  ),
];

beforeEach(() => {
  vi.clearAllMocks();
  loc.locale = 'en';
  mocks.listMissions.mockResolvedValue({ ok: true, value: [] });
  mocks.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' } },
  });
});

describe('profile section refusals in the visitor language', () => {
  it.each(ROWS)('en: $name shows the exact English', async (row) => {
    const error = keyedError('invalid', row.key);
    expect(await row.run(error)).toEqual({ ok: false, message: error.message });
  });

  it.each(ROWS)(
    'bn: $name shows the checked Bangla, or the English when there is none',
    async (row) => {
      loc.locale = 'bn';
      const error = keyedError('invalid', row.key);
      const own = bn[row.key];
      if (own !== undefined) expect(own).toMatch(BENGALI);
      expect(await row.run(error)).toEqual({ ok: false, message: own ?? error.message });
    },
  );
});
