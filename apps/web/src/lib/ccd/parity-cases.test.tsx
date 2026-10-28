import { vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Cases (screen 08): see parity-kit.test-support.ts for how the comparison works. */

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listMissions: vi.fn(),
  hasConsent: vi.fn(),
  computeReadiness: vi.fn(),
}));
const depth = vi.hoisted(() => ({ level: 'auto' }));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => depth.level }));
vi.mock('../../app/app/applicant/[id]/missions/create-mission-form', () => ({
  CreateMissionForm: stub('CreateMissionForm'),
}));

const { default: CasesPage } = await import('../../app/app/applicant/[id]/missions/page');

const mission = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Synthetic ${id}`,
  state,
  packVersionId: null,
  updatedAt: new Date('2026-10-10T00:00:00Z'),
  ...extra,
});

registerParity({
  name: 'cases',
  reset: () => {
    vi.resetAllMocks();
    depth.level = 'auto';
    service.getApplicant.mockResolvedValue({
      id: 'person',
      displayName: 'Karim Hossain',
      ownerAccountId: 'owner',
    });
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    service.hasConsent.mockResolvedValue(true);
    service.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 8, satisfiedRequired: 6 },
    });
  },
  render: async () => await renderServer(CasesPage({ params: Promise.resolve({ id: 'person' }) })),
  states: [
    { name: 'no cases yet', setup: () => undefined },
    {
      name: 'core processing off',
      setup: () => service.hasConsent.mockResolvedValue(false),
    },
    {
      name: 'an active case with a checklist, one without, and a closed one',
      setup: () => {
        service.listMissions.mockResolvedValue({
          ok: true,
          value: [
            mission('japan', 'IN_PROGRESS', {
              packVersionId: 'p1',
              updatedAt: new Date('2026-10-20T00:00:00Z'),
            }),
            mission('korea', 'DRAFT'),
            mission('old', 'CLOSED'),
          ],
        });
      },
    },
    {
      name: 'cases could not be read',
      setup: () =>
        service.listMissions.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } }),
    },
  ],
});
