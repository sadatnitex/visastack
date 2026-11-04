import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  readTravellerCoverage: vi.fn(),
  findMatchingPublicPack: vi.fn(),
  listFittingPublicPacks: vi.fn(),
  getMissionForOwner: vi.fn(),
  attachSelectedPackVersion: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  ...mocks,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
}));

const { attachChecklistFor, checklistToLink } = await import('./case-checklist-match');

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

  it('links nothing when the gate refuses the case', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await checklistToLink(db, ROUTE)).toBeNull();
    expect(mocks.readTravellerCoverage).not.toHaveBeenCalled();
    expect(mocks.findMatchingPublicPack).not.toHaveBeenCalled();
    expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
  });
});

describe('attachChecklistFor: the one way the web app attaches a checklist (VS-006)', () => {
  beforeEach(() => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: true, value: { applicantId: 'person-1' } });
    mocks.attachSelectedPackVersion.mockResolvedValue({ ok: true, value: { id: 'case-1' } });
  });

  it("attaches through the owner's MANAGE proof for the case's traveller", async () => {
    const result = await attachChecklistFor(db, 'owner', 'case-1', 'pv-1');
    expect(result.ok).toBe(true);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      db,
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { applicantId: 'person-1' },
      { purpose: 'self' },
    );
    expect(mocks.attachSelectedPackVersion).toHaveBeenCalledWith(
      { proof: true },
      { missionId: 'case-1', packVersionId: 'pv-1' },
    );
  });

  it("attaches nothing when the case is not the person's, or the gate refuses", async () => {
    mocks.getMissionForOwner.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    expect((await attachChecklistFor(db, 'owner', 'case-1', 'pv-1')).ok).toBe(false);
    mocks.getMissionForOwner.mockResolvedValue({ ok: true, value: { applicantId: 'person-1' } });
    mocks.requireAccess.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'no' },
    });
    expect((await attachChecklistFor(db, 'owner', 'case-1', 'pv-1')).ok).toBe(false);
    expect(mocks.attachSelectedPackVersion).not.toHaveBeenCalled();
  });
});
