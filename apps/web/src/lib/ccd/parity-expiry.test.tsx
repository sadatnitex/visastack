import { vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Dates & Expiry (screen 06): see parity-kit.test-support.ts for how the comparison works. */

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  getReminderThresholds: vi.fn(),
  listIssuerVerificationsForDocument: vi.fn(),
  listMissions: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
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

const { default: Page } = await import('../../app/app/applicant/[id]/expiry/page');

const doc = (overrides: Record<string, unknown>) => ({
  id: 'd1',
  docType: 'PASSPORT',
  expiresAt: null,
  approvedName: null,
  originalName: 'synthetic-file.pdf',
  ...overrides,
});
const soon = new Date(Date.now() + 20 * 86_400_000);

registerParity({
  name: 'expiry',
  reset: () => {
    vi.resetAllMocks();
    depth.level = 'auto';
    service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'owner' });
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    service.getReminderThresholds.mockResolvedValue([90, 60, 30, 7, 0]);
    service.listIssuerVerificationsForDocument.mockResolvedValue([]);
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    service.getEvidenceCandidates.mockResolvedValue({ ok: true, value: [] });
    service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
    service.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
    });
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: { applicantId: 'person', entries: [] },
    });
  },
  render: async () => await renderServer(Page({ params: Promise.resolve({ id: 'person' }) })),
  states: [
    { name: 'nothing yet', setup: () => undefined },
    {
      name: 'a passport expiring soon, a statement and one of unknown kind',
      setup: () => {
        service.listDocumentsDetailed.mockResolvedValue({
          ok: true,
          value: [
            doc({ expiresAt: soon }),
            doc({ id: 'd2', docType: 'BANK_STATEMENT' }),
            doc({ id: 'd3', docType: null }),
          ],
        });
      },
    },
    {
      name: 'a route rule waiting for a document date',
      setup: () => {
        service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc({})] });
        service.listMissions.mockResolvedValue({
          ok: true,
          value: [{ id: 'c1', title: 'Synthetic Visit Case' }],
        });
        service.getEvidenceCandidates.mockResolvedValue({
          ok: true,
          value: [
            {
              kind: 'DOCUMENT',
              key: 'bank_statement',
              documentCandidates: [
                { documentId: 'd1', staleness: { status: 'unknown', ageDays: null } },
              ],
            },
          ],
        });
      },
    },
    {
      name: 'dates could not be read',
      setup: () => {
        service.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
      },
    },
  ],
});
