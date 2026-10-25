import { beforeEach, describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('@visastack/services', () => ({
  setConsent: vi.fn(),
  createApplicant: async (_db: unknown, input: unknown) => {
    created.calls.push(input);
    return { ok: true, value: { id: 'a1' } };
  },
}));
const { createApplicantAction } = await import('./actions');

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};
const INITIAL = { ok: true, message: '' };

beforeEach(() => {
  created.calls = [];
});

describe('createApplicantAction with the first-run radios', () => {
  it('Me is SELF, whatever else the form carries', async () => {
    const result = await createApplicantAction(
      INITIAL,
      form([
        ['whoFor', 'SELF'],
        ['relationship', 'MINOR_GUARDIAN'],
        ['managedKind', 'MINOR_GUARDIAN'],
        ['authorityConfirmed', 'true'],
        ['displayName', 'Example Traveller'],
      ]),
    );
    expect(result.ok).toBe(true);
    expect(created.calls[0]).toMatchObject({ relationship: 'SELF', authorityConfirmed: false });
  });

  it('Someone I manage uses the chosen kind and still requires the authority confirmation', async () => {
    const missing = await createApplicantAction(
      INITIAL,
      form([
        ['whoFor', 'MANAGED'],
        ['managedKind', 'MINOR_GUARDIAN'],
        ['displayName', 'Example Child'],
      ]),
    );
    expect(missing).toMatchObject({ ok: false, field: 'authorityConfirmed' });
    expect(created.calls).toHaveLength(0);
    const ok = await createApplicantAction(
      INITIAL,
      form([
        ['whoFor', 'MANAGED'],
        ['managedKind', 'MINOR_GUARDIAN'],
        ['authorityConfirmed', 'true'],
        ['displayName', 'Example Child'],
      ]),
    );
    expect(ok.ok).toBe(true);
    expect(created.calls[0]).toMatchObject({
      relationship: 'MINOR_GUARDIAN',
      authorityConfirmed: true,
    });
  });

  it('Someone I manage with no kind chosen asks for one instead of saving as Me', async () => {
    const result = await createApplicantAction(
      INITIAL,
      form([
        ['whoFor', 'MANAGED'],
        ['authorityConfirmed', 'true'],
        ['displayName', 'Example Relative'],
      ]),
    );
    expect(result).toMatchObject({ ok: false, field: 'managedKind' });
    expect(created.calls).toHaveLength(0);
  });

  it('the existing form still sends relationship directly', async () => {
    await createApplicantAction(
      INITIAL,
      form([
        ['relationship', 'FAMILY_MEMBER'],
        ['authorityConfirmed', 'true'],
        ['displayName', 'Example Relative'],
      ]),
    );
    expect(created.calls[0]).toMatchObject({ relationship: 'FAMILY_MEMBER' });
  });
});
