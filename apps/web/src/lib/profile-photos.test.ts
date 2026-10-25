import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceAccess, workspaceNavigation } from './workspace-navigation';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listApplicantPhotoVersions: vi.fn(),
  listApplicants: vi.fn(),
}));
vi.mock('@visastack/adapters', () => ({ SharpPhotoReencoder: class {} }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: Symbol('each'),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  applicantPhotoPath: (id: string, version: string) => `/api/photos/applicant/${id}?v=${version}`,
  listApplicantPhotoVersions: mocks.listApplicantPhotoVersions,
  listApplicants: mocks.listApplicants,
  requireAccess: mocks.requireAccess,
}));
vi.mock('./providers', () => ({ createMalwareScanner: () => ({}) }));
vi.mock('./storage', () => ({ createStorage: () => ({}) }));

const { loadOwnPhoto, loadOwnedTravellers, ownedPhotoUrl, photoAccess } = await import(
  './profile-photos'
);

const DB = {} as never;
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';
const SELF = { id: P1, displayName: 'Rahima Akter', relationship: 'SELF' };
const FAMILY = { id: P2, displayName: 'Family Member', relationship: 'FAMILY_MEMBER' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.requireAccess.mockImplementation(async (_db, _principal, _action, ref) => ({
    ok: true,
    value: { proofFor: ref.applicantId },
  }));
  mocks.listApplicants.mockResolvedValue([SELF, FAMILY]);
  mocks.listApplicantPhotoVersions.mockResolvedValue({ ok: true, value: new Map([[P1, 'abcd']]) });
});

describe('profile photo loading for pages', () => {
  it('asks the gate about each owned traveller, then reads every photo version in one batched call', async () => {
    const { people, photos } = await loadOwnedTravellers(DB, 'acct-1');
    expect(people).toEqual([SELF, FAMILY]);
    expect([...photos]).toEqual([[P1, `/api/photos/applicant/${P1}?v=abcd`]]);
    expect(mocks.requireAccess.mock.calls.map((call) => call.slice(1, 4))).toEqual([
      [{ kind: 'account', accountId: 'acct-1' }, 'VIEW_METADATA', { applicantId: P1 }],
      [{ kind: 'account', accountId: 'acct-1' }, 'VIEW_METADATA', { applicantId: P2 }],
    ]);
    expect(mocks.listApplicantPhotoVersions).toHaveBeenCalledTimes(1);
    expect(mocks.listApplicantPhotoVersions).toHaveBeenCalledWith(
      { proofFor: P1 },
      { proofFor: P2 },
    );
  });

  it('passes only approved records to the batched read, and reads nothing when none is approved', async () => {
    mocks.requireAccess.mockImplementation(async (_db, _principal, _action, ref) =>
      ref.applicantId === P2
        ? { ok: false, error: { code: 'forbidden' } }
        : { ok: true, value: { proofFor: ref.applicantId } },
    );
    await loadOwnedTravellers(DB, 'acct-1');
    expect(mocks.listApplicantPhotoVersions).toHaveBeenCalledWith({ proofFor: P1 });
    mocks.listApplicantPhotoVersions.mockClear();
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await photoAccess(DB, 'acct-2', P1, 'MANAGE')).toBeNull();
    expect((await loadOwnedTravellers(DB, 'acct-2')).photos.size).toBe(0);
    expect(mocks.listApplicantPhotoVersions).not.toHaveBeenCalled();
  });

  it('shows initials instead of failing the page when photos cannot be read', async () => {
    mocks.listApplicantPhotoVersions.mockRejectedValue(new Error('connection lost'));
    const { people, photos } = await loadOwnedTravellers(DB, 'acct-1');
    expect(people).toHaveLength(2);
    expect(photos.size).toBe(0);
    expect(await ownedPhotoUrl(DB, 'acct-1', P1)).toBeNull();
    mocks.listApplicants.mockRejectedValue(new Error('down'));
    expect(await ownedPhotoUrl(DB, 'acct-1', P1)).toBeNull();
  });

  it('finds the own traveller record of the signed-in person for the account page, and leaves the card out on failure', async () => {
    expect(await loadOwnPhoto(DB, 'acct-1')).toEqual({
      self: { id: P1, name: 'Rahima Akter', photoUrl: `/api/photos/applicant/${P1}?v=abcd` },
    });
    mocks.listApplicants.mockResolvedValue([FAMILY]);
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
