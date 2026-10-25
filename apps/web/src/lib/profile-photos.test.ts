import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceAccess, workspaceNavigation } from './workspace-navigation';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getApplicantPhotoVersion: vi.fn(),
  listApplicants: vi.fn(),
}));
vi.mock('@visastack/adapters', () => ({ SharpPhotoReencoder: class {} }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: Symbol('each'),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  applicantPhotoPath: (id: string, version: string) => `/api/photos/applicant/${id}?v=${version}`,
  getApplicantPhotoVersion: mocks.getApplicantPhotoVersion,
  listApplicants: mocks.listApplicants,
  requireAccess: mocks.requireAccess,
}));
vi.mock('./providers', () => ({ createMalwareScanner: () => ({}) }));
vi.mock('./storage', () => ({ createStorage: () => ({}) }));

const { displayPhotoUrl, loadOwnPhoto, photoAccess } = await import('./profile-photos');

const DB = {} as never;
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('profile photo loading for pages', () => {
  it('asks the gate for this person and record, and gives a versioned address only when there is a photo', async () => {
    const proof = { proof: true };
    mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
    mocks.getApplicantPhotoVersion.mockResolvedValue({ ok: true, value: 'abcd' });
    expect(await displayPhotoUrl(DB, 'acct-1', P1)).toBe(`/api/photos/applicant/${P1}?v=abcd`);
    expect(mocks.requireAccess.mock.calls[0]?.slice(1, 4)).toEqual([
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { applicantId: P1 },
    ]);
    expect(mocks.getApplicantPhotoVersion).toHaveBeenCalledWith(proof);
    mocks.getApplicantPhotoVersion.mockResolvedValue({ ok: true, value: null });
    expect(await displayPhotoUrl(DB, 'acct-1', P1)).toBeNull();
    mocks.getApplicantPhotoVersion.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await displayPhotoUrl(DB, 'acct-1', P1)).toBeNull();
  });

  it('shows no photo, and reads nothing further, when the gate refuses', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await photoAccess(DB, 'acct-2', P1, 'MANAGE')).toBeNull();
    expect(await displayPhotoUrl(DB, 'acct-2', P1)).toBeNull();
    expect(mocks.getApplicantPhotoVersion).not.toHaveBeenCalled();
  });

  it('shows initials instead of failing the page when the photo cannot be read', async () => {
    mocks.requireAccess.mockRejectedValue(new Error('relation "applicant_photos" does not exist'));
    expect(await displayPhotoUrl(DB, 'acct-1', P1)).toBeNull();
  });

  it('finds the own traveller record of the signed-in person for the account page, and leaves the card out on failure', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: {} });
    mocks.getApplicantPhotoVersion.mockResolvedValue({ ok: true, value: 'v1' });
    mocks.listApplicants.mockResolvedValue([
      { id: P2, displayName: 'Family Member', relationship: 'FAMILY_MEMBER' },
      { id: P1, displayName: 'Rahima Akter', relationship: 'SELF' },
    ]);
    expect(await loadOwnPhoto(DB, 'acct-1')).toEqual({
      self: { id: P1, name: 'Rahima Akter', photoUrl: `/api/photos/applicant/${P1}?v=v1` },
    });
    mocks.listApplicants.mockResolvedValue([
      { id: P2, displayName: 'Family Member', relationship: 'FAMILY_MEMBER' },
    ]);
    expect(await loadOwnPhoto(DB, 'acct-1')).toEqual({ self: null });
    mocks.listApplicants.mockRejectedValue(new Error('down'));
    expect(await loadOwnPhoto(DB, 'acct-1')).toBeNull();
  });
});

describe('the workspace avatar photo', () => {
  const access: WorkspaceAccess = {
    travellers: [
      {
        id: P1,
        name: 'Rahima Akter',
        relationship: 'SELF',
        photo: `/api/photos/applicant/${P1}?v=1`,
      },
      { id: P2, name: 'Family Member', relationship: 'MINOR_GUARDIAN', photo: null },
    ],
    agencies: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Agency', admin: true }],
    platform: null,
  };

  it('follows the traveller being shown, and is absent for one without a photo or outside a personal space', () => {
    expect(workspaceNavigation('/app', access).photo).toBe(`/api/photos/applicant/${P1}?v=1`);
    expect(workspaceNavigation(`/app/applicant/${P1}/profile`, access).photo).toBe(
      `/api/photos/applicant/${P1}?v=1`,
    );
    expect(workspaceNavigation(`/app/applicant/${P2}`, access).photo).toBeUndefined();
    expect(
      workspaceNavigation('/app/agency/20000000-0000-4000-8000-000000000001', access).photo,
    ).toBeUndefined();
  });
});
