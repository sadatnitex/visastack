import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

/** UMPE P11: the Checklist Corrections page. Made-up suggestions, links and dates only. */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  queue: vi.fn(),
  runs: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  staffPrincipal: async (...args: unknown[]) =>
    (await mocks.permission(...args))
      ? { ok: true, value: { kind: 'staff' } }
      : { ok: false, error: { code: 'forbidden', message: 'no' } },
  bootstrapAdminEmails: () => [],
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listChecklistCorrections: (...args: unknown[]) => mocks.queue(...args),
  listRuleImpactRuns: (...args: unknown[]) => mocks.runs(...args),
}));
vi.mock('./correction-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { CorrectionDecisionForm: stub('CorrectionDecisionForm') };
});

const { default: Page } = await import('./page');

const view = (overrides: Record<string, unknown> = {}) => ({
  id: 'k1',
  category: 'OUTDATED',
  status: 'RECEIVED',
  packId: 'p1',
  packName: 'Synthetic GB Visit',
  packVersionId: 'v1',
  version: 3,
  item: { kind: 'DOCUMENT', key: 'bank_statement' },
  officialUrl: 'https://visas.synthetic-gov.example/money',
  detail: 'Six months of statements now.',
  submitterKind: 'TRAVELLER',
  createdAt: new Date('2026-11-02T10:00:00Z'),
  alsoSuggestedBy: 2,
  reviewedAt: null,
  reviewNote: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.queue.mockResolvedValue({
    ok: true,
    value: {
      ready: true,
      open: [view(), view({ id: 'k2', item: null, category: 'MISSING', officialUrl: null })],
      decided: [view({ id: 'k3', status: 'DISMISSED', reviewNote: 'Layout only.' })],
      openCount: 2,
    },
  });
  mocks.runs.mockResolvedValue({
    ok: true,
    value: [
      {
        packVersionId: 'v4',
        packId: 'p1',
        packName: 'Synthetic GB Visit',
        version: 4,
        publishedAt: new Date('2026-11-02T12:00:00Z'),
        assessedAt: new Date('2026-11-02T12:00:01Z'),
        casesFlagged: 7,
        notesQueued: 7,
        stillOpen: 5,
      },
    ],
  });
});

describe('Pack Studio > Checklist Corrections', () => {
  it('needs pack management rights and reads nothing without them', async () => {
    mocks.permission.mockResolvedValue(false);
    const text = textOf(await render());
    expect(text).toContain('restricted to people who manage packs');
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.permission.mock.calls[0]?.[2]).toBe('PACK_MANAGE');
  });

  it('says plainly when the database is not updated yet', async () => {
    mocks.queue.mockResolvedValue({
      ok: true,
      value: { ready: false, open: [], decided: [], openCount: 0 },
    });
    const html = await render();
    expect(textOf(html)).toContain('can be used once the database is updated');
    expect(html).not.toContain('data-stub="CorrectionDecisionForm"');
  });

  it('shows each suggestion with its item, category, link host and how many said the same, never who', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Suggestions to Review (2)');
    expect(text).toContain('Bank Statement');
    expect(text).toContain('Out of Date');
    expect(text).toContain('From A Traveller');
    expect(text).toContain('2 other open suggestions say the same.');
    expect(text).toContain('visas.synthetic-gov.example');
    expect(text).toContain('The Whole Checklist');
    expect(text).toContain('No official link given.');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="/app/admin/packs/p1"');
    // Decisions only on open suggestions.
    expect(
      stubProps<{ correctionId: string }>(html, 'CorrectionDecisionForm').map(
        (p) => p.correctionId,
      ),
    ).toEqual(['k1', 'k2']);
    expect(text).toContain('Layout only.');
  });

  it('shows what the latest publications meant for active cases, as counts', async () => {
    const text = textOf(await render());
    expect(text).toContain('Active Cases Marked for Review');
    expect(text).toContain('Synthetic GB Visit · Version 4');
    expect(text).toContain('Still Waiting for Review');
  });
});

function render() {
  return renderServer(Page());
}
