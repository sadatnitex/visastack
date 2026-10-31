import { CATALOGUE_MODULES } from '@visastack/core/catalogue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { casePurposeGroups } from '../../../../lib/case-choices';

const mocks = vi.hoisted(() => ({
  listMissions: vi.fn(),
  setSectionOpen: vi.fn(),
  setExemption: vi.fn(),
  editFact: vi.fn(),
  registerFieldDefinition: vi.fn(),
  requireAccess: vi.fn(),
  markFactNotCurrent: vi.fn(),
  markRecordEnded: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  listMissions: mocks.listMissions,
  setSectionOpen: mocks.setSectionOpen,
  setExemption: mocks.setExemption,
  editFact: mocks.editFact,
  registerFieldDefinition: mocks.registerFieldDefinition,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  markFactNotCurrent: mocks.markFactNotCurrent,
  markRecordEnded: mocks.markRecordEnded,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-test' }),
}));
vi.mock('./actions', () => ({}));

const {
  markEndedAction,
  markNotCurrentAction,
  openSuggestedSectionsAction,
  saveOtherItemAction,
  setExemptionAction,
  setSectionOpenAction,
} = await import('./section-actions');

const initial = { ok: true, message: '' };
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const ok = { ok: true, value: {} };
const nextRecord = () => mocks.editFact.mock.calls.map((call) => call[1].repeatingRecordKey);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMissions.mockResolvedValue({ ok: true, value: [] });
  mocks.setSectionOpen.mockResolvedValue(ok);
  mocks.setExemption.mockResolvedValue(ok);
  mocks.editFact.mockResolvedValue(ok);
  mocks.registerFieldDefinition.mockResolvedValue(undefined);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner-edit' } });
  mocks.markFactNotCurrent.mockResolvedValue(ok);
  mocks.markRecordEnded.mockResolvedValue(ok);
});

describe('opening and closing a section', () => {
  it('passes the signed-in owner and the requested state to the service, then refreshes the page', async () => {
    const result = await setSectionOpenAction(
      initial,
      form({ applicantId: 'a1', sectionKey: 'visa_history', open: 'true' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.setSectionOpen).toHaveBeenCalledWith(
      {},
      { actorAccountId: 'owner-test', applicantId: 'a1', sectionKey: 'visa_history', open: true },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1', 'layout');
  });

  it('treats anything but "true" as closing, and shows the service refusal as it is', async () => {
    mocks.setSectionOpen.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'this section is always open and cannot be closed' },
    });
    const result = await setSectionOpenAction(
      initial,
      form({ applicantId: 'a1', sectionKey: 'identity_basics', open: 'false' }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'this section is always open and cannot be closed',
    });
    expect(mocks.setSectionOpen.mock.calls[0]?.[1].open).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('opening the sections a purpose suggests', () => {
  it('rebuilds the list on the server and opens only closed sections that suit the purpose', async () => {
    const expected = CATALOGUE_MODULES.filter(
      (module) =>
        !module.internal &&
        !module.defaultOpen &&
        (module.suggestedFor ?? []).some((family) => family === 'study'),
    ).map((module) => module.key);
    expect(expected.length).toBeGreaterThan(0);
    const result = await openSuggestedSectionsAction(
      initial,
      form({ applicantId: 'a1', family: 'study', sectionKey: 'identity_basics', keys: 'passport' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.setSectionOpen.mock.calls.map((call) => call[1].sectionKey)).toEqual(expected);
    expect(mocks.setSectionOpen.mock.calls.every((call) => call[1].open === true)).toBe(true);
  });

  it('opens only the country sections a study case is about, the same ones the profile shows', async () => {
    const study = casePurposeGroups().find((group) => group.family === 'study')?.options[0];
    if (!study) throw new Error('missing study purpose');
    mocks.listMissions.mockResolvedValue({
      ok: true,
      value: [{ destination: 'Ireland', purpose: study.label }],
    });
    const result = await openSuggestedSectionsAction(
      initial,
      form({ applicantId: 'a1', family: 'study' }),
    );
    expect(result.ok).toBe(true);
    const opened = mocks.setSectionOpen.mock.calls.map((call) => call[1].sectionKey);
    expect(opened).toContain('uk_ireland');
    expect(opened).not.toContain('united_states');
    expect(opened).not.toContain('australia_new_zealand');
  });

  it('refuses a purpose that does not exist and opens nothing', async () => {
    const result = await openSuggestedSectionsAction(
      initial,
      form({ applicantId: 'a1', family: 'not_a_purpose' }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.setSectionOpen).not.toHaveBeenCalled();
  });

  it('stops and reports the first refusal instead of pretending everything opened', async () => {
    mocks.setSectionOpen
      .mockResolvedValueOnce(ok)
      .mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'not allowed' } });
    const result = await openSuggestedSectionsAction(
      initial,
      form({ applicantId: 'a1', family: 'study' }),
    );
    expect(result).toEqual({ ok: false, message: 'not allowed' });
    expect(mocks.setSectionOpen).toHaveBeenCalledTimes(2);
  });
});

describe('does not apply and none', () => {
  it('records either choice through the service', async () => {
    await setExemptionAction(
      initial,
      form({
        applicantId: 'a1',
        kind: 'RECORD_NONE',
        targetKey: 'historical_passport',
        on: 'true',
      }),
    );
    expect(mocks.setExemption).toHaveBeenCalledWith(
      {},
      {
        actorAccountId: 'owner-test',
        applicantId: 'a1',
        kind: 'RECORD_NONE',
        targetKey: 'historical_passport',
        on: true,
      },
    );
  });

  it('refuses a kind it does not know before touching the service', async () => {
    const result = await setExemptionAction(
      initial,
      form({ applicantId: 'a1', kind: 'DROP_TABLE', targetKey: 'x', on: 'true' }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.setExemption).not.toHaveBeenCalled();
  });
});

describe('saving a something-else item', () => {
  const base = {
    applicantId: 'a1',
    sectionKey: 'identity_basics',
    title: 'Village certificate',
    details: 'No. 77',
    date: '2020-05-01',
    note: '',
  };

  it('saves the section, title, details and date as one record under the right pack, and skips empty parts', async () => {
    const result = await saveOtherItemAction(initial, form(base));
    const section = CATALOGUE_MODULES.find((module) => module.key === 'identity_basics');
    // The line says where it went, never the typed values.
    expect(result).toEqual({ ok: true, message: `Saved under ${section?.label}.` });
    expect(result.message).not.toContain('Village certificate');
    const keys = mocks.editFact.mock.calls.map((call) => call[1].fieldKey);
    expect(keys).toEqual([
      'other_item_universal_section',
      'other_item_universal_title',
      'other_item_universal_details',
      'other_item_universal_date',
    ]);
    expect(new Set(nextRecord()).size).toBe(1);
    expect(mocks.editFact.mock.calls[0]?.[1].value).toBe('identity_basics');
    const registered = mocks.registerFieldDefinition.mock.calls.map((call) => call[1]);
    expect(
      registered.every((field) => field.repeating === true && field.packId === 'universal'),
    ).toBe(true);
    expect(registered.find((field) => field.key === 'other_item_universal_date')?.dataType).toBe(
      'date',
    );
  });

  it('files an item in a health section under the health pack so it is protected like one', async () => {
    const health = CATALOGUE_MODULES.find(
      (module) => !module.internal && module.pack === 'medical',
    );
    if (!health) throw new Error('no medical section');
    await saveOtherItemAction(initial, form({ ...base, sectionKey: health.key }));
    expect(mocks.editFact.mock.calls[0]?.[1].fieldKey).toBe('other_item_medical_section');
    expect(mocks.registerFieldDefinition.mock.calls[0]?.[1].packId).toBe('medical');
  });

  it('refuses an unknown or internal section, a missing title, and a bad date, saving nothing', async () => {
    const internal = CATALOGUE_MODULES.find((module) => module.internal)?.key ?? '';
    for (const bad of [
      { ...base, sectionKey: 'no_such_section' },
      { ...base, sectionKey: internal },
      { ...base, title: '  ' },
      { ...base, date: 'not-a-date' },
    ]) {
      const result = await saveOtherItemAction(initial, form(bad));
      expect(result.ok).toBe(false);
    }
    expect(mocks.editFact).not.toHaveBeenCalled();
    expect(mocks.registerFieldDefinition).not.toHaveBeenCalled();
  });

  it('shows the service refusal and does not refresh the page', async () => {
    mocks.editFact.mockResolvedValue({
      ok: false,
      error: { code: 'consent_required', message: 'Consent needed' },
    });
    const result = await saveOtherItemAction(initial, form(base));
    expect(result).toEqual({ ok: false, message: 'Consent needed' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('No Longer Current and Ended (LC-G1)', () => {
  it('checks edit access for the signed-in person, marks that fact, and refreshes', async () => {
    const result = await markNotCurrentAction(initial, form({ applicantId: 'a1', factId: 'f1' }));
    expect(result).toEqual({
      ok: true,
      message: 'Marked as no longer current. The earlier value stays in History.',
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner-test' },
      'APPROVE_EDIT',
      { applicantId: 'a1' },
      { purpose: 'profile_edit' },
    );
    expect(mocks.markFactNotCurrent).toHaveBeenCalledWith(
      { proof: 'owner-edit' },
      { factId: 'f1' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1', 'layout');
  });

  it('stops at the access check and says so in plain words', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'not authorized (default_deny)' },
    });
    const result = await markNotCurrentAction(initial, form({ applicantId: 'a1', factId: 'f1' }));
    expect(result).toEqual({ ok: false, message: 'Only the profile owner can change this.' });
    expect(mocks.markFactNotCurrent).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('ends one entry on the chosen day', async () => {
    const result = await markEndedAction(
      initial,
      form({
        applicantId: 'a1',
        recordGroupKey: 'previous_addresses',
        repeatingRecordKey: 'r1',
        endedOn: '2025-06-30',
      }),
    );
    expect(result).toEqual({ ok: true, message: 'Marked as ended. Its details stay on file.' });
    expect(mocks.markRecordEnded).toHaveBeenCalledWith(
      { proof: 'owner-edit' },
      {
        recordGroupKey: 'previous_addresses',
        repeatingRecordKey: 'r1',
        endedOn: new Date('2025-06-30T00:00:00.000Z'),
      },
    );
  });

  it('asks for the date before calling anything, and names a future date plainly', async () => {
    const missing = await markEndedAction(
      initial,
      form({ applicantId: 'a1', recordGroupKey: 'g', repeatingRecordKey: 'r1', endedOn: '' }),
    );
    expect(missing).toEqual({ ok: false, message: 'Enter the date it ended.', field: 'endedOn' });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    mocks.markRecordEnded.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'the end date cannot be in the future' },
    });
    const future = await markEndedAction(
      initial,
      form({
        applicantId: 'a1',
        recordGroupKey: 'g',
        repeatingRecordKey: 'r1',
        endedOn: '2999-01-01',
      }),
    );
    expect(future).toEqual({
      ok: false,
      message: 'The end date cannot be in the future.',
      field: 'endedOn',
    });
  });
});
