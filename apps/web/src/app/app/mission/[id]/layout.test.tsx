import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({ getMissionForOwner: vi.fn() }));
vi.mock('@visastack/services', () => mocks);
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('../../workspace-shell', () => ({ WorkspaceCaseSubject: stub('WorkspaceCaseSubject') }));
const { default: Layout } = await import('./layout');
const CASE = '00000000-0000-4000-8000-0000000000c1';
const FOREIGN = '00000000-0000-4000-8000-0000000000c2';
beforeEach(() => {
  vi.clearAllMocks();
});
describe('case navigation subject is supplied only by the owned record', () => {
  it('registers the actual subject for the case and snapshot subtree', async () => {
    mocks.getMissionForOwner.mockResolvedValue({
      ok: true,
      value: { applicantId: 'synthetic-family' },
    });
    const html = await renderServer(
      Layout({ children: <p>Case content</p>, params: Promise.resolve({ id: CASE }) }),
    );
    expect(mocks.getMissionForOwner).toHaveBeenCalledWith({}, 'synthetic-owner', CASE);
    expect(stubProps(html, 'WorkspaceCaseSubject')).toEqual([
      { route: `/app/mission/${CASE}`, applicantId: 'synthetic-family' },
    ]);
    expect(html).toContain('Case content');
  });
  it('refuses a case before supplying any subject or rendering private content', async () => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(
      Layout({ children: <p>Private case</p>, params: Promise.resolve({ id: FOREIGN }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
  it('is not found, without any lookup, for an id that is not a record id', async () => {
    for (const id of ['synthetic-case', `${CASE}x`, '../etc']) {
      await expect(
        Layout({ children: <p>Private case</p>, params: Promise.resolve({ id }) }),
        id,
      ).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.getMissionForOwner).not.toHaveBeenCalled();
  });
});
