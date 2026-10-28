import { vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** My Profile (screen 04): see parity-kit.test-support.ts for how the comparison works. */

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  getProfileSectionState: vi.fn(),
  getWalletView: vi.fn(),
  hasConsent: vi.fn(),
  listApplicantAssurance: vi.fn(),
  listApplicantProfile: vi.fn(),
  listDocumentsDetailed: vi.fn(),
}));
const depth = vi.hoisted(() => ({ level: 'auto' }));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../profile-photos', () => ({ ownedPhotoUrl: () => null }));
vi.mock('./depth.server', () => ({ readDepth: async () => depth.level }));
vi.mock('../../app/app/applicant/[id]/profile-editor', () => ({
  ProfileEditor: () => <div id="profile-editor">Versioned editor</div>,
}));
vi.mock('../../components/profile-photo/profile-photo-control', () => ({
  ProfilePhotoControl: () => <div>Photo control</div>,
}));

const { default: ProfilePage } = await import('../../app/app/applicant/[id]/profile/page');

const fact = (fieldKey: string, status: string, value = 'Synthetic') => ({
  factId: `f-${fieldKey}`,
  fieldKey,
  repeatingRecordKey: null,
  value,
  status,
  updatedAt: '2026-10-10T12:00:00Z',
  method: 'MANUAL',
});

registerParity({
  name: 'profile',
  reset: () => {
    vi.resetAllMocks();
    depth.level = 'auto';
    service.getApplicant.mockResolvedValue({
      id: 'person',
      displayName: 'Karim Hossain',
      relationship: 'SELF',
      ownerAccountId: 'owner',
      createdAt: new Date('2026-01-01'),
    });
    service.getProfileSectionState.mockResolvedValue({
      activated: new Set(),
      notApplicable: new Set(),
      noneDeclared: new Set(),
    });
    service.getWalletView.mockResolvedValue({ ok: true, value: [] });
    service.hasConsent.mockResolvedValue(true);
    service.listApplicantAssurance.mockResolvedValue({ ok: true, value: [] });
    service.listApplicantProfile.mockResolvedValue([]);
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  },
  render: async () =>
    await renderServer(
      ProfilePage({
        params: Promise.resolve({ id: 'person' }),
        searchParams: Promise.resolve({}),
      } as never),
    ),
  states: [
    { name: 'a new profile', setup: () => undefined },
    {
      name: 'core processing off',
      setup: () => service.hasConsent.mockResolvedValue(false),
    },
    {
      name: 'confirmed, supported and conflicting details',
      setup: () => {
        service.listApplicantProfile.mockResolvedValue([
          fact('given_name', 'CONFLICTED'),
          fact('family_name', 'APPLICANT_CONFIRMED', 'Hossain'),
          fact('nationality', 'DOCUMENT_SUPPORTED', 'Bangladeshi'),
        ]);
      },
    },
  ],
});
