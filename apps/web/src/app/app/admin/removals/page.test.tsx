import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stubProps, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  listRemovalQueue: vi.fn(),
  switchOn: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('../../../../lib/env', () => ({ documentRemovalRequestsOn: mocks.switchOn }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listRemovalQueue: (...args: unknown[]) => mocks.listRemovalQueue(...args),
}));
vi.mock('./decide-form', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { DecideRemovalForm: stub('DecideRemovalForm') };
});
vi.mock('../../../../components/show-more', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ShowMore: stub('ShowMore') };
});

const { default: Page } = await import('./page');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  documentCode: 'D-7K2Q9',
  reason: 'PRIVACY_CONCERN',
  requestedAt: new Date('2026-11-02T09:00:00Z'),
  waitingWorkingDays: 4,
  legalHold: false,
  openCases: 2,
  finishedCases: 1,
  agencies: 1,
  sharesAffected: 0,
  storageBytes: 2 * 1024 * 1024,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.switchOn.mockReturnValue(true);
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.listRemovalQueue.mockResolvedValue({ ok: true, value: { rows: [row()], hasMore: true } });
});

describe('Removal Requests (staff queue)', () => {
  it('does not exist while the switch is off', async () => {
    mocks.switchOn.mockReturnValue(false);
    await expect(Page({})).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
  });

  it('is read with privacy access only', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page({}));
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('APPLICANT_DIRECTORY_VIEW');
    expect(mocks.listRemovalQueue).not.toHaveBeenCalled();
    expect(textOf(html)).not.toContain('D-7K2Q9');
  });

  it('lists 25 requests, oldest first, with what approving changes, and Show More', async () => {
    const html = await renderServer(Page({}));
    expect(mocks.listRemovalQueue.mock.calls[0]?.[1]).toMatchObject({ limit: 25 });
    const text = textOf(html);
    expect(text).toContain('Document D-7K2Q9');
    expect(text).toContain('Privacy Concern');
    expect(text).toContain('Waiting 4 working days');
    expect(text).toContain('Overdue');
    expect(text).toContain('2 open cases will ask for another document');
    expect(text).toContain('1 finished case keeps its record');
    expect(text).toContain('1 agency told without the document name');
    expect(text).toContain('frees 2.0 MB');
    expect(stubProps(html, 'DecideRemovalForm')).toEqual([
      { requestId: row().id, documentCode: 'D-7K2Q9', legalHold: false },
    ]);
    expect(stubProps<{ next: unknown }>(html, 'ShowMore')[0]?.next).toEqual({ show: 50 });
  });

  it('marks a request a legal hold covers', async () => {
    mocks.listRemovalQueue.mockResolvedValue({
      ok: true,
      value: { rows: [row({ legalHold: true, waitingWorkingDays: 1 })], hasMore: false },
    });
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Kept (Legal Requirement)');
    expect(text).not.toContain('Overdue');
  });

  it('says plainly when nothing is waiting', async () => {
    mocks.listRemovalQueue.mockResolvedValue({ ok: true, value: { rows: [], hasMore: false } });
    expect(textOf(await renderServer(Page({})))).toContain('No removal requests are waiting.');
  });
});
