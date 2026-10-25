import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getApplicationMemory: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));

const { default: ApplicationMemoryPage } = await import('./page');

const SNAP_1 = '11111111-1111-4111-8111-111111111111';

const render = async () =>
  renderServer(
    await ApplicationMemoryPage({ params: Promise.resolve({ id: 'synthetic-family' }) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
});

describe('Application Memory page (v1.2 B08, WP-V3 part 3)', () => {
  it('shows each case with its records in order, prepared, confirmed and reported kept apart', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        cases: [
          {
            missionId: 'case-1',
            title: 'Japan visitor visa',
            destination: 'Japan',
            purpose: 'Tourism',
            agencyName: 'Harbor Visas',
            state: 'SUBMISSION_READY',
            createdAt: '2026-09-01T10:00:00.000Z',
            removed: false,
            events: [
              {
                kind: 'prepared',
                at: '2026-09-10T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
              },
              {
                kind: 'confirmed',
                at: '2026-09-11T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                setAsideAt: '2026-09-20T10:00:00.000Z',
              },
              {
                kind: 'reported_submitted',
                at: '2026-09-25T00:00:00.000Z',
                recordedAt: '2026-09-26T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                channel: 'VISA_APPLICATION_CENTER',
              },
              {
                kind: 'outcome',
                at: '2026-10-05T00:00:00.000Z',
                recordedAt: '2026-10-06T10:00:00.000Z',
                decision: 'APPROVED',
              },
            ],
          },
        ],
      }),
    );
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Application Memory');
    expect(text).toContain('Japan visitor visa');
    expect(text).toContain('Managed by Harbor Visas');
    expect(text).toContain('Snapshot 1 prepared');
    expect(text).toContain('Confirmed snapshot 1');
    expect(text).toContain('Set aside on 20 Sept 2026 because the case changed.');
    expect(text).toContain('Reported as submitted by visa application centre, using snapshot 1');
    expect(text).toContain('VisaStack does not submit applications.');
    expect(text).toContain('Decision recorded: Approved');
    const order = [
      'Snapshot 1 prepared',
      'Confirmed snapshot 1',
      'Reported as submitted',
      'Decision recorded',
    ].map((marker) => text.indexOf(marker));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`href="/app/mission/case-1/snapshots/${SNAP_1}"`);
    expect(html).toContain(
      `href="/app/applicant/synthetic-family/memory/compare?snapshot=${SNAP_1}"`,
    );
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'account', accountId: 'synthetic-owner' }),
      'VIEW_METADATA',
      { applicantId: 'synthetic-family' },
      { purpose: 'application_memory' },
    );
  });

  it('keeps the history of a removed case but offers no snapshot links', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        cases: [
          {
            missionId: 'case-2',
            title: 'Old trip',
            destination: null,
            purpose: null,
            agencyName: null,
            state: 'CLOSED',
            createdAt: '2025-01-01T10:00:00.000Z',
            removed: true,
            events: [
              {
                kind: 'prepared',
                at: '2025-01-10T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
              },
            ],
          },
        ],
      }),
    );
    const html = await render();
    expect(textOf(html)).toContain('removed at the end of its keep period');
    expect(html).not.toContain('/snapshots/');
  });

  it('shows an empty state with no cases, and nothing at all to someone the gate refuses', async () => {
    mocks.getApplicationMemory.mockResolvedValue(ok({ cases: [] }));
    expect(textOf(await render())).toContain('No Cases Yet');

    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
    mocks.getApplicationMemory.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
