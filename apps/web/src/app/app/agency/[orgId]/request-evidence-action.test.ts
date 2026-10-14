import { CATALOGUE_FIELDS } from '@visastack/core/catalogue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestEvidence: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestEvidence: mocks.requestEvidence,
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
      form({ ...base, kind: 'DOCUMENT', key: 'Letter From The Village Elder' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.requestEvidence.mock.calls[0]?.[1]).toMatchObject({
      kind: 'DOCUMENT',
      docType: 'Letter From The Village Elder',
    });
  });
});
