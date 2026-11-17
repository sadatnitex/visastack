import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WALD2: the profile page opens protected values with the key only for the person who owns the
 * record. Another signed-in account gets Not Found, and the keyed read never happens, so no
 * decrypted value is produced for it. Synthetic values only.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  createKeyManagementPort: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listApplicantProfile: mocks.listApplicantProfile,
}));
vi.mock('../../../../../lib/providers', () => ({
  createKeyManagementPort: mocks.createKeyManagementPort,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (c: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'stranger-account' }),
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
