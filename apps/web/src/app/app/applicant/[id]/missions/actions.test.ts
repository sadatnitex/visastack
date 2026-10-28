import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start a Case on the server (owner list item 1): every answer is checked here, each problem is
 * named beside its field, a good form creates the case through the existing owner-checked
 * service, links the one matching checklist when there is exactly one, and opens the new case
 * with its welcome note.
 */

const mocks = vi.hoisted(() => ({
  createMission: vi.fn(),
  attachPackVersion: vi.fn(),
  checklistToLink: vi.fn(),
  reportServerError: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('@visastack/services', () => ({
  createMission: mocks.createMission,
  attachPackVersion: mocks.attachPackVersion,
}));
vi.mock('../../../../../lib/case-checklist-match', () => ({
  checklistToLink: mocks.checklistToLink,
}));
vi.mock('../../../../../lib/server-error', () => ({
  reportServerError: mocks.reportServerError,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { createMissionAction } = await import('./actions');

const PREV = { ok: true, message: '' };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  data.set('applicantId', 'applicant-1');
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMission.mockResolvedValue({ ok: true, value: { id: 'case-1' } });
  mocks.attachPackVersion.mockResolvedValue({ ok: true, value: {} });
  mocks.checklistToLink.mockResolvedValue(null);
});

describe('createMissionAction: checking the answers', () => {
  it('names the empty title beside its field, keeps what was typed and saves nothing', async () => {
    const result = await createMissionAction(PREV, form({ title: '  ', destination: 'JP' }));
    expect(result.ok).toBe(false);
    expect(result.field).toBe('title');
    expect(result.fieldErrors?.title).toMatch(/Give the case a name/);
    expect(result.message).toBe('Check the field marked above.');
    expect(result.values?.destination).toBe('JP');
    expect(result.attempt).toBe(1);
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it('refuses a country or purpose the lists do not hold, so free text never reaches the case', async () => {
    const result = await createMissionAction(
      { ...PREV, attempt: 2 },
      form({ title: 'Trip', destination: 'Atlantis', purpose: 'smuggling' }),
    );
    expect(result.fieldErrors).toEqual({
      destination: 'Choose a country from the list.',
      purpose: 'Choose a purpose from the list.',
    });
    expect(result.field).toBe('destination');
    expect(result.message).toBe('Check the 2 fields marked above.');
    expect(result.attempt).toBe(3);
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it('refuses an unreal date and a trip that ends before it starts, focusing the first', async () => {
    const result = await createMissionAction(
      PREV,
      form({
        title: 'Trip',
        travelStartDate: '2026-12-10',
        travelEndDate: '2026-12-01',
        targetDeadline: '2026-02-30',
      }),
    );
    expect(result.fieldErrors).toEqual({
      travelEndDate: 'The trip cannot end before it starts.',
      targetDeadline: 'Enter a full date: day, month and year.',
    });
    expect(result.field).toBe('travelEndDate');
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it('refuses a name longer than the form allows', async () => {
    const result = await createMissionAction(PREV, form({ title: 'x'.repeat(201) }));
    expect(result.field).toBe('title');
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it('shows the service refusal in plain words and keeps the answers', async () => {
    mocks.createMission.mockResolvedValue({
      ok: false,
      error: { code: 'consent_required', message: 'Core processing consent is required' },
    });
    const result = await createMissionAction(PREV, form({ title: 'Trip', destination: 'GB' }));
    expect(result).toMatchObject({
      ok: false,
      message: 'Turn on Let VisaStack Process My Details on Home, then start the case.',
      values: { title: 'Trip', destination: 'GB' },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('createMissionAction: a good form', () => {
  it('saves the country name and the purpose label, then opens the new case at its welcome note', async () => {
    await expect(
      createMissionAction(
        PREV,
        form({
          title: ' UK Student Visa ',
          destination: 'gb',
          purpose: 'tourism',
          jurisdiction: 'British High Commission Dhaka',
          travelStartDate: '2026-12-01',
          travelEndDate: '2026-12-20',
        }),
      ),
    ).rejects.toThrow('REDIRECT /app/mission/case-1?welcome=1');
    expect(mocks.createMission).toHaveBeenCalledWith(
      { tag: 'db' },
      {
        actorAccountId: 'owner',
        applicantId: 'applicant-1',
        title: 'UK Student Visa',
        destination: 'United Kingdom',
        purpose: 'Tourism',
        jurisdiction: 'British High Commission Dhaka',
        travelStartDate: new Date('2026-12-01T00:00:00.000Z'),
        travelEndDate: new Date('2026-12-20T00:00:00.000Z'),
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/applicant-1/missions');
  });

  it('links the one matching checklist, asking with every name the country and purpose go by', async () => {
    mocks.checklistToLink.mockResolvedValue({
      packVersionId: 'pv-uk',
      packName: 'UK Visitor',
      version: 2,
    });
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT');
    const [, terms] = mocks.checklistToLink.mock.calls[0] ?? [];
    expect(terms.country).toEqual(expect.arrayContaining(['GB', 'United Kingdom', 'UK']));
    expect(terms.purpose).toEqual(['tourism', 'Tourism']);
    // The traveller is read for the new case, so a checklist for other people is left out.
    expect(terms).toMatchObject({ accountId: 'owner', missionId: 'case-1' });
    expect(mocks.attachPackVersion).toHaveBeenCalledWith(
      { tag: 'db' },
      { actorAccountId: 'owner', missionId: 'case-1', packVersionId: 'pv-uk' },
    );
  });

  it('includes the shared Schengen area for a Schengen state', async () => {
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'FR', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT');
    const [, terms] = mocks.checklistToLink.mock.calls[0] ?? [];
    expect(terms.country).toEqual(expect.arrayContaining(['FR', 'France', 'Schengen']));
  });

  it('links nothing without both a country and a purpose, or when no checklist matches', async () => {
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB' })),
    ).rejects.toThrow('REDIRECT');
    expect(mocks.checklistToLink).not.toHaveBeenCalled();
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT');
    expect(mocks.attachPackVersion).not.toHaveBeenCalled();
  });

  it('still opens the case when linking the checklist is refused', async () => {
    mocks.checklistToLink.mockResolvedValue({
      packVersionId: 'pv',
      packName: 'P',
      version: 1,
    });
    mocks.attachPackVersion.mockResolvedValue({ ok: false, error: { code: 'invalid' } });
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT /app/mission/case-1?welcome=1');
  });

  it('never shows an error once the case exists: a failed lookup still opens the new case', async () => {
    mocks.checklistToLink.mockRejectedValue(new Error('connection reset'));
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT /app/mission/case-1?welcome=1');
    expect(mocks.createMission).toHaveBeenCalledTimes(1);
    expect(mocks.attachPackVersion).not.toHaveBeenCalled();
    expect(mocks.reportServerError).toHaveBeenCalledWith('createMissionAction', expect.any(Error), {
      step: 'checklist link',
    });
  });

  it('never shows an error once the case exists: a failed link still opens the new case', async () => {
    mocks.checklistToLink.mockResolvedValue({ packVersionId: 'pv', packName: 'P', version: 1 });
    mocks.attachPackVersion.mockRejectedValue(new Error('deadlock'));
    await expect(
      createMissionAction(PREV, form({ title: 'Trip', destination: 'GB', purpose: 'tourism' })),
    ).rejects.toThrow('REDIRECT /app/mission/case-1?welcome=1');
    expect(mocks.reportServerError).toHaveBeenCalledTimes(1);
  });
});
