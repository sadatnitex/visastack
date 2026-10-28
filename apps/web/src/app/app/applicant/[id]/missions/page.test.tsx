import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelContaining } from '../../../../../lib/ccd/reveal';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listMissions: vi.fn(),
  hasConsent: vi.fn(),
  computeReadiness: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./create-mission-form', () => ({ CreateMissionForm: stub('CreateMissionForm') }));

const { default: CasesPage } = await import('./page');

const render = async () => renderServer(CasesPage({ params: Promise.resolve({ id: 'person' }) }));
const levelOfForm = (html: string) => {
  const doc = new JSDOM(html).window.document;
  const form = doc.querySelector<HTMLElement>('#start-case');
  const scope = doc.querySelector<HTMLElement>('[data-depth-scope]');
  expect(form).not.toBeNull();
  return levelContaining(form as HTMLElement, scope as HTMLElement);
};

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.hasConsent.mockResolvedValue(true);
});

describe('the Cases page on three levels (CCD-4)', () => {
  it('shows the Start a Case form at Browse while there are no cases', async () => {
    expect(levelOfForm(await render())).toBe('browse');
  });

  it('keeps the form at Everything once there is a case, and names the case being worked on', async () => {
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'c1',
          title: 'Japan Visit',
          state: 'IN_PROGRESS',
          packVersionId: null,
          updatedAt: new Date(),
        },
      ],
    });
    const html = await render();
    expect(levelOfForm(html)).toBe('everything');
    expect(textOf(html)).toContain('Your case: Japan Visit');
  });

  it('says the cases could not be loaded instead of claiming there is none', async () => {
    service.listMissions.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    const text = textOf(await render());
    expect(text).toContain('Your cases could not be loaded. Refresh to try again.');
    expect(text).not.toContain('No active case yet.');
  });
});
