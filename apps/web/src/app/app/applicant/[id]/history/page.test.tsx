import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  listFactHistory: vi.fn(),
  listMissionsUsingField: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));

const { default: Page } = await import('./page');
const page = () => renderServer(Page({ params: Promise.resolve({ id: 'person' }) }));

const version = (overrides: Record<string, unknown>) => ({
  id: 'v1',
  value: 'Synthetic',
  protectedKeyVersion: null,
  status: 'DECLARED',
  method: 'MANUAL',
  reason: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'owner' });
  service.listApplicantProfile.mockResolvedValue([]);
  service.listFactHistory.mockResolvedValue([]);
  service.listMissionsUsingField.mockResolvedValue({ ok: true, value: [] });
});

describe('Fact History (owner finding 6)', () => {
  it('says why it is empty and what to do, instead of only "No History Yet"', async () => {
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Nothing Saved to This Profile Yet');
    expect(text).not.toContain('No History Yet');
    expect(text).toContain(
      'History lists every saved version of a profile detail, with when and how it was saved. Nothing has been saved to this profile yet, so there is nothing to list. Add a detail on the profile, or upload a document and approve the details it suggests. Each save then appears here.',
    );
    expect(text).toContain('Add Your Essentials');
    expect(html).toContain('href="/app/applicant/person/profile"');
  });

  it('names a protected value as protected rather than showing a bare dash', async () => {
    service.listApplicantProfile.mockResolvedValue([
      { factId: 'f1', fieldKey: 'passport_number', repeatingRecordKey: null },
    ]);
    service.listFactHistory.mockResolvedValue([
      version({ id: 'v1', value: null, protectedKeyVersion: 'k1' }),
      version({ id: 'v2', value: null, protectedKeyVersion: null }),
    ]);
    const text = textOf(await page());
    expect(text).toContain('Passport Number');
    expect(text).toContain('Protected Detail (Hidden Here)');
    expect(text).toContain('No Value Recorded');
    expect(text).not.toContain('Nothing Saved to This Profile Yet');
  });

  it("shows nothing, and reads nothing, for a file that is not the owner's", async () => {
    service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'foreign' });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(service.listApplicantProfile).not.toHaveBeenCalled();
  });
});
