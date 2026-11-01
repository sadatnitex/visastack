import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  listApplicants: vi.fn(),
  getConsents: vi.fn(),
  TRAVELLER_REFUSALS: { notEmpty: 'not empty' },
  TRAVELLER_RECENTLY_DELETED_DAYS: 30,
}));
vi.mock('@visastack/services', () => service);
vi.mock('../applicant/[id]/traveller-manage/actions', () => ({
  travellerLifecycleAction: async () => undefined,
}));
vi.mock('../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../add-applicant-form', () => ({
  AddApplicantForm: ({ selfAdded }: { readonly selfAdded?: boolean }) => (
    <div data-form="add-applicant" data-self-added={String(selfAdded ?? false)} />
  ),
}));
const { default: ApplicantsPage } = await import('./page');

const person = (id: string, relationship: string) => ({
  id,
  displayName: `Synthetic ${id}`,
  relationship,
  ownerAccountId: 'owner',
});

/** Everyday travellers, then the archived and Recently Deleted lists (empty unless given). */
function lists(
  everyday: readonly unknown[],
  archived: readonly unknown[] = [],
  deleted: readonly unknown[] = [],
) {
  service.listApplicants.mockImplementation(
    async (_db: unknown, _account: string, options?: { view?: string }) =>
      options?.view === 'archived'
        ? archived
        : options?.view === 'recentlyDeleted'
          ? deleted
          : everyday,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  service.getConsents.mockResolvedValue({ CORE_PROCESSING: true });
});

describe('People on Your Account: telling the form whether a record for yourself exists', () => {
  it('says none exists when the account has no record for the person themselves', async () => {
    lists([person('a', 'FAMILY_MEMBER')]);
    const html = renderToStaticMarkup(await ApplicantsPage());
    expect(html).toContain('data-self-added="false"');
  });

  it('says one exists once the account holds a Myself record', async () => {
    lists([person('a', 'FAMILY_MEMBER'), person('b', 'SELF')]);
    const html = renderToStaticMarkup(await ApplicantsPage());
    expect(html).toContain('data-self-added="true"');
  });
});

describe('Archived and Recently Deleted travellers (LC-E)', () => {
  const now = Date.now();
  const archivedPerson = (id: string) => ({
    ...person(id, 'FAMILY_MEMBER'),
    archivedAt: new Date('2026-11-01T10:00:00Z'),
    deletedAt: null,
    purgeAfter: null,
  });
  const deletedPerson = (id: string) => ({
    ...person(id, 'FAMILY_MEMBER'),
    archivedAt: null,
    deletedAt: new Date(now),
    purgeAfter: new Date(now + 12 * 24 * 60 * 60 * 1000 - 60_000),
  });

  it('shows neither list while nothing is archived or deleted (and before the migration)', async () => {
    lists([person('b', 'SELF')]);
    const html = renderToStaticMarkup(await ApplicantsPage({}));
    expect(html).not.toContain('Archived Travellers');
    expect(html).not.toContain('Recently Deleted Records');
    expect(html).not.toContain('Restore Traveller');
  });

  it('lists archived and deleted travellers apart from everyday ones, each with Restore Traveller', async () => {
    lists([person('b', 'SELF')], [archivedPerson('arch')], [deletedPerson('gone')]);
    const html = renderToStaticMarkup(await ApplicantsPage({}));
    expect(html).toContain('Archived Travellers');
    expect(html).toContain('href="/app/applicant/arch"');
    expect(html).toContain('Recently Deleted Records');
    expect(html).toContain('removed for good after 30 days');
    expect(html).toContain('Removed in 12 Days');
    // A record in Recently Deleted is not opened from here; it is restored first.
    expect(html).not.toContain('href="/app/applicant/gone"');
    expect(html.match(/Restore Traveller/g)).toHaveLength(2);
    expect(html).toContain('name="command" value="restore"');
    expect(html).toContain('name="command" value="restoreDeleted"');
    expect(html).toContain('name="returnTo" value="list"');
    // The everyday count is not inflated by them.
    expect(html).toContain('1 person');
  });

  it('shows 10 archived travellers, then Show More', async () => {
    const many = Array.from({ length: 12 }, (_, index) => archivedPerson(`a${index}`));
    lists([person('b', 'SELF')], many);
    const first = renderToStaticMarkup(await ApplicantsPage({}));
    expect(first.match(/class="row lc-traveller-row"/g)).toHaveLength(10);
    expect(first).toContain('Show More');
    const more = renderToStaticMarkup(
      await ApplicantsPage({ searchParams: Promise.resolve({ archived: '20' }) }),
    );
    expect(more.match(/class="row lc-traveller-row"/g)).toHaveLength(12);
    // A result line from the last action is not carried into Show More.
    const after = renderToStaticMarkup(
      await ApplicantsPage({ searchParams: Promise.resolve({ traveller: 'restored' }) }),
    );
    expect(after).toContain('Restored.');
    expect(after).not.toMatch(/href="[^"]*traveller=restored/);
  });

  it('shows the result of the last action, and only words it knows', async () => {
    lists([person('b', 'SELF')]);
    const done = renderToStaticMarkup(
      await ApplicantsPage({ searchParams: Promise.resolve({ traveller: 'restored' }) }),
    );
    expect(done).toContain('Restored. They are back in your everyday lists.');
    const forged = renderToStaticMarkup(
      await ApplicantsPage({ searchParams: Promise.resolve({ traveller: '<b>pwned</b>' }) }),
    );
    expect(forged).not.toContain('pwned');
    expect(forged).not.toContain('id="traveller-outcome"');
  });
});
