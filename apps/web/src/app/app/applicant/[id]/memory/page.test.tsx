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

describe('Case History page (once Application Memory; v1.2 B08, WP-V3 part 3)', () => {
  it('shows each case with its records in order, prepared, confirmed and reported kept apart', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        recordShares: [],
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
                id: SNAP_1,
                at: '2026-09-10T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
              },
              {
                kind: 'confirmed',
                id: 'ack-1',
                at: '2026-09-11T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                setAsideAt: '2026-09-20T10:00:00.000Z',
              },
              {
                kind: 'reported_submitted',
                id: 'sub-1',
                at: '2026-09-25T00:00:00.000Z',
                recordedAt: '2026-09-26T10:00:00.000Z',
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                channel: 'VISA_APPLICATION_CENTER',
              },
              {
                kind: 'outcome',
                id: 'out-1',
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
    expect(text).toContain('Case History');
    expect(text).not.toContain('Application Memory');
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
        recordShares: [],
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
                id: SNAP_1,
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
    mocks.getApplicationMemory.mockResolvedValue(ok({ recordShares: [], cases: [] }));
    expect(textOf(await render())).toContain('No Cases Yet');

    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
    mocks.getApplicationMemory.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('lists shares of the whole record once, above the cases, and keeps keys unique at the same moment', async () => {
    const at = '2026-09-10T10:00:00.000Z';
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        recordShares: [
          {
            kind: 'shared',
            id: 'grant-1',
            at,
            recipientName: 'Harbor Visas',
            recipientKind: 'organization',
            status: 'ACTIVE',
          },
        ],
        cases: [
          {
            missionId: 'case-1',
            title: 'Japan visitor visa',
            destination: null,
            purpose: null,
            agencyName: null,
            state: 'DRAFT',
            createdAt: at,
            removed: false,
            events: [
              {
                kind: 'confirmed',
                id: 'ack-1',
                at,
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                setAsideAt: null,
              },
              {
                kind: 'confirmed',
                id: 'ack-2',
                at,
                snapshotId: SNAP_1,
                snapshotVersion: 1,
                setAsideAt: null,
              },
            ],
          },
        ],
      }),
    );
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Shared Outside a Case');
    expect(text.match(/Shared with Harbor Visas/g)).toHaveLength(1);
    expect(text.indexOf('Shared Outside a Case')).toBeLessThan(text.indexOf('Japan visitor visa'));
    expect(text.match(/Confirmed snapshot 1/g)).toHaveLength(2);
  });

  it('names who an all-cases share leaves out of a case, and only there', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        recordShares: [],
        cases: [
          {
            missionId: 'case-new',
            title: 'Japan trip 2026',
            destination: 'Japan',
            purpose: null,
            agencyName: null,
            state: 'DRAFT',
            createdAt: '2026-10-01T10:00:00.000Z',
            removed: false,
            notSharedWith: [
              { grantId: 'g-1', recipientName: 'Harbor Visas', recipientKind: 'organization' },
              { grantId: 'g-2', recipientName: null, recipientKind: 'person' },
            ],
            events: [],
          },
          {
            missionId: 'case-old',
            title: 'Japan trip 2025',
            destination: 'Japan',
            purpose: null,
            agencyName: null,
            state: 'CLOSED',
            createdAt: '2025-10-01T10:00:00.000Z',
            removed: false,
            notSharedWith: [],
            events: [],
          },
        ],
      }),
    );
    const html = await render();
    const text = textOf(html);
    expect(text.match(/Not shared with/g)).toHaveLength(1);
    expect(text).toContain(
      'Not shared with Harbor Visas, a removed recipient, who can see your other cases.',
    );
    expect(html).toContain('href="/app/applicant/synthetic-family/sharing"');
  });
});

describe('Case History within the scroll budget (WP-SB1)', () => {
  const renderWith = async (search: Record<string, string>) =>
    renderServer(
      await ApplicationMemoryPage({
        params: Promise.resolve({ id: 'synthetic-family' }),
        searchParams: Promise.resolve(search),
      }),
    );

  /** Ten cases of a person with 40, each carrying 50 records: the worst case the budget uses. */
  function worstCase(count: number, total: number) {
    return ok({
      recordShares: [],
      totalCases: total,
      cases: Array.from({ length: count }, (_, i) => ({
        missionId: `case-${i}`,
        title: `Case ${i + 1}`,
        destination: 'Japan',
        purpose: 'Tourism',
        agencyName: null,
        state: 'DRAFT',
        createdAt: '2026-01-01T00:00:00.000Z',
        removed: false,
        notSharedWith: [],
        events: Array.from({ length: 50 }, (_, j) => ({
          kind: 'prepared',
          id: `snap-${i}-${j}`,
          at: '2026-02-01T00:00:00.000Z',
          snapshotId: `snap-${i}-${j}`,
          snapshotVersion: j + 1,
        })),
      })),
    });
  }

  it('asks the server for ten cases, opens only the latest and offers ten more', async () => {
    mocks.getApplicationMemory.mockResolvedValue(worstCase(10, 40));
    const html = await renderWith({});
    expect(mocks.getApplicationMemory).toHaveBeenCalledWith({ synthetic: 'proof' }, { limit: 10 });
    expect(html.match(/<details/g)).toHaveLength(10);
    expect(html.match(/<details[^>]*open=""/g)).toHaveLength(1);
    expect(html).toMatch(/<details class="collapsible-group" id="memory-case-1" open="">/);
    expect(html.match(/class="activity-log-scroll memory-events-scroll"/g)).toHaveLength(10);
    expect(html).toContain('aria-label="Records of Case 1"');
    const text = textOf(html);
    expect(text).toContain('Showing 10 of 40 cases.');
    expect(html).toContain('href="/app/applicant/synthetic-family/memory?show=20#memory-case-11"');
  });

  it('grows by ten through the address, clamps a wild value and stops when all are shown', async () => {
    mocks.getApplicationMemory.mockResolvedValue(worstCase(12, 12));
    const html = await renderWith({ show: '15' });
    expect(mocks.getApplicationMemory).toHaveBeenCalledWith({ synthetic: 'proof' }, { limit: 20 });
    expect(textOf(html)).toContain('Showing all 12 cases.');
    expect(html).not.toContain('show-more-link');

    await renderWith({ show: '999999' });
    expect(mocks.getApplicationMemory).toHaveBeenLastCalledWith(
      { synthetic: 'proof' },
      { limit: 100 },
    );
    await renderWith({ show: 'lots' });
    expect(mocks.getApplicationMemory).toHaveBeenLastCalledWith(
      { synthetic: 'proof' },
      { limit: 10 },
    );
  });
});

describe('Case History past the largest step (WP-SB1)', () => {
  it('points to Cases when more cases exist than one read returns', async () => {
    const many = {
      recordShares: [],
      totalCases: 105,
      cases: Array.from({ length: 100 }, (_, i) => ({
        missionId: `case-${i}`,
        title: `Case ${i + 1}`,
        destination: null,
        purpose: null,
        agencyName: null,
        state: 'DRAFT',
        createdAt: '2026-01-01T00:00:00.000Z',
        removed: false,
        notSharedWith: [],
        events: [],
      })),
    };
    mocks.getApplicationMemory.mockResolvedValue(ok(many));
    const html = renderServer(
      await ApplicationMemoryPage({
        params: Promise.resolve({ id: 'synthetic-family' }),
        searchParams: Promise.resolve({ show: '100' }),
      }),
    );
    const text = textOf(await html);
    expect(text).toContain('Showing 100 of 105 cases.');
    expect(text).toContain(
      'Case History lists the 100 most recently active cases. Every case is on Cases .',
    );
    expect(await html).toContain('href="/app/applicant/synthetic-family/missions"');
  });
});
