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
      Layout({ children: <p>Case content</p>, params: Promise.resolve({ id: 'synthetic-case' }) }),
    );
    expect(mocks.getMissionForOwner).toHaveBeenCalledWith({}, 'synthetic-owner', 'synthetic-case');
    expect(stubProps(html, 'WorkspaceCaseSubject')).toEqual([
      { route: '/app/mission/synthetic-case', applicantId: 'synthetic-family' },
    ]);
    expect(html).toContain('Case content');
  });
  it('refuses a case before supplying any subject or rendering private content', async () => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(
      Layout({ children: <p>Private case</p>, params: Promise.resolve({ id: 'foreign-case' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
