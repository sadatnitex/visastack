import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  setDocumentExpiry: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  setDocumentExpiry: mocks.setDocumentExpiry,
}));
vi.mock('../../../../lib/field-registry', () => ({
  ensureDocumentFieldsRegistered: async () => 0,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => undefined,
  createPreviewRenderer: () => undefined,
}));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));

const { setDocumentExpiryAction } = await import('./actions');

const initial = { ok: true, message: '' };
const proof = { applicant: { id: 'a-1' } };
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('documentId', 'd-1');
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const saved = (changed = true) => ({
  ok: true,
  value: { status: 'saved', changed, state: {}, expiresOn: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
  mocks.setDocumentExpiry.mockResolvedValue(saved());
});

describe('setting an expiry date', () => {
  it('asks the access gate for this one document as the owner, then saves and refreshes the pages', async () => {
    const result = await setDocumentExpiryAction(initial, form({ expiresOn: '2031-04-30' }));
    expect(result).toEqual({ ok: true, message: 'Expiry date saved.' });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'account', accountId: 'owner-1' },
      'MANAGE',
      { documentId: 'd-1' },
      { purpose: 'owner_document_expiry' },
    );
    expect(mocks.setDocumentExpiry).toHaveBeenCalledWith(proof, {
      expiresOn: '2031-04-30',
      acknowledgePast: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a-1', 'layout');
  });

  it("answers a refused person, or another person's document, with the same plain line and saves nothing", async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    const refused = await setDocumentExpiryAction(initial, form({ expiresOn: '2031-04-30' }));
    expect(refused).toEqual({ ok: false, message: 'Not authorized.' });

    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { applicant: { id: 'someone-else' } },
    });
    const elsewhere = await setDocumentExpiryAction(initial, form({ expiresOn: '2031-04-30' }));
    expect(elsewhere).toEqual({ ok: false, message: 'Not authorized.' });
    expect(mocks.setDocumentExpiry).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('asks once before saving a date that has passed, and saves when the same date comes back confirmed', async () => {
    mocks.setDocumentExpiry.mockResolvedValueOnce({
      ok: true,
      value: { status: 'needs_confirmation' },
    });
    const asked = await setDocumentExpiryAction(initial, form({ expiresOn: '2024-01-01' }));
    expect(asked).toEqual({
      ok: false,
      message:
        'This date has passed. This document will count as expired for your cases. Save anyway?',
      field: 'expiresOn',
      confirmPastDate: '2024-01-01',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    await setDocumentExpiryAction(
      initial,
      form({ expiresOn: '2024-01-01', confirmPastDate: '2024-01-01' }),
    );
    expect(mocks.setDocumentExpiry).toHaveBeenLastCalledWith(proof, {
      expiresOn: '2024-01-01',
      acknowledgePast: true,
    });

    // A different date than the one confirmed asks again.
    await setDocumentExpiryAction(
      initial,
      form({ expiresOn: '2023-06-01', confirmPastDate: '2024-01-01' }),
    );
    expect(mocks.setDocumentExpiry).toHaveBeenLastCalledWith(proof, {
      expiresOn: '2023-06-01',
      acknowledgePast: false,
    });
  });

  it('clears the typed date without needing a date, and never sends a confirmation with it', async () => {
    const result = await setDocumentExpiryAction(
      initial,
      form({ intent: 'clear', expiresOn: '', confirmPastDate: '2024-01-01' }),
    );
    expect(result).toEqual({ ok: true, message: 'Your date is cleared.' });
    expect(mocks.setDocumentExpiry).toHaveBeenCalledWith(proof, {
      expiresOn: null,
      acknowledgePast: false,
    });
  });

  it('asks for a date when the box is empty and says nothing changed when nothing did', async () => {
    const empty = await setDocumentExpiryAction(initial, form({ expiresOn: '  ' }));
    expect(empty).toEqual({ ok: false, message: 'Enter the expiry date.', field: 'expiresOn' });
    expect(mocks.setDocumentExpiry).not.toHaveBeenCalled();

    mocks.setDocumentExpiry.mockResolvedValue(saved(false));
    const same = await setDocumentExpiryAction(initial, form({ expiresOn: '2031-04-30' }));
    expect(same).toEqual({ ok: true, message: 'Nothing to change.' });
  });

  it('carries a refusal from the service to the date box in plain words', async () => {
    mocks.setDocumentExpiry.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'Enter a real date, such as 2031-04-30.' },
    });
    const result = await setDocumentExpiryAction(initial, form({ expiresOn: '2031-02-30' }));
    expect(result).toEqual({
      ok: false,
      message: 'Enter a real date, such as 2031-04-30.',
      field: 'expiresOn',
    });
  });
});
