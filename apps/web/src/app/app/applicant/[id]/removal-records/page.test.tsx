import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listDeletionReceipts: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: RemovalRecordsPage } = await import('./page');
const page = () => renderServer(RemovalRecordsPage({ params: Promise.resolve({ id: 'a1' }) }));

const record = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  subjectKind: 'DOCUMENT',
  subjectCode: 'D-7K2Q9M',
  documentKind: 'passport',
  scheduledFor: null,
  verifiedGoneAt: null,
  requestedAt: new Date('2026-11-03T14:05:00Z'),
  requestedBy: 'OWNER_ACCOUNT',
  approvedBy: null,
  status: 'REMOVING',
  effects: {},
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' } },
  });
  service.listDeletionReceipts.mockResolvedValue({
    ok: true,
    value: [
      record({
        requestedByAccountId: '11111111-2222-4333-8444-555555555555',
        approvedByAccountId: '99999999-8888-4777-8666-444444444444',
      }),
    ],
  });
});

describe('Removal Records page', () => {
  it('shows when and from which account a removal was asked, and what to do if it was not you', async () => {
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Removing Securely: Passport D-7K2Q9M.');
    expect(text).toContain('Asked from your account on 3 Nov 2026 at 14:05 UTC.');
    expect(text).toContain('Times are shown in UTC.');
    expect(html).toContain('href="/auth/forgot-password"');
    expect(html).toContain('href="/app/help#contact"');
    // Only the coarse words reach the page: no account id, no email.
    expect(html).not.toContain('owner');
    expect(html).not.toContain('11111111-2222-4333-8444-555555555555');
    expect(html).not.toContain('99999999-8888-4777-8666-444444444444');
  });

  it('asks the services for the owner view only and shows nothing about guidance when empty', async () => {
    service.listDeletionReceipts.mockResolvedValue({ ok: true, value: [] });
    const text = textOf(await page());
    expect(service.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'VIEW_METADATA',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(text).toContain('Nothing has been removed from this record.');
    expect(text).not.toContain('Reset Your Password');
  });

  it('is not found for anyone but the record owner, whatever else they may do', async () => {
    service.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'agency_member' } },
    });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    service.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(service.listDeletionReceipts).not.toHaveBeenCalled();
  });

  it('reads a missing table as no records, never as an error', async () => {
    service.listDeletionReceipts.mockResolvedValue({ ok: false, error: { code: 'invalid' } });
    expect(textOf(await page())).toContain('Nothing has been removed from this record.');
  });
});
