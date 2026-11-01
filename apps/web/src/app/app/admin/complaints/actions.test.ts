import { beforeEach, describe, expect, it, vi } from 'vitest';

/** WP-SB6: a status change opens the complaint's new tab, which names the move. */

const mocks = vi.hoisted(() => ({
  hasPlatformPermission: vi.fn(),
  updateComplaintStatus: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'quality@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  hasPlatformPermission: (...args: unknown[]) => mocks.hasPlatformPermission(...args),
  bootstrapAdminEmails: () => [],
}));
vi.mock('@visastack/services', () => ({
  assignComplaintOwner: vi.fn(),
  getAccountByEmail: vi.fn(),
  updateComplaintStatus: (...args: unknown[]) => mocks.updateComplaintStatus(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const { updateComplaintStatusAction } = await import('./actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPlatformPermission.mockResolvedValue(true);
  mocks.updateComplaintStatus.mockResolvedValue({ ok: true, value: {} });
});

describe('updateComplaintStatusAction', () => {
  it('opens the new tab after a move, naming it', async () => {
    await expect(
      updateComplaintStatusAction(
        { ok: true, message: '' },
        form({ complaintId: 'c1', status: 'IN_PROGRESS' }),
      ),
    ).rejects.toThrow('REDIRECT /app/admin/complaints?status=in-progress&moved=in-progress');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/complaints');
  });

  it('stays on the form with the reason when the move is refused, and keeps its role check', async () => {
    mocks.updateComplaintStatus.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'A resolution is required.' },
    });
    expect(
      await updateComplaintStatusAction(
        { ok: true, message: '' },
        form({ complaintId: 'c1', status: 'RESOLVED' }),
      ),
    ).toEqual({ ok: false, message: 'A resolution is required.' });
    mocks.hasPlatformPermission.mockResolvedValue(false);
    expect(
      await updateComplaintStatusAction(
        { ok: true, message: '' },
        form({ complaintId: 'c1', status: 'CLOSED' }),
      ),
    ).toEqual({ ok: false, message: 'Not authorized.' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
