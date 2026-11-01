import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  hasPlatformPermission: vi.fn(),
  listComplaintsForQualityReview: vi.fn(),
  listFeedbackForQualityReview: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'quality@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  hasPlatformPermission: (...args: unknown[]) => mocks.hasPlatformPermission(...args),
  bootstrapAdminEmails: () => [],
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listComplaintsForQualityReview: (...args: unknown[]) =>
    mocks.listComplaintsForQualityReview(...args),
  listFeedbackForQualityReview: (...args: unknown[]) => mocks.listFeedbackForQualityReview(...args),
}));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    AssignComplaintForm: stub('AssignComplaintForm'),
    UpdateComplaintStatusForm: stub('UpdateComplaintStatusForm'),
  };
});

const { default: Page } = await import('./page');

const COUNTS = { OPEN: 600, IN_PROGRESS: 200, RESOLVED: 150, CLOSED: 50 };
const ACTOR = { accountId: 'acct-1', email: 'quality@example.com', bootstrapEmails: [] };

const complaint = (n: number, status: string) => ({
  id: `c-${n}`,
  missionId: `m-${n}`,
  description: `Complaint ${n}`,
  status,
  resolution: status === 'RESOLVED' ? 'Refunded' : null,
  ownerAccountId: null,
  createdAt: new Date(Date.UTC(2026, 9, 1) - n * 60_000),
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/complaints';
  mocks.hasPlatformPermission.mockResolvedValue(true);
  mocks.listComplaintsForQualityReview.mockImplementation(
    async (_db: unknown, _actor: unknown, options: { status: string }) => ({
      ok: true,
      value: {
        items: Array.from({ length: 20 }, (_, n) => complaint(n, options.status)),
        nextCursor: 'C_NEXT',
        status: options.status,
        counts: COUNTS,
      },
    }),
  );
  mocks.listFeedbackForQualityReview.mockResolvedValue({
    ok: true,
    value: {
      items: Array.from({ length: 50 }, (_, n) => ({
        id: `f-${n}`,
        missionId: `m-${n}`,
        comments: `Feedback ${n}`,
        createdAt: new Date('2026-10-01'),
      })),
      nextCursor: 'F_NEXT',
      total: 1000,
    },
  });
});

describe('Platform > Complaints (WP-SB6)', () => {
  it('opens on the Open tab with 20 complaints, every status counted, and forms behind an expander', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.listComplaintsForQualityReview).toHaveBeenCalledWith({}, ACTOR, {
      status: 'OPEN',
      limit: 20,
    });
    const text = textOf(html);
    expect(text).toContain('Open (600)');
    expect(text).toContain('Being Handled (200)');
    expect(text).toContain('Resolved (150)');
    expect(text).toContain('Closed (50)');
    expect(html).toMatch(/aria-current="page"[^>]*>Open|>Open[^<]*<\/a>/);
    expect(html.match(/class="row complaint-row"/g) ?? []).toHaveLength(20);
    expect(
      html.match(/<details class="complaint-actions"><summary>Assign or Update<\/summary>/g) ?? [],
    ).toHaveLength(20);
    expect(stubProps(html, 'AssignComplaintForm')).toHaveLength(20);
    expect(text).toContain('Showing the newest 20 of 600 complaints.');
    expect(html).toContain('href="/app/admin/complaints?before=C_NEXT#complaints-list"');
    expect(html).toContain('href="/app/admin/complaints?status=resolved"');
  });

  it('reads the chosen tab and page, and shows no forms for an ended complaint', async () => {
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ status: 'resolved', before: 'C_PREV' }) }),
    );
    expect(mocks.listComplaintsForQualityReview).toHaveBeenCalledWith({}, ACTOR, {
      status: 'RESOLVED',
      limit: 20,
      before: 'C_PREV',
    });
    expect(stubProps(html, 'AssignComplaintForm')).toHaveLength(0);
    expect(html).toContain('href="/app/admin/complaints?status=resolved#complaints-list"');
    expect(textOf(html)).toContain('Show Newest Entries');
  });

  it('names a move on the tab the complaint moved to, and only there', async () => {
    const moved = textOf(
      await renderServer(
        Page({ searchParams: Promise.resolve({ status: 'in-progress', moved: 'in-progress' }) }),
      ),
    );
    expect(moved).toContain('Complaint moved to Being Handled. It is listed on this tab now.');
    const elsewhere = textOf(
      await renderServer(
        Page({ searchParams: Promise.resolve({ status: 'open', moved: 'closed' }) }),
      ),
    );
    expect(elsewhere).not.toContain('Complaint moved to');
  });

  it('gives every empty tab its own sentence', async () => {
    mocks.listComplaintsForQualityReview.mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null, status: 'IN_PROGRESS', counts: COUNTS },
    });
    const text = textOf(
      await renderServer(Page({ searchParams: Promise.resolve({ status: 'in-progress' }) })),
    );
    expect(text).toContain('No complaints are being handled right now.');
  });

  it('treats an unknown tab as Open', async () => {
    await renderServer(Page({ searchParams: Promise.resolve({ status: 'everything' }) }));
    expect(mocks.listComplaintsForQualityReview).toHaveBeenCalledWith({}, ACTOR, {
      status: 'OPEN',
      limit: 20,
    });
  });

  it('keeps private feedback in a fixed box, 50 a load, with Show Older Entries', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({ status: 'closed' }) }));
    expect(mocks.listFeedbackForQualityReview).toHaveBeenCalledWith({}, ACTOR, { limit: 50 });
    expect(html).toContain('aria-label="Private Feedback Entries"');
    expect(html.match(/class="row feedback-row"/g) ?? []).toHaveLength(50);
    expect(html).toContain(
      'href="/app/admin/complaints?status=closed&amp;feedbackBefore=F_NEXT#feedback-panel"',
    );
    expect(textOf(html)).toContain('Showing the newest 50 of 1000 feedback entries.');
  });

  it('keeps its role checks: no quality role, no read; no feedback role, no feedback read', async () => {
    mocks.hasPlatformPermission.mockResolvedValue(false);
    expect(textOf(await renderServer(Page()))).toContain('restricted to quality admins');
    expect(mocks.listComplaintsForQualityReview).not.toHaveBeenCalled();
    mocks.hasPlatformPermission.mockImplementation(
      async (_db: unknown, _who: unknown, action: string) => action === 'COMPLAINT_MANAGE',
    );
    const text = textOf(await renderServer(Page()));
    expect(mocks.listFeedbackForQualityReview).not.toHaveBeenCalled();
    expect(text).not.toContain('Private Feedback');
  });
});
