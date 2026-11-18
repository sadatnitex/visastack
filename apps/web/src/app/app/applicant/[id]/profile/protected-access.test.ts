import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WALD2: the profile page opens protected values with the key only for the person who owns the
 * record. Another signed-in account gets Not Found, and the keyed read never happens, so no
 * decrypted value is produced for it. For the owner it reads once with the key, to tell a value
 * that opens from one that would not or was lost.
 *
 * ESS1: a protected value that opened is still left out of the page: the editor gets
 * `withheld: true` and no value, and the page's server markup holds none. Show or Edit opens it
 * through the owner-only reveal action (profile-reveal-actions.test.ts). Synthetic values.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  createKeyManagementPort: vi.fn(),
  reportServerError: vi.fn(),
  requireAccess: vi.fn(),
  listPendingAppSuggestions: vi.fn(),
  accountId: 'stranger-account',
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listApplicantProfile: mocks.listApplicantProfile,
  hasConsent: async () => true,
  listApplicantAssurance: async () => ({ ok: true, value: [] }),
  getProfileSectionState: async () => ({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  }),
  getWalletView: async () => ({ ok: true, value: [] }),
  listDocumentsDetailed: async () => ({ ok: true, value: [] }),
  requireAccess: mocks.requireAccess,
  listPendingAppSuggestions: mocks.listPendingAppSuggestions,
  aiSuggestionsInUse: async () => true,
  listEndedRecords: async () => new Map(),
  listMissions: async () => ({ ok: true, value: [] }),
}));
vi.mock('../../../../../lib/profile-photos', () => ({ ownedPhotoUrl: async () => null }));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'browse' }));
vi.mock('../../../../../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));
vi.mock('../../../../../lib/providers', () => ({
  createKeyManagementPort: mocks.createKeyManagementPort,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (c: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: mocks.accountId }),
}));
vi.mock('../../../../../lib/i18n-server', () => ({
  primeLocale: async () => 'en',
  getServerT: () => Object.assign((key: string) => key, { node: (key: string) => key }),
}));
vi.mock('../actions', () => ({
  saveFactAction: vi.fn(),
  decideProposalAction: vi.fn(),
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
vi.mock('../section-actions', () => ({
  markEndedAction: vi.fn(),
  markNotCurrentAction: vi.fn(),
  openSuggestedSectionsAction: vi.fn(),
  saveOtherItemAction: vi.fn(),
  setExemptionAction: vi.fn(),
  setSectionOpenAction: vi.fn(),
}));
vi.mock('../profile-reveal-actions', () => ({ revealProfileValueAction: vi.fn() }));
vi.mock('../../../../../components/profile-photo/profile-photo-control', () => ({
  ProfilePhotoControl: () => null,
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

const { default: ApplicantProfilePage } = await import('./page');
const { renderServer, textOf } = await import('../../../../../lib/next-mocks.test-support');

describe('profile page keyed read', () => {
  beforeEach(() => {
    mocks.accountId = 'stranger-account';
    mocks.reportServerError.mockReset();
    mocks.requireAccess.mockReset();
    mocks.requireAccess.mockResolvedValue({ ok: false });
    mocks.getApplicant.mockReset();
    mocks.listApplicantProfile.mockReset();
    mocks.createKeyManagementPort.mockReset();
  });

  it('another account gets Not Found and nothing is opened with the key', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'person-1', ownerAccountId: 'owner-account' });
    await expect(
      ApplicantProfilePage({ params: Promise.resolve({ id: 'person-1' }) }),
    ).rejects.toThrow('NOT_FOUND');
    expect(mocks.createKeyManagementPort).not.toHaveBeenCalled();
    expect(mocks.listApplicantProfile).not.toHaveBeenCalled();
  });

  it('a missing record gets Not Found and nothing is opened with the key', async () => {
    mocks.getApplicant.mockResolvedValue(undefined);
    await expect(
      ApplicantProfilePage({ params: Promise.resolve({ id: 'person-2' }) }),
    ).rejects.toThrow('NOT_FOUND');
    expect(mocks.createKeyManagementPort).not.toHaveBeenCalled();
    expect(mocks.listApplicantProfile).not.toHaveBeenCalled();
  });
});

const KEY = { name: 'synthetic-key-port' };

function entry(fieldKey: string, value: string | null, isProtected: boolean) {
  return {
    factId: `fact-${fieldKey}`,
    fieldKey,
    repeatingRecordKey: null,
    value,
    status: 'APPLICANT_CONFIRMED',
    method: 'MANUAL',
    updatedAt: '2026-11-01T00:00:00.000Z',
    effectiveFrom: null,
    isProtected,
    sourceDocumentId: null,
  };
}

type Element = { type?: unknown; props?: Record<string, unknown> };

/** The props the page hands the profile editor, found in the returned element tree. */
function editorProps(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = editorProps(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const element = node as Element;
  const name = (element.type as { name?: string } | undefined)?.name;
  if (name === 'ProfileEditor') return element.props;
  for (const value of Object.values(element.props ?? {})) {
    const found = editorProps(value);
    if (found) return found;
  }
  return undefined;
}

describe('profile page keyed read for the owner', () => {
  beforeEach(() => {
    mocks.accountId = 'owner-account';
    mocks.reportServerError.mockReset();
    mocks.requireAccess.mockReset();
    mocks.requireAccess.mockResolvedValue({ ok: false });
    mocks.listPendingAppSuggestions.mockReset();
    mocks.listPendingAppSuggestions.mockResolvedValue([]);
    mocks.getApplicant.mockReset();
    mocks.listApplicantProfile.mockReset();
    mocks.createKeyManagementPort.mockReset();
    mocks.getApplicant.mockResolvedValue({
      id: 'person-1',
      ownerAccountId: 'owner-account',
      displayName: 'Test Traveller',
      relationship: 'SELF',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  async function render() {
    const page = await ApplicantProfilePage({ params: Promise.resolve({ id: 'person-1' }) });
    const props = editorProps(page);
    if (!props) throw new Error('profile editor not rendered');
    return props;
  }

  /** Whether the Essentials list counts a detail as Added. */
  async function essentialAnswered(key: string) {
    const props = (await render()) as {
      view: { essentials: { items: readonly { key: string; answered: boolean }[] } };
    };
    return props.view.essentials.items.find((item) => item.key === key)?.answered;
  }

  async function open() {
    const props = await render();
    type Box = { value: string | null; locked: string | null; status: string | null };
    type Keys = 'date_of_birth' | 'passport_number' | 'given_name';
    return (props as { values: Partial<Record<Keys, Box>> }).values;
  }

  it('reads once with the key and leaves every protected value out of the page (ESS1)', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    // One pending app suggestion, so the comparison with the profile runs too: it must reuse the
    // same keyed read, not open everything a second time.
    mocks.requireAccess.mockImplementation(
      async (
        _db: unknown,
        _who: unknown,
        _action: unknown,
        _on: unknown,
        o: { purpose: string },
      ) => (o.purpose === 'ai_app_suggestions' ? { ok: true, value: {} } : { ok: false }),
    );
    mocks.listPendingAppSuggestions.mockResolvedValue([
      {
        proposal: {
          id: 'proposal-1',
          type: 'FIELD_VALUE',
          fieldKey: 'passport_number',
          value: 'X1234567',
          confidence: 0.9,
          rationale: 'Synthetic.',
        },
        evidence: [],
        fromApp: null,
        issueDate: null,
      },
    ]);
    mocks.listApplicantProfile.mockResolvedValue([
      entry('date_of_birth', '1990-04-12', true),
      entry('passport_number', 'X1234567', true),
    ]);
    const values = await open();
    expect(mocks.listApplicantProfile).toHaveBeenCalledTimes(1);
    expect(mocks.listApplicantProfile).toHaveBeenCalledWith({}, 'person-1', KEY);
    expect(values.date_of_birth).toEqual(
      expect.objectContaining({ value: null, locked: null, withheld: true }),
    );
    expect(values.passport_number).toEqual(
      expect.objectContaining({ value: null, locked: null, withheld: true }),
    );
    expect(mocks.listPendingAppSuggestions).toHaveBeenCalledTimes(1);
  });

  it('with no key, hands an empty box marked Saved and Protected, never the stand-in', async () => {
    mocks.createKeyManagementPort.mockReturnValue(undefined);
    mocks.listApplicantProfile.mockResolvedValue([entry('passport_number', '[protected]', true)]);
    const values = await open();
    expect(values.passport_number).toMatchObject({ value: null, locked: 'no_key' });
  });

  it('with the key, tells a value that would not open from one that was lost', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    mocks.listApplicantProfile.mockResolvedValue([
      entry('date_of_birth', '[protected: could not decrypt]', true),
      entry('passport_number', '[protected]', true),
    ]);
    const values = await open();
    expect(values.date_of_birth).toMatchObject({ value: null, locked: 'unreadable' });
    expect(values.passport_number).toMatchObject({ value: null, locked: 'lost', status: null });
    // The Essentials list agrees with the boxes: a lost value is not Added, an unopened one is.
    expect(await essentialAnswered('passport_number')).toBe(false);
    expect(await essentialAnswered('date_of_birth')).toBe(true);
  });

  it('an unknown key setting still opens the page, with protected values marked', async () => {
    mocks.createKeyManagementPort.mockImplementation(() => {
      throw new Error('unknown KMS_PROVIDER');
    });
    mocks.listApplicantProfile.mockResolvedValue([entry('passport_number', '[protected]', true)]);
    const values = await open();
    expect(values.passport_number).toMatchObject({ value: null, locked: 'no_key' });
    expect(mocks.reportServerError).toHaveBeenCalledTimes(1);
  });

  it('puts no protected value in the editor props or the server markup before Show (ESS1)', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    mocks.listApplicantProfile.mockResolvedValue([
      entry('date_of_birth', '1990-04-12', true),
      entry('passport_number', 'X1234567', true),
      // Saved before encryption, but the catalogue marks it protected: left out all the same.
      entry('annual_income', 'BDT 987654', false),
      entry('given_name', 'Alex', false),
    ]);
    const page = await ApplicantProfilePage({ params: Promise.resolve({ id: 'person-1' }) });
    const props = JSON.stringify(editorProps(page), (_key, value) =>
      value instanceof Map ? [...value] : value,
    );
    const html = await renderServer(page);
    for (const secret of ['1990-04-12', '12 Apr 1990', 'X1234567', 'BDT 987654']) {
      expect(props, secret).not.toContain(secret);
      expect(html, secret).not.toContain(secret);
    }
    expect(textOf(html)).toContain('Alex');
    expect(html.toLowerCase()).not.toContain('[protected');
    // The count of essentials still counts them as added.
    expect(await essentialAnswered('date_of_birth')).toBe(true);
    expect(await essentialAnswered('passport_number')).toBe(true);
  });

  it('counts exactly as before: the view built from the same keyed read (ESS1 parity)', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    const profile = [
      entry('date_of_birth', '1990-04-12', true),
      entry('passport_number', 'X1234567', true),
      entry('given_name', 'Alex', false),
    ];
    mocks.listApplicantProfile.mockResolvedValue(profile);
    const props = (await render()) as { view: unknown };
    const { buildMasterProfileView } = await import('../../../../../lib/master-profile');
    // The same call the page made before ESS1: withholding a value changes no count.
    expect(props.view).toEqual(
      buildMasterProfileView({
        entries: profile,
        activated: new Set(),
        notApplicable: new Set(),
        noneDeclared: new Set(),
        suggestFor: null,
        uploadedDocumentTypes: new Map(),
        caseCountries: new Set(),
      }),
    );
  });

  it('leaves an ordinary detail as it is', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    mocks.listApplicantProfile.mockResolvedValue([entry('given_name', 'Alex', false)]);
    const values = await open();
    expect(values.given_name).toMatchObject({ value: 'Alex', locked: null });
  });
});
