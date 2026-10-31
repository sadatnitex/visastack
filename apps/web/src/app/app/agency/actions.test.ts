import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withdrawOrganizationApplication: vi.fn(),
  createOrganization: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('@visastack/services', () => ({
  createOrganization: mocks.createOrganization,
  withdrawOrganizationApplication: mocks.withdrawOrganizationApplication,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner-1' }),
}));

const { withdrawOrganizationApplicationAction } = await import('./actions');

const ORG = '00000000-0000-4000-8000-0000000000aa';

function form(organizationId: string): FormData {
  const data = new FormData();
  data.set('organizationId', organizationId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withdrawOrganizationApplicationAction', () => {
  it('asks the service as the signed-in account and reports success', async () => {
    mocks.withdrawOrganizationApplication.mockResolvedValue({ ok: true, value: { id: ORG } });
    await expect(withdrawOrganizationApplicationAction(form(ORG))).rejects.toThrow(
      'REDIRECT /app/agency?withdrawal=done',
    );
    expect(mocks.withdrawOrganizationApplication).toHaveBeenCalledWith(
      { tag: 'db' },
      { actorAccountId: 'owner-1', organizationId: ORG },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/agency');
  });

  it('reports a refusal from the service plainly', async () => {
    mocks.withdrawOrganizationApplication.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'only an owner can withdraw this application' },
    });
    await expect(withdrawOrganizationApplicationAction(form(ORG))).rejects.toThrow(
      'REDIRECT /app/agency?withdrawal=refused',
    );
  });

  it('never sends a malformed id to the service', async () => {
    await expect(withdrawOrganizationApplicationAction(form("x' or 1=1"))).rejects.toThrow(
      'REDIRECT /app/agency?withdrawal=refused',
    );
    await expect(withdrawOrganizationApplicationAction(new FormData())).rejects.toThrow(
      'REDIRECT /app/agency?withdrawal=refused',
    );
    expect(mocks.withdrawOrganizationApplication).not.toHaveBeenCalled();
  });
});
