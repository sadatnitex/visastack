import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ listMembershipsForAccount: vi.fn() }));

vi.mock('@visastack/services', () => ({
  listMembershipsForAccount: mocks.listMembershipsForAccount,
  createOrganization: vi.fn(),
  withdrawOrganizationApplication: vi.fn(),
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { db: true }, accountId: 'owner-1' }),
}));
vi.mock('./create-org-form', () => ({ CreateOrgForm: () => null }));

const { default: AgencyPage } = await import('./page');

function membership(
  id: string,
  status: string,
  role = 'OWNER',
  active = true,
): Record<string, unknown> {
  return {
    organization: { id, name: `Agency ${id.slice(-2)}`, status },
    membershipId: `m-${id}`,
    role,
    active,
  };
}

const PENDING = '00000000-0000-4000-8000-0000000000a1';
const ACTIVE = '00000000-0000-4000-8000-0000000000a2';
const CLOSED = '00000000-0000-4000-8000-0000000000a3';

const render = (withdrawal?: string) =>
  renderServer(
    AgencyPage({ searchParams: Promise.resolve(withdrawal === undefined ? {} : { withdrawal }) }),
  );

const withdrawForms = (html: string) =>
  [...html.matchAll(/name="organizationId" value="([^"]+)"/g)].map((match) => match[1]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Withdraw Application on the Agencies page', () => {
  it('is offered only for an application the owner can still withdraw', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      membership(PENDING, 'PENDING_VERIFICATION'),
      membership(ACTIVE, 'ACTIVE'),
      membership(CLOSED, 'CLOSED'),
    ]);
    const html = await render();
    expect(withdrawForms(html)).toEqual([PENDING]);
    const text = textOf(html);
    expect(text).toContain('Withdraw Application');
    expect(text).toContain(
      'Withdraw the application for Agency a1? It will no longer be reviewed, and anyone you added to it loses access. You can apply again at any time.',
    );
    // A closed organization reads as Closed, never as a raw code.
    expect(text).toContain('Closed');
    expect(text).not.toContain('CLOSED');
  });

  it('is not offered to an admin, a former owner, or on a reviewed application', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      membership(PENDING, 'PENDING_VERIFICATION', 'ADMIN'),
      membership('00000000-0000-4000-8000-0000000000b1', 'PENDING_VERIFICATION', 'OWNER', false),
      membership('00000000-0000-4000-8000-0000000000b2', 'REJECTED'),
      membership('00000000-0000-4000-8000-0000000000b3', 'SUSPENDED'),
    ]);
    const html = await render();
    expect(withdrawForms(html)).toEqual([]);
    expect(textOf(html)).not.toContain('Withdraw Application');
  });

  it('asks before acting: the confirmation sits inside a closed disclosure', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      membership(PENDING, 'PENDING_VERIFICATION'),
    ]);
    const html = await render();
    expect(html).toMatch(/<details class="lc-g3-withdraw">/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toMatch(/<summary[^>]*>Withdraw Application<\/summary>/);
    expect(html).toMatch(new RegExp(`aria-describedby="withdraw-${PENDING}"`));
    expect(html).toMatch(new RegExp(`id="withdraw-${PENDING}"`));
  });

  it('says what happened after a withdrawal, as a polite status', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([]);
    const done = await render('done');
    expect(done).toMatch(/<output class="lc-g3-withdrawal-status">Application withdrawn\./);
    const refused = textOf(await render('refused'));
    expect(refused).toContain('This application could not be withdrawn.');
    const unknown = await render('anything-else');
    expect(unknown).not.toContain('<output');
  });
});
