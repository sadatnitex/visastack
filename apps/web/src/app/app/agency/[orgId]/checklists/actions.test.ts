import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Agency checklist actions. Synthetic values only; the services are stand-ins here. */

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  copy: vi.fn(),
  start: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  publish: vi.fn(),
  discard: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  agencyChecklistPrincipal: mocks.principal,
  makeAgencyCopy: mocks.copy,
  startAgencyListUpdate: mocks.start,
  updateAgencyItem: mocks.update,
  removeAgencyItem: mocks.remove,
  addAgencyItem: mocks.add,
  publishAgencyDraft: mocks.publish,
  discardAgencyDraft: mocks.discard,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'signed-in-account', email: 'owner@example.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const {
  addItemAction,
  copyListAction,
  discardDraftAction,
  publishDraftAction,
  removeItemAction,
  saveItemAction,
  startUpdateAction,
} = await import('./actions');

const ORG = '20000000-0000-4000-8000-000000000001';
const START = { ok: true, message: '' };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const SCOPE = { accountId: 'signed-in-account', organizationId: ORG };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.copy.mockResolvedValue({ ok: true, value: { packId: 'pk1', draftVersionId: 'dv1' } });
  mocks.start.mockResolvedValue({ ok: true, value: { version: 2 } });
  mocks.update.mockResolvedValue({ ok: true, value: {} });
  mocks.remove.mockResolvedValue({ ok: true, value: { removed: true } });
  mocks.add.mockResolvedValue({ ok: true, value: {} });
  mocks.publish.mockResolvedValue({ ok: true, value: { version: 1 } });
  mocks.discard.mockResolvedValue({ ok: true, value: { discarded: true } });
});

describe('agency checklist actions', () => {
  const all = [
    ['copy', copyListAction, { organizationId: ORG, packVersionId: 'pv1' }, () => mocks.copy],
    ['start', startUpdateAction, { organizationId: ORG, packId: 'pk1' }, () => mocks.start],
    [
      'save',
      saveItemAction,
      { organizationId: ORG, packId: 'pk1', requirementId: 'r1', wording: 'x' },
      () => mocks.update,
    ],
    [
      'remove',
      removeItemAction,
      { organizationId: ORG, packId: 'pk1', requirementId: 'r1' },
      () => mocks.remove,
    ],
    [
      'add',
      addItemAction,
      {
        organizationId: ORG,
        packId: 'pk1',
        packVersionId: 'dv1',
        wording: 'x',
        docType: 'PASSPORT',
      },
      () => mocks.add,
    ],
    [
      'publish',
      publishDraftAction,
      { organizationId: ORG, packId: 'pk1', packVersionId: 'dv1' },
      () => mocks.publish,
    ],
    [
      'discard',
      discardDraftAction,
      { organizationId: ORG, packId: 'pk1', packVersionId: 'dv1' },
      () => mocks.discard,
    ],
  ] as const;

  it.each(all)(
    '%s: a person who is not an owner or admin changes nothing',
    async (_n, action, fields, service) => {
      mocks.principal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
      const result = await action(START, form(fields));
      expect(result.ok).toBe(false);
      expect(result.message).toContain('owner or an admin');
      expect(service()).not.toHaveBeenCalled();
    },
  );

  it.each(all)(
    '%s: the scope is made for the signed-in account and this agency',
    async (_n, action, fields) => {
      await action(START, form(fields));
      expect(mocks.principal).toHaveBeenCalledWith({}, 'signed-in-account', ORG);
    },
  );

  it('a field naming another account changes nothing about who acts', async () => {
    await removeItemAction(
      START,
      form({ organizationId: ORG, packId: 'pk1', requirementId: 'r1', accountId: 'someone-else' }),
    );
    expect(mocks.principal).toHaveBeenCalledWith({}, 'signed-in-account', ORG);
  });

  it('copying opens the new list to change', async () => {
    await copyListAction(START, form({ organizationId: ORG, packVersionId: 'pv1' }));
    expect(mocks.copy).toHaveBeenCalledWith({}, SCOPE, { fromPackVersionId: 'pv1' });
    expect(mocks.redirect).toHaveBeenCalledWith(`/app/agency/${ORG}/checklists/edit?pack=pk1`);
  });

  it('shows the service refusal in plain words and does not redirect', async () => {
    mocks.copy.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'Your agency already has a copy of this list.' },
    });
    const result = await copyListAction(START, form({ organizationId: ORG, packVersionId: 'pv1' }));
    expect(result).toEqual({ ok: false, message: 'Your agency already has a copy of this list.' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('saving sends the wording, who it is for and the plain necessity word', async () => {
    await saveItemAction(
      START,
      form({
        organizationId: ORG,
        packId: 'pk1',
        requirementId: 'r1',
        wording: '  Passport valid nine months.  ',
        appliesWhen: 'All applicants',
        necessity: 'OPTIONAL',
        docType: 'PASSPORT',
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({}, SCOPE, {
      requirementId: 'r1',
      patch: {
        docType: 'PASSPORT',
        necessity: 'OPTIONAL',
        notes: 'Passport valid nine months.',
        interpretation: 'All applicants',
      },
    });
  });

  it('ignores a necessity that is not one of the three plain words', async () => {
    await saveItemAction(
      START,
      form({ organizationId: ORG, packId: 'pk1', requirementId: 'r1', necessity: 'CONDITIONAL' }),
    );
    const patch = mocks.update.mock.calls[0]?.[2]?.patch;
    expect(patch).not.toHaveProperty('necessity');
  });

  it('adding refuses a document type that is not a plain name before asking the service', async () => {
    const result = await addItemAction(
      START,
      form({
        organizationId: ORG,
        packId: 'pk1',
        packVersionId: 'dv1',
        wording: 'x',
        docType: '!!!',
      }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('publishing and discarding refresh the list and the page', async () => {
    await publishDraftAction(
      START,
      form({ organizationId: ORG, packId: 'pk1', packVersionId: 'dv1' }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith(`/app/agency/${ORG}/checklists/edit`);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/app/agency/${ORG}/checklists`);
  });
});
