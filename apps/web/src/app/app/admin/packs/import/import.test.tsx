// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), permission: vi.fn(), current: vi.fn() }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  currentStarterPacks: mocks.current,
}));
vi.mock('../../../../../lib/admin', () => ({
  isPlatformAdmin: mocks.admin,
  hasPlatformPermission: mocks.permission,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'admin@example.com' }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../starter-actions', () => ({
  NO_PREVIEW: { ok: false, message: '', rows: [], skipped: [] },
  previewStarterAction: vi.fn(),
  loadStarterListAction: vi.fn(),
}));
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const { default: StarterListsPage } = await import('./page');
const { GET } = await import('./export/route');

beforeEach(() => {
  mocks.admin.mockResolvedValue(true);
  mocks.permission.mockResolvedValue(true);
  mocks.current.mockResolvedValue([
    {
      key: 'starter.jp.tourist',
      name: 'Japan Tourist Starter List',
      description: 'x',
      jurisdiction: 'JP',
      purpose: 'tourism',
      starterPurpose: 'tourist',
      contentHash: 'h',
      requirements: [
        {
          text: 'Valid passport, six months.',
          docType: 'PASSPORT',
          necessity: 'MANDATORY',
          appliesWhen: 'All applicants',
          reference: 'Japan.pdf',
        },
      ],
    },
  ]);
});
afterEach(() => vi.resetAllMocks());

describe('the starter lists page', () => {
  it('shows the loader and the sheet download to an admin who can change packs', async () => {
    const html = await renderServer(StarterListsPage());
    const text = textOf(html);
    expect(text).toContain('Starter Country Lists');
    expect(text).toContain('Load Lists');
    expect(text).toContain('Check What Would Change');
    expect(html).toContain('href="/app/admin/packs/import/export"');
    // Labelled as not official, in plain words.
    expect(text).toContain('Agency lists, not official.');
  });

  it('shows no loader to a staff role that can only read, and nothing to anyone else', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(textOf(await renderServer(StarterListsPage()))).toContain(
      'Your role can read lists but not load them.',
    );
    mocks.admin.mockResolvedValue(false);
    const refused = textOf(await renderServer(StarterListsPage()));
    expect(refused).toContain('This page is for platform staff.');
    expect(refused).not.toContain('Load Lists');
  });
});

describe('downloading the lists as a sheet', () => {
  it('gives an admin the lists in the sheet shape the loader reads', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.text();
    expect(body.split('\n')[0]).toBe(
      'Country,Purpose,Applies when,Document / requirement,Keep?,Reference file',
    );
    expect(body).toContain(
      'Japan,Tourist (base),All applicants,"Valid passport, six months.",Yes,Japan.pdf',
    );
  });

  it('refuses anyone who is not platform staff, without reading a list', async () => {
    mocks.admin.mockResolvedValue(false);
    expect((await GET()).status).toBe(403);
    expect(mocks.current).not.toHaveBeenCalled();
  });
});
