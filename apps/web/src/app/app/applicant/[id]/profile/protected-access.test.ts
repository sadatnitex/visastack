import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WALD2: the profile page opens protected values with the key only for the person who owns the
 * record. Another signed-in account gets Not Found, and the keyed read never happens, so no
 * decrypted value is produced for it. For the owner it reads once with the key and hands each box
 * its real value, or an empty box with the reason when the value was not opened. Synthetic values.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  createKeyManagementPort: vi.fn(),
  reportServerError: vi.fn(),
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
  requireAccess: async () => ({ ok: false }),
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
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

const { default: ApplicantProfilePage } = await import('./page');

describe('profile page keyed read', () => {
  beforeEach(() => {
    mocks.accountId = 'stranger-account';
    mocks.reportServerError.mockReset();
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

  async function open() {
    const page = await ApplicantProfilePage({ params: Promise.resolve({ id: 'person-1' }) });
    const props = editorProps(page);
    if (!props) throw new Error('profile editor not rendered');
    type Box = { value: string | null; locked: string | null; status: string | null };
    type Keys = 'date_of_birth' | 'passport_number' | 'given_name';
    return (props as { values: Partial<Record<Keys, Box>> }).values;
  }

  it('reads once with the key and gives each box its real value', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    mocks.listApplicantProfile.mockResolvedValue([
      entry('date_of_birth', '1990-04-12', true),
      entry('passport_number', 'X1234567', true),
    ]);
    const values = await open();
    expect(mocks.listApplicantProfile).toHaveBeenCalledTimes(1);
    expect(mocks.listApplicantProfile).toHaveBeenCalledWith({}, 'person-1', KEY);
    expect(values.date_of_birth).toMatchObject({ value: '1990-04-12', locked: null });
    expect(values.passport_number).toMatchObject({ value: 'X1234567', locked: null });
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

  it('leaves an ordinary detail as it is', async () => {
    mocks.createKeyManagementPort.mockReturnValue(KEY);
    mocks.listApplicantProfile.mockResolvedValue([entry('given_name', 'Alex', false)]);
    const values = await open();
    expect(values.given_name).toMatchObject({ value: 'Alex', locked: null });
  });
});
