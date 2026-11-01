import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listApplicantProfile: vi.fn(),
  listMissionsUsingField: vi.fn(),
}));
const ok = <T,>(value: T) => ({ ok: true as const, value });
const PROOF = { synthetic: 'owner proof' };
const okPage = <T,>(value: T) => ok(value);
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));

const { default: Page } = await import('./page');
const page = (search: Record<string, string> = {}) =>
  renderServer(
    Page({ params: Promise.resolve({ id: 'person' }), searchParams: Promise.resolve(search) }),
  );

const entry = (overrides: Record<string, unknown>) => ({
  id: 'v1',
  factId: 'f1',
  fieldKey: 'given_name',
  packId: 'universal',
  repeatingRecordKey: null,
  value: 'Synthetic',
  isProtected: false,
  status: 'DECLARED',
  method: 'MANUAL',
  reason: null,
  actor: 'owner',
  isCurrent: false,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  ...overrides,
});

/** The worst case the budget is measured with: 500 saved versions, of which one page loads. */
function worstCase(cursor: string | null = 'next-cursor') {
  return {
    total: 500,
    nextCursor: cursor,
    items: Array.from({ length: 50 }, (_, i) =>
      entry({
        id: `v${i}`,
        value: `Value ${i}`,
        isCurrent: i === 0,
        actor: i % 3 === 0 ? 'someone_else' : 'owner',
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 500 - i)),
      }),
    ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  service.requireAccess.mockResolvedValue(ok(PROOF));
  service.listApplicantProfile.mockResolvedValue(ok({ total: 0, nextCursor: null, items: [] }));
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
    service.listApplicantProfile.mockResolvedValue(
      okPage({
        total: 2,
        nextCursor: null,
        items: [
          entry({ id: 'v1', fieldKey: 'passport_number', value: null, isProtected: true }),
          entry({ id: 'v2', fieldKey: 'passport_number', value: null, isProtected: false }),
        ],
      }),
    );
    const text = textOf(await page());
    expect(text).toContain('Passport Number');
    expect(text).toContain('Protected Detail (Hidden Here)');
    expect(text).toContain('No Value Recorded');
    expect(text).not.toContain('Nothing Saved to This Profile Yet');
  });

  it("shows nothing, and reads nothing, for a file that is not the owner's", async () => {
    service.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(service.listApplicantProfile).not.toHaveBeenCalled();
  });

  it('shows nothing to someone the history read refuses (not the owner)', async () => {
    service.listApplicantProfile.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Profile History in a fixed log (WP-SB1)', () => {
  it('asks the server for 50 versions of this person only, and shows them in the log panel', async () => {
    service.listApplicantProfile.mockResolvedValue(okPage(worstCase()));
    const html = await page();
    expect(service.listApplicantProfile).toHaveBeenCalledWith({}, PROOF, {
      history: { limit: 50 },
    });
    expect(html).toContain('class="activity-log-scroll"');
    expect(html).toContain('aria-label="Profile History Entries"');
    expect(html.match(/class="row activity-log-row"/g)).toHaveLength(50);
    const text = textOf(html);
    expect(text).toContain('500 saved versions in all.');
    expect(text).toContain('Show Older Entries');
    expect(text).not.toContain('Show Newest Entries');
    expect(html).toContain(
      'href="/app/applicant/person/history?before=next-cursor#profile-history-log"',
    );
    // Filters: the log's own (search, detail, who, result, when) and the part of the profile.
    for (const label of [
      'Search',
      'What Happened',
      'Who',
      'Result',
      'When',
      'Part of the Profile',
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Someone Else');
    expect(text).toContain('Current');
    expect(text).toContain('Superseded');
  });

  it('passes a cursor and a known part to the server, keeps them in the links, and offers the newest page', async () => {
    service.listApplicantProfile.mockResolvedValue(okPage(worstCase(null)));
    const html = await page({ before: 'abc_DEF-1', section: 'universal' });
    expect(service.listApplicantProfile).toHaveBeenCalledWith({}, PROOF, {
      history: { limit: 50, before: 'abc_DEF-1', pack: 'universal' },
    });
    const text = textOf(html);
    expect(text).toContain('Show Newest Entries');
    expect(text).not.toContain('Show Older Entries');
    expect(html).toContain(
      'href="/app/applicant/person/history?section=universal#profile-history-log"',
    );
  });

  it('drops a malformed cursor and an unknown part instead of passing them on', async () => {
    service.listApplicantProfile.mockResolvedValue(okPage(worstCase(null)));
    await page({ before: '<script>', section: 'nonsense' });
    expect(service.listApplicantProfile).toHaveBeenCalledWith({}, PROOF, {
      history: { limit: 50 },
    });
  });

  it('names where a detail in use is used, read once per detail', async () => {
    service.listApplicantProfile.mockResolvedValue(
      okPage({
        total: 2,
        nextCursor: null,
        items: [
          entry({ id: 'v2', isCurrent: true, value: 'Anna' }),
          entry({ id: 'v1', isCurrent: false, value: 'Ana' }),
        ],
      }),
    );
    service.listMissionsUsingField.mockResolvedValue({
      ok: true,
      value: [{ missionId: 'm1', title: 'Japan Visitor Visa' }],
    });
    const text = textOf(await page());
    expect(text).toContain('Anna · Declared · Manual · Used by Japan Visitor Visa');
    expect(service.listMissionsUsingField).toHaveBeenCalledTimes(1);
  });

  it('says when a chosen part has nothing saved yet', async () => {
    const text = textOf(await page({ section: 'universal' }));
    expect(text).not.toContain('Nothing Saved to This Profile Yet');
    expect(text).toContain('Nothing has been saved in Universal yet.');
  });
});
