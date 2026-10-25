import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../../lib/next-mocks.test-support';

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listChangesSinceSnapshot: vi.fn(),
  compareSnapshotDetail: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('../../../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({ synthetic: 'kms' }),
}));

const { default: ThenAndNowPage } = await import('./page');

const SNAP = '11111111-1111-4111-8111-111111111111';
const PRIOR = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';

const SNAPSHOT = {
  id: SNAP,
  missionId: 'case-1',
  missionTitle: 'Japan visitor visa',
  version: 2,
  takenAt: '2026-10-18T09:00:00.000Z',
  exact: true,
};
const REVIEW = {
  confirmedAt: '2026-10-18T10:00:00.000Z',
  setAsideAt: '2026-10-20T10:00:00.000Z',
  laterConfirmation: null,
};

function side(overrides: Record<string, unknown>) {
  return {
    factVersionId: PRIOR,
    value: null,
    effectiveFrom: null,
    recordedAt: '2026-10-01T10:00:00.000Z',
    status: 'DECLARED',
    explanation: null,
    currency: null,
    basis: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown>) {
  return {
    snapshot: SNAPSHOT,
    review: REVIEW,
    valuesHidden: false,
    notesSaved: { prior: false, current: true },
    comparison: {
      fieldKey: 'employer_name',
      repeatingRecordKey: null,
      result: 'LEGITIMATE_CHANGE',
      label: 'Legitimate change',
      reason: 'later_effective_date',
      reasonText: 'The newer value took effect later.',
      prior: side({ value: 'Acme Ltd', effectiveFrom: '2020-01-01T00:00:00.000Z' }),
      current: side({
        factVersionId: CURRENT,
        value: 'Beta Ltd',
        effectiveFrom: '2025-03-01T00:00:00.000Z',
        explanation: 'Changed jobs in March',
      }),
    },
    ...overrides,
  };
}

const render = async (search: Record<string, string>) =>
  renderServer(
    await ThenAndNowPage({
      params: Promise.resolve({ id: 'synthetic-family' }),
      searchParams: Promise.resolve(search),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
  mocks.listChangesSinceSnapshot.mockResolvedValue(
    ok({
      snapshot: SNAPSHOT,
      review: REVIEW,
      changes: [
        {
          kind: 'detail',
          change: 'changed',
          fieldKey: 'employer_name',
          repeatingRecordKey: null,
          factId: 'fact-1',
          priorFactVersionId: PRIOR,
          currentFactVersionId: CURRENT,
        },
      ],
      unchangedDetailCount: 4,
    }),
  );
});

describe('then-and-now view (v1.2 E03, WP-V3 part 3)', () => {
  it('lists what differs from a snapshot by name, with the review state and a compare link', async () => {
    const html = await render({ snapshot: SNAP });
    const text = textOf(html);
    expect(text).toContain('Since Snapshot 2');
    expect(text).toContain('That confirmation was set aside');
    expect(text).toContain('4 details are still the versions this snapshot used.');
    expect(html).toContain(
      `href="/app/applicant/synthetic-family/memory/compare?snapshot=${SNAP}&amp;version=${PRIOR}"`,
    );
    expect(mocks.compareSnapshotDetail).not.toHaveBeenCalled();
  });

  it('shows both sides with exact dates, the result, and the note as a statement', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(ok(detail({})));
    const html = await render({ snapshot: SNAP, version: PRIOR });
    const text = textOf(html);
    expect(text).toContain('In Snapshot 2');
    expect(text).toContain('Today');
    expect(text).toContain('Acme Ltd');
    expect(text).toContain('Beta Ltd');
    expect(text).toMatch(/Jan 1, 2020|1 Jan 2020/);
    expect(text).toMatch(/Mar 1, 2025|1 Mar 2025/);
    expect(text).toContain('Legitimate change');
    expect(text).toContain('The newer value took effect later.');
    expect(text).toContain('Changed jobs in March');
    expect(text).toContain('A statement, not proof.');
    expect(text).toContain('It does not say which value is true.');
    expect(text).toContain('keeps exactly what it held');
    // A legitimate change needs no fix: the case is the one primary action.
    expect(text).not.toContain('Update This Detail');
    expect(html).toContain('href="/app/mission/case-1#snapshots" class="btn btn-primary"');
    expect(mocks.compareSnapshotDetail).toHaveBeenCalledWith(
      { synthetic: 'proof' },
      { snapshotId: SNAP, factVersionId: PRIOR, encryption: { synthetic: 'kms' } },
    );
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'MANAGE',
      { applicantId: 'synthetic-family' },
      { purpose: 'application_memory' },
    );
  });

  it('hides a sensitive value on both sides and still says what kind of difference it is', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(
      ok(
        detail({
          valuesHidden: true,
          comparison: {
            ...detail({}).comparison,
            fieldKey: 'passport_number',
            prior: side({ value: null }),
            current: side({ factVersionId: CURRENT, value: null, explanation: null }),
          },
        }),
      ),
    );
    const text = textOf(await render({ snapshot: SNAP, version: PRIOR }));
    expect(text.match(/Hidden here to keep it private/g)).toHaveLength(2);
    // The note is hidden with the value; the page only says one was saved.
    expect(text).toContain('A note was saved (hidden here to keep it private)');
    expect(text).not.toContain('Changed jobs in March');
    expect(text).toContain('Legitimate change');
  });

  it('a same-date conflict offers the fix first and says a note does not settle it', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(
      ok(
        detail({
          comparison: {
            ...detail({}).comparison,
            result: 'NEEDS_CLARIFICATION',
            label: 'Needs clarification',
            reason: 'same_time_different_value',
            reasonText: 'The two differ for the same date.',
          },
        }),
      ),
    );
    const html = await render({ snapshot: SNAP, version: PRIOR });
    expect(textOf(html)).toContain('does not settle the difference');
    expect(html).toMatch(
      /href="\/app\/applicant\/synthetic-family\/profile#(section-[a-z0-9_]+|profile-editor)" class="btn btn-primary">Update This Detail/,
    );
  });

  it('shows currency and tax lines for an amount, with unknown kept as not recorded', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(
      ok(
        detail({
          comparison: {
            ...detail({}).comparison,
            fieldKey: 'monthly_salary',
            result: 'INSUFFICIENT_INFORMATION',
            label: 'Insufficient information',
            reason: 'basis_unknown',
            reasonText: 'It is not recorded whether the amounts are before or after tax.',
            prior: side({ value: '80000', currency: 'BDT' }),
            current: side({
              factVersionId: CURRENT,
              value: '95000',
              currency: 'BDT',
              basis: 'GROSS',
            }),
          },
        }),
      ),
    );
    const text = textOf(await render({ snapshot: SNAP, version: PRIOR }));
    expect(text).toContain('Before or After Tax');
    expect(text).toContain('Before tax');
    expect(text).toContain('Not recorded');
  });

  it('refuses a version or snapshot that is not available, and says so when a value cannot be read', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(render({ snapshot: SNAP, version: PRIOR })).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.compareSnapshotDetail.mockResolvedValue({
      ok: false,
      error: { code: 'encryption_unavailable' },
    });
    expect(textOf(await render({ snapshot: SNAP, version: PRIOR }))).toContain(
      'This comparison cannot be shown right now.',
    );
    mocks.listChangesSinceSnapshot.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(render({ snapshot: SNAP })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render({})).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render({ snapshot: SNAP })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
