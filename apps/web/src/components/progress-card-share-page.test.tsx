import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../lib/next-mocks.test-support';

/** WP-PIC15: the Cases page offers the progress card only while the owner's switch is on. */
const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listMissions: vi.fn(),
  hasConsent: vi.fn(),
  computeReadiness: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../app/app/applicant/[id]/missions/create-mission-form', () => ({
  CreateMissionForm: stub('CreateMissionForm'),
}));
vi.mock('./progress-card-share', () => ({
  ProgressCardShare: ({ missionId }: { missionId: string }) => (
    <span data-progress-card={missionId} />
  ),
}));

const { default: CasesPage } = await import('../app/app/applicant/[id]/missions/page');
const render = async () =>
  new JSDOM(await renderServer(CasesPage({ params: Promise.resolve({ id: 'person' }) }))).window
    .document;

const CASE = {
  id: 'c1',
  title: 'Japan Visit',
  destination: 'Japan',
  purpose: null,
  state: 'IN_PROGRESS',
  packVersionId: 'pv1',
  updatedAt: new Date(),
};
const readiness = (satisfiedRequired: number, requiredCount: number) => ({
  ok: true,
  value: { satisfiedRequired, requiredCount, missing: [], total: requiredCount },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PROGRESS_CARD', 'on');
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listMissions.mockResolvedValue({ ok: true, value: [CASE] });
  service.hasConsent.mockResolvedValue(true);
  service.computeReadiness.mockResolvedValue(readiness(8, 12));
});

describe('the Progress Card on the Cases page', () => {
  it('offers it for the case being worked on while the switch is on', async () => {
    const doc = await render();
    const host = doc.querySelector('.progress-card-host');
    expect(host?.querySelector('h2')?.textContent).toBe('Progress Card');
    expect(doc.querySelector('[data-progress-card]')?.getAttribute('data-progress-card')).toBe(
      'c1',
    );
  });

  it('shows nothing at all while the switch is off', async () => {
    vi.stubEnv('PROGRESS_CARD', '');
    const doc = await render();
    expect(doc.querySelector('.progress-card-host')).toBeNull();
    expect(doc.querySelector('[data-progress-card]')).toBeNull();
    expect(doc.body.textContent).not.toContain('Progress Card');
  });

  it('shows nothing for a case with nothing required to count, or with no case', async () => {
    service.computeReadiness.mockResolvedValue(readiness(0, 0));
    expect((await render()).querySelector('.progress-card-host')).toBeNull();
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    expect((await render()).querySelector('.progress-card-host')).toBeNull();
  });
});
