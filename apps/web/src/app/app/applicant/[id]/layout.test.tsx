import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ getApplicant: vi.fn() }));
vi.mock('@visastack/services', () => mocks);
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('./record-sections', () => ({ RecordSections: stub('RecordSections') }));
const { default: Layout } = await import('./layout');

const render = () =>
  renderServer(
    Layout({ children: <p>Synthetic page</p>, params: Promise.resolve({ id: 'owned' }) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'owned', ownerAccountId: 'owner' });
});

describe('the traveller workspace layout', () => {
  it('puts the Record section tabs above every page of this person, which shows them only on Record pages', async () => {
    const html = await render();
    expect(stubProps<{ applicantId: string }>(html, 'RecordSections')).toEqual([
      { applicantId: 'owned' },
    ]);
    expect(html.indexOf('data-stub="RecordSections"')).toBeLessThan(html.indexOf('Synthetic page'));
  });

  it('is not found for anyone but the owner', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'owned', ownerAccountId: 'another' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
