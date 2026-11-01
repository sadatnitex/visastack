import { beforeEach, describe, expect, it, vi } from 'vitest';

const REFUSALS = { notEmpty: 'service says not empty', notOwner: 'service says not owner' };
const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  archiveTraveller: vi.fn(),
  restoreTraveller: vi.fn(),
  deleteEmptyTraveller: vi.fn(),
  restoreDeletedTraveller: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  TRAVELLER_REFUSALS: { notEmpty: 'service says not empty', notOwner: 'service says not owner' },
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  archiveTraveller: mocks.archiveTraveller,
  restoreTraveller: mocks.restoreTraveller,
  deleteEmptyTraveller: mocks.deleteEmptyTraveller,
  restoreDeletedTraveller: mocks.restoreDeletedTraveller,
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../../../lib/session', () => ({
  withSession: (fn: (ctx: unknown) => unknown) => fn({ db: {}, accountId: 'acct-owner' }),
}));
const { travellerLifecycleAction } = await import('./actions');

const ID = '10000000-0000-4000-8000-000000000002';
const PROOF = { actor: { kind: 'applicant_owner' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function submit(fields: Record<string, string>): Promise<string> {
  try {
    await travellerLifecycleAction(form(fields));
  } catch (error) {
    return (error as Error).message.replace('REDIRECT ', '');
  }
  throw new Error('no redirect');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: PROOF });
  for (const command of [
    mocks.archiveTraveller,
    mocks.restoreTraveller,
    mocks.restoreDeletedTraveller,
    mocks.deleteEmptyTraveller,
  ]) {
    command.mockResolvedValue({ ok: true, value: {} });
  }
});

describe('the traveller lifecycle form action', () => {
  it('opens the gate as the owner for MANAGE and runs the chosen command', async () => {
    expect(await submit({ applicantId: ID, command: 'archive', returnTo: 'traveller' })).toBe(
      `/app/applicant/${ID}?traveller=archived#traveller-outcome`,
    );
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-owner' },
      'MANAGE',
      { applicantId: ID },
      { purpose: 'owner_traveller_lifecycle' },
    );
    expect(mocks.archiveTraveller).toHaveBeenCalledWith(PROOF);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app', 'layout');
    // A record just moved to Recently Deleted lands on the list, where its Restore button is.
    expect(await submit({ applicantId: ID, command: 'remove', returnTo: 'traveller' })).toBe(
      '/app/applicants?traveller=removed#traveller-outcome',
    );
    expect(await submit({ applicantId: ID, command: 'restoreDeleted', returnTo: 'list' })).toBe(
      '/app/applicants?traveller=restored#traveller-outcome',
    );
    expect(mocks.restoreDeletedTraveller).toHaveBeenCalledWith(PROOF);
  });

  it('refuses anyone the gate refuses, and a non-owner the gate allows, without running anything', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    expect(await submit({ applicantId: ID, command: 'archive' })).toContain(
      'traveller=refused-notOwner',
    );
    mocks.requireAccess.mockResolvedValueOnce({
      ok: true,
      value: { actor: { kind: 'organization_member' } },
    });
    expect(await submit({ applicantId: ID, command: 'remove' })).toContain(
      'traveller=refused-notOwner',
    );
    expect(mocks.archiveTraveller).not.toHaveBeenCalled();
    expect(mocks.deleteEmptyTraveller).not.toHaveBeenCalled();
  });

  it('turns a service refusal into its outcome word, and an error into "failed"', async () => {
    mocks.deleteEmptyTraveller.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: REFUSALS.notEmpty },
    });
    expect(await submit({ applicantId: ID, command: 'remove' })).toContain(
      'traveller=refused-notEmpty',
    );
    mocks.archiveTraveller.mockRejectedValueOnce(new Error('connection lost'));
    expect(await submit({ applicantId: ID, command: 'archive' })).toContain(
      'traveller=refused-failed',
    );
  });

  it('ignores a malformed record or command', async () => {
    expect(await submit({ applicantId: 'nope', command: 'archive' })).toBe('/app/applicants');
    expect(await submit({ applicantId: ID, command: 'destroy' })).toBe('/app/applicants');
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });
});
