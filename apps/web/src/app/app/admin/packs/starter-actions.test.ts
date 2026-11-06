import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  staff: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  clone: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  previewStarterImport: mocks.preview,
  applyStarterPack: mocks.apply,
  cloneVersionToDraft: mocks.clone,
  updateDraftRequirement: mocks.update,
  removeDraftRequirement: mocks.remove,
}));
vi.mock('../../../../lib/admin', () => ({
  hasPlatformPermission: mocks.permission,
  staffPrincipal: mocks.staff,
  bootstrapAdminEmails: () => [],
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'admin@example.com' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { NO_PREVIEW } from './preview-state';
import {
  loadStarterListAction,
  previewStarterAction,
  removeDraftItemAction,
  startPackUpdateAction,
  updateDraftItemAction,
} from './starter-actions';

const START = { ok: true, message: '' };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const SHEET =
  'Country,Purpose,Applies when,Document / requirement,Keep?,Reference file\nJapan,Tourist (base),All applicants,Valid passport.,Yes,Japan.pdf\n';

const STAFF = { accountId: 'synthetic-admin' };
beforeEach(() => {
  mocks.permission.mockResolvedValue(true);
  mocks.staff.mockResolvedValue({ ok: true, value: STAFF });
  mocks.preview.mockResolvedValue([
    {
      key: 'starter.jp.tourist',
      name: 'Japan Tourist Starter List',
      status: 'new',
      requirementCount: 1,
      added: 1,
      removed: 0,
      currentVersion: null,
    },
  ]);
  mocks.apply.mockResolvedValue({
    ok: true,
    value: { key: 'starter.jp.tourist', outcome: 'created', version: 1 },
  });
  mocks.clone.mockResolvedValue({ ok: true, value: { version: 2 } });
  mocks.update.mockResolvedValue({ ok: true, value: {} });
  mocks.remove.mockResolvedValue({ ok: true, value: { removed: true } });
});
afterEach(() => vi.resetAllMocks());

describe('checking the starter lists', () => {
  it('reads the supplied lists without a file, and says how many are to load', async () => {
    const state = await previewStarterAction(NO_PREVIEW, form({ source: 'supplied' }));
    expect(state.ok).toBe(true);
    // The supplied set holds 33 Tourist lists and the extras; the service is asked about every one.
    expect(mocks.preview.mock.calls[0]?.[1].length).toBeGreaterThan(33);
    expect(state.message).toMatch(/lists found/);
  });

  it('reads an uploaded sheet, and refuses a missing, oversize or headerless one', async () => {
    const ok = await previewStarterAction(NO_PREVIEW, form({ source: 'sheet', csv: SHEET }));
    expect(ok.ok).toBe(true);
    expect(mocks.preview.mock.calls[0]?.[1].map((p: { key: string }) => p.key)).toEqual([
      'starter.jp.tourist',
    ]);
    mocks.preview.mockClear();
    for (const csv of ['', 'a,b\n1,2\n', 'x'.repeat(600_001)]) {
      const refused = await previewStarterAction(NO_PREVIEW, form({ source: 'sheet', csv }));
      expect(refused.ok).toBe(false);
      expect(refused.message).not.toBe('');
    }
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('is refused for anyone without the studio permission', async () => {
    mocks.permission.mockResolvedValue(false);
    const state = await previewStarterAction(NO_PREVIEW, form({ source: 'supplied' }));
    expect(state.ok).toBe(false);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});

describe('loading one starter list', () => {
  it('loads the list the key names, from the sheet it came from', async () => {
    const result = await loadStarterListAction(
      START,
      form({ source: 'sheet', csv: SHEET, key: 'starter.jp.tourist' }),
    );
    expect(result).toEqual({ ok: true, message: 'Loaded: version 1.' });
    expect(mocks.apply.mock.calls[0]?.[2].definition.key).toBe('starter.jp.tourist');
    expect(mocks.apply.mock.calls[0]?.[2].definition.requirements).toHaveLength(1);
  });

  it('refuses a key the sheet does not hold, and refuses without the permission', async () => {
    const missing = await loadStarterListAction(
      START,
      form({ source: 'sheet', csv: SHEET, key: 'starter.fr.tourist' }),
    );
    expect(missing.ok).toBe(false);
    mocks.staff.mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'no' } });
    const denied = await loadStarterListAction(
      START,
      form({ source: 'sheet', csv: SHEET, key: 'starter.jp.tourist' }),
    );
    expect(denied.ok).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('reports the plain refusal of the service', async () => {
    mocks.apply.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'a checklist with this key exists and is not a starter list',
      },
    });
    const result = await loadStarterListAction(
      START,
      form({ source: 'sheet', csv: SHEET, key: 'starter.jp.tourist' }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'a checklist with this key exists and is not a starter list',
    });
  });
});

describe('updating a published checklist', () => {
  it('starts a draft copy and tells the admin what to do next', async () => {
    const result = await startPackUpdateAction(START, form({ packId: 'p', packVersionId: 'v' }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Draft version 2 started');
    expect(mocks.clone.mock.calls[0]?.[1]).toBe(STAFF);
    expect(mocks.clone.mock.calls[0]?.[2]).toEqual({ fromPackVersionId: 'v' });
  });

  it('changes an item, naming the document type from the catalogue, and removes an item', async () => {
    const saved = await updateDraftItemAction(
      START,
      form({
        packId: 'p',
        requirementId: 'r',
        docType: 'Bank Statement',
        necessity: 'OPTIONAL',
        wording: 'Six months.',
        appliesWhen: 'Employee',
      }),
    );
    expect(saved).toEqual({ ok: true, message: 'Item saved.' });
    expect(mocks.update.mock.calls[0]?.[2].patch).toMatchObject({
      docType: 'BANK_STATEMENT',
      necessity: 'OPTIONAL',
      notes: 'Six months.',
      interpretation: 'Employee',
    });
    expect((await removeDraftItemAction(START, form({ packId: 'p', requirementId: 'r' }))).ok).toBe(
      true,
    );
  });

  it('refuses an unknown document type and every change without the permission', async () => {
    const bad = await updateDraftItemAction(
      START,
      form({ packId: 'p', requirementId: 'r', docType: 'Not A Real Type Anywhere' }),
    );
    expect(bad.ok).toBe(false);
    mocks.staff.mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'no' } });
    for (const result of [
      await startPackUpdateAction(START, form({ packId: 'p', packVersionId: 'v' })),
      await updateDraftItemAction(START, form({ packId: 'p', requirementId: 'r', wording: 'x' })),
      await removeDraftItemAction(START, form({ packId: 'p', requirementId: 'r' })),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(mocks.clone).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
