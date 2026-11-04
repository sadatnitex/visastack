import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getMissionForOwner: vi.fn() }));
vi.mock('@visastack/services', () => mocks);
const { caseSubjectFor } = await import('./case-subject');

const CASE = '00000000-0000-4000-8000-0000000000c1';
const DB = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the traveller behind a case page, for the first paint', () => {
  it('names the traveller the owner check returns, for the case and every page below it', async () => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: true, value: { applicantId: 'family' } });
    for (const path of [
      `/app/mission/${CASE}`,
      `/app/mission/${CASE}/`,
      `/app/mission/${CASE}/snapshots`,
      `/app/mission/${CASE}/appointments/new`,
    ]) {
      await expect(caseSubjectFor(path, DB, 'owner'), path).resolves.toEqual({
        route: `/app/mission/${CASE}`,
        applicantId: 'family',
      });
    }
    expect(mocks.getMissionForOwner).toHaveBeenCalledWith(DB, 'owner', CASE);
  });

  it('gives nothing, the same as a missing case, when the owner check refuses', async () => {
    for (const code of ['forbidden', 'not_found']) {
      mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code } });
      await expect(caseSubjectFor(`/app/mission/${CASE}`, DB, 'someone-else')).resolves.toBeNull();
    }
  });

  it('gives nothing, and never throws, when the read fails', async () => {
    mocks.getMissionForOwner.mockRejectedValue(new Error('database unavailable'));
    await expect(caseSubjectFor(`/app/mission/${CASE}`, DB, 'owner')).resolves.toBeNull();
  });

  it('does not look anything up for an address that is not a case or has no record id', async () => {
    for (const path of [
      undefined,
      null,
      '',
      '/app',
      '/app/mission',
      '/app/mission/',
      '/app/mission/start',
      '/app/mission/not-an-id/snapshots',
      `/app/mission/${CASE}x`,
      `/app/missions/${CASE}`,
      `/app/applicant/${CASE}`,
      '/collect/account/answers',
      `/x/app/mission/${CASE}`,
    ]) {
      await expect(caseSubjectFor(path, DB, 'owner'), String(path)).resolves.toBeNull();
    }
    expect(mocks.getMissionForOwner).not.toHaveBeenCalled();
  });
});
