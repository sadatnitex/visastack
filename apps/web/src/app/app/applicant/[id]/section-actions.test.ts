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
  isAllowedEndDate: (date: Date) => date.getTime() < Date.parse('2900-01-01'),
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

const { PROFILE_HIDDEN_LINE } = await import('../../../../lib/hidden-record');
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
  // The ownership check ('self') sees the owner; the edit gate for the two lifecycle marks sees its proof.
  mocks.requireAccess.mockImplementation(async (_db, _who, _action, _ref, options) =>
    options.purpose === 'self'
      ? { ok: true, value: { actor: { kind: 'applicant_owner' } } }
      : { ok: true, value: { proof: 'owner-edit' } },
  );
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

  it('answers a stranger exactly as it answers a made-up record (no way to tell them apart)', async () => {
    const answers: unknown[] = [];
    for (const error of [
      { code: 'forbidden', message: 'access denied (default_deny)' },
      { code: 'not_found', message: 'record not found' },
    ]) {
      mocks.requireAccess.mockResolvedValue({ ok: false, error });
      answers.push(
        await markNotCurrentAction(initial, form({ applicantId: 'a1', factId: 'f1' })),
        await markEndedAction(
          initial,
          form({
            applicantId: 'a1',
            recordGroupKey: 'g',
            repeatingRecordKey: 'r1',
            endedOn: '2025-06-30',
          }),
        ),
      );
    }
    // Forbidden and not found give the same word for the same action.
    expect(answers[0]).toEqual(answers[2]);
    expect(answers[1]).toEqual(answers[3]);
    expect(answers[0]).toEqual({
      ok: false,
      message: 'This detail could not be found. Reload the page and try again.',
    });
    expect(answers[1]).toEqual({
      ok: false,
      message: 'This entry could not be found. Reload the page and try again.',
    });
    expect(mocks.markFactNotCurrent).not.toHaveBeenCalled();
    expect(mocks.markRecordEnded).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('still says plainly what went wrong when the owner passed the access check', async () => {
    mocks.markFactNotCurrent.mockResolvedValue({
      ok: false,
      error: { code: 'consent_required', message: 'consent' },
    });
    const result = await markNotCurrentAction(initial, form({ applicantId: 'a1', factId: 'f1' }));
    expect(result).toEqual({
      ok: false,
      message: 'Turn on \u201cLet VisaStack Process My Details\u201d on Home first.',
    });
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
    expect(mocks.markRecordEnded).not.toHaveBeenCalled();
  });
});

describe('a stranger cannot tell a real profile from a made-up one', () => {
  const OWN_WORDS = 'The service says this in its own words.';
  interface ProfileAction {
    readonly name: string;
    readonly run: () => Promise<unknown>;
    readonly untouched: () => ReadonlyArray<ReturnType<typeof vi.fn>>;
    readonly first: () => ReturnType<typeof vi.fn>;
  }
  const actions: readonly ProfileAction[] = [
    {
      name: 'setSectionOpenAction',
      run: () =>
        setSectionOpenAction(
          initial,
          form({ applicantId: 'a1', sectionKey: 'visa_history', open: 'true' }),
        ),
      untouched: () => [mocks.setSectionOpen],
      first: () => mocks.setSectionOpen,
    },
    {
      name: 'openSuggestedSectionsAction',
      run: () => openSuggestedSectionsAction(initial, form({ applicantId: 'a1', family: 'study' })),
      untouched: () => [mocks.listMissions, mocks.setSectionOpen],
      first: () => mocks.setSectionOpen,
    },
    {
      name: 'setExemptionAction',
      run: () =>
        setExemptionAction(
          initial,
          form({
            applicantId: 'a1',
            kind: 'RECORD_NONE',
            targetKey: 'historical_passport',
            on: 'true',
          }),
        ),
      untouched: () => [mocks.setExemption],
      first: () => mocks.setExemption,
    },
    {
      name: 'saveOtherItemAction',
      run: () =>
        saveOtherItemAction(
          initial,
          form({ applicantId: 'a1', sectionKey: 'identity_basics', title: 'Village certificate' }),
        ),
      untouched: () => [mocks.editFact, mocks.registerFieldDefinition],
      first: () => mocks.editFact,
    },
  ];
  const refusals = [
    {
      gate: { code: 'forbidden', message: 'access denied (default_deny)' },
      service: {
        code: 'forbidden',
        message: 'not authorized to change this profile (default_deny)',
      },
    },
    {
      gate: { code: 'not_found', message: 'record not found' },
      service: { code: 'not_found', message: 'applicant not found' },
    },
  ] as const;

  describe.each(actions)('$name', (action) => {
    it('gives one identical, fixed answer for a real profile that is not theirs and a made-up one, and changes nothing', async () => {
      const answers: unknown[] = [];
      for (const refusal of refusals) {
        vi.clearAllMocks();
        mocks.requireAccess.mockResolvedValue({ ok: false, error: refusal.gate });
        for (const service of [mocks.setSectionOpen, mocks.setExemption, mocks.editFact]) {
          service.mockResolvedValue({ ok: false, error: refusal.service });
        }
        mocks.listMissions.mockResolvedValue({ ok: false, error: refusal.service });
        answers.push(await action.run());
        for (const untouched of action.untouched()) expect(untouched).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      }
      expect(answers[0]).toEqual(answers[1]);
      expect(answers[0]).toEqual({ ok: false, message: PROFILE_HIDDEN_LINE });
    });

    it('gives the fixed answer to someone who sees the profile only through a share', async () => {
      mocks.requireAccess.mockResolvedValue({
        ok: true,
        value: { actor: { kind: 'organization_member' } },
      });
      expect(await action.run()).toEqual({ ok: false, message: PROFILE_HIDDEN_LINE });
      for (const untouched of action.untouched()) expect(untouched).not.toHaveBeenCalled();
    });

    it('serves the real owner as before: the work runs and the service speaks in its own words', async () => {
      action
        .first()
        .mockResolvedValue({ ok: false, error: { code: 'invalid', message: OWN_WORDS } });
      const answer = await action.run();
      expect(answer).toMatchObject({ ok: false, message: OWN_WORDS });
      expect(action.first()).toHaveBeenCalled();
    });
  });
});
