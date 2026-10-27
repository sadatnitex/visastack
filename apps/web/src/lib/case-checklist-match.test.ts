import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  readTravellerCoverage: vi.fn(),
  findMatchingPublicPack: vi.fn(),
  listFittingPublicPacks: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  ...mocks,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
}));

const { checklistToLink, checklistsToPick } = await import('./case-checklist-match');

const db = { tag: 'db' } as never;
const ROUTE = {
  accountId: 'owner',
  missionId: 'case-1',
  country: ['GB', 'United Kingdom'],
  purpose: ['tourism'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  mocks.readTravellerCoverage.mockResolvedValue({
    nationality: ['Bangladeshi'],
    residence: [],
  });
  mocks.findMatchingPublicPack.mockResolvedValue({
    packVersionId: 'pv',
    packName: 'P',
    version: 1,
  });
  mocks.listFittingPublicPacks.mockResolvedValue([]);
});

describe('choosing a checklist for a case', () => {
  it("asks with the traveller's confirmed nationality, read through the gate for this case", async () => {
    expect(await checklistToLink(db, ROUTE)).toMatchObject({ packVersionId: 'pv' });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      db,
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { missionId: 'case-1' },
      { purpose: 'owner_checklist_match' },
    );
    expect(mocks.readTravellerCoverage).toHaveBeenCalledWith({ proof: true });
    const [, terms] = mocks.findMatchingPublicPack.mock.calls[0] ?? [];
    expect(terms.country).toEqual(ROUTE.country);
    expect(terms.traveller.nationality).toEqual({
      terms: expect.arrayContaining(['Bangladeshi', 'BD']),
      known: true,
    });
    expect(terms.traveller.residence).toEqual({ terms: [], known: false });
  });

  it('links nothing and lists nothing when the gate refuses the case', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await checklistToLink(db, ROUTE)).toBeNull();
    expect(await checklistsToPick(db, ROUTE)).toEqual([]);
    expect(mocks.readTravellerCoverage).not.toHaveBeenCalled();
    expect(mocks.findMatchingPublicPack).not.toHaveBeenCalled();
    expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
  });

  it('lists the checklists the person could pick for the route', async () => {
    await checklistsToPick(db, ROUTE);
    expect(mocks.listFittingPublicPacks).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ purpose: ['tourism'] }),
    );
  });
});
