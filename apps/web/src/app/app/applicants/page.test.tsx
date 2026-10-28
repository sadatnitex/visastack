import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ listApplicants: vi.fn(), getConsents: vi.fn() }));
vi.mock('@visastack/services', () => service);
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

beforeEach(() => {
  vi.resetAllMocks();
  service.getConsents.mockResolvedValue({ CORE_PROCESSING: true });
});

describe('People on Your Account: telling the form whether a record for yourself exists', () => {
  it('says none exists when the account has no record for the person themselves', async () => {
    service.listApplicants.mockResolvedValue([person('a', 'FAMILY_MEMBER')]);
    const html = renderToStaticMarkup(await ApplicantsPage());
    expect(html).toContain('data-self-added="false"');
  });

  it('says one exists once the account holds a Myself record', async () => {
    service.listApplicants.mockResolvedValue([person('a', 'FAMILY_MEMBER'), person('b', 'SELF')]);
    const html = renderToStaticMarkup(await ApplicantsPage());
    expect(html).toContain('data-self-added="true"');
  });
});
