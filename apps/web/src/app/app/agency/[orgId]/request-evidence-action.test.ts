import { CATALOGUE_FIELDS } from '@visastack/core/catalogue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestEvidence: vi.fn(),
  requestEvidenceBatch: vi.fn(),
  requireAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestEvidence: mocks.requestEvidence,
  requestEvidenceBatch: mocks.requestEvidenceBatch,
  requireAccess: mocks.requireAccess,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));
vi.mock('../../../../lib/capabilities', () => ({
  getPlatformCapabilities: () => ({ agencyCollaboration: 'available' }),
  capabilityUnavailableMessage: () => 'unavailable',
}));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'http://localhost' }));
vi.mock('../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => undefined,
  createMalwareScanner: () => undefined,
}));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'admin-test' }),
}));

const { requestEvidenceAction } = await import('./actions');

const initial = { ok: true, message: '' };
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const base = { organizationId: 'org-1', applicantId: 'a1' };
const addedField = CATALOGUE_FIELDS.find((field) => !field.role)?.key ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestEvidence.mockResolvedValue({ ok: true, value: {} });
  mocks.requireAccess.mockImplementation(async () => ({
    ok: true,
    value: { applicant: { id: 'a1' }, tag: 'proof' },
  }));
  mocks.requestEvidenceBatch.mockImplementation(async (_db, input: { items: unknown[] }) => ({
    ok: true,
    value: input.items.map(() => ({})),
  }));
});

describe('asking an applicant for a detail', () => {
  it('stores the standard name for a detail typed or picked in any accepted form', async () => {
    const result = await requestEvidenceAction(
      initial,
      form({ ...base, kind: 'FIELD', key: 'Passport Number' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.requestEvidence.mock.calls[0]?.[1]).toMatchObject({
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });
  });

  it('accepts a detail that only the catalogue added', async () => {
    expect(addedField).not.toBe('');
    const result = await requestEvidenceAction(
      initial,
      form({ ...base, kind: 'FIELD', key: addedField }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.requestEvidence.mock.calls[0]?.[1]).toMatchObject({ fieldKey: addedField });
  });

  it('refuses a detail the product does not know, without sending anything', async () => {
    const result = await requestEvidenceAction(
      initial,
      form({ ...base, kind: 'FIELD', key: 'favourite_colour_of_the_moon' }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not a known profile field/);
    expect(mocks.requestEvidence).not.toHaveBeenCalled();
  });
});

describe('asking an applicant for a document', () => {
  it('stores the standard key for a document the catalogue knows, by any of its names', async () => {
    await requestEvidenceAction(initial, form({ ...base, kind: 'DOCUMENT', key: 'Pay Slip' }));
    const docType = mocks.requestEvidence.mock.calls[0]?.[1].docType as string;
    expect(docType).toBe(docType.toUpperCase());
    expect(docType).not.toBe('Pay Slip');
  });

  it('keeps the typed name for something the catalogue does not list', async () => {
    const result = await requestEvidenceAction(
      initial,
      form({ ...base, kind: 'DOCUMENT', key: 'Village Elder Letter' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.requestEvidence.mock.calls[0]?.[1]).toMatchObject({
      kind: 'DOCUMENT',
      docType: 'Village Elder Letter',
    });
  });
});

function items(values: readonly string[], extra: Record<string, string> = {}): FormData {
  const data = form({ ...base, ...extra });
  for (const value of values) data.append('item', value);
  return data;
}

describe('asking for several things in one send', () => {
  it('sends every chosen item, one shared message and date, through the batch', async () => {
    const result = await requestEvidenceAction(
      initial,
      items(['DOCUMENT:NID', 'FIELD:passport_number', 'DOCUMENT:PHOTO'], {
        message: 'for the form',
        dueDate: '2030-01-15',
        missionId: 'm1',
      }),
    );
    expect(result).toEqual({
      ok: true,
      message: '3 requests sent. They stay open until the traveller replies.',
    });
    expect(mocks.requestEvidence).not.toHaveBeenCalled();
    expect(mocks.requestEvidenceBatch).toHaveBeenCalledTimes(1);
    // The proof is asked for the case named (the traveller then comes from the proof itself).
    expect(mocks.requireAccess.mock.calls[0]?.[3]).toEqual({ missionId: 'm1' });
    expect(mocks.requireAccess.mock.calls[0]?.[4]).toMatchObject({
      actingFor: { organizationId: 'org-1' },
    });
    expect(mocks.requestEvidenceBatch.mock.calls[0]?.[0]).toMatchObject({ tag: 'proof' });
    expect(mocks.requestEvidenceBatch.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      message: 'for the form',
      items: [
        { kind: 'DOCUMENT', key: 'NID' },
        { kind: 'FIELD', key: 'passport_number' },
        { kind: 'DOCUMENT', key: 'PHOTO' },
      ],
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('one item reads like the single request, and an item named twice is asked once', async () => {
    const one = await requestEvidenceAction(initial, items(['DOCUMENT:NID', 'DOCUMENT:NID']));
    expect(one.message).toBe('Request sent. It stays open until the traveller replies.');
    expect(mocks.requestEvidenceBatch.mock.calls[0]?.[1].items).toHaveLength(1);
    // No case named: the proof is for the traveller.
    expect(mocks.requireAccess.mock.calls[0]?.[3]).toEqual({ applicantId: 'a1' });
  });

  it('refuses an empty send, more than the cap, and a badly shaped item, sending nothing', async () => {
    const none = await requestEvidenceAction(initial, items(['', '  ']));
    expect(none).toEqual({ ok: false, message: 'Choose at least one item.' });
    const many = Array.from({ length: 26 }, (_, i) => `DOCUMENT:X_${i}`);
    const over = await requestEvidenceAction(initial, items(many));
    expect(over).toEqual({ ok: false, message: 'You can ask for up to 25 items in one send.' });
    for (const bad of ['NID', 'THING:NID', 'FIELD:', ':NID']) {
      const result = await requestEvidenceAction(initial, items(['DOCUMENT:NID', bad]));
      expect(result.ok, bad).toBe(false);
      expect(result.message).toBe('One of the items is not one we know. Choose from the list.');
    }
    expect(mocks.requestEvidenceBatch).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('a traveller or case the organization cannot reach is refused before anything is written', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    const refused = await requestEvidenceAction(initial, items(['DOCUMENT:NID']));
    expect(refused).toEqual({
      ok: false,
      message: 'this organization has no current grant for that applicant',
    });
    // A proof for a different traveller than the one named in the form is refused the same way.
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { applicant: { id: 'someone-else' } },
    });
    const other = await requestEvidenceAction(initial, items(['DOCUMENT:NID']));
    expect(other.ok).toBe(false);
    expect(mocks.requestEvidenceBatch).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('shows the service refusal in plain words and refreshes nothing', async () => {
    mocks.requestEvidenceBatch.mockResolvedValue({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'this organization has no current grant for that applicant',
      },
    });
    const result = await requestEvidenceAction(initial, items(['DOCUMENT:NID']));
    expect(result.ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('the earlier single-item post still works exactly as before', async () => {
    const result = await requestEvidenceAction(
      initial,
      form({ ...base, kind: 'DOCUMENT', key: 'NID', message: 'please' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Request sent. It stays open until the traveller replies.',
    });
    expect(mocks.requestEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.requestEvidenceBatch).not.toHaveBeenCalled();
  });
});
