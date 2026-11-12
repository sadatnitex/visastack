import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const mocks = vi.hoisted(() => ({
  listMembershipsForAccount: vi.fn(),
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadPendingTeamInvitations: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  listMembershipsForAccount: mocks.listMembershipsForAccount,
  createOrganization: vi.fn(),
  withdrawOrganizationApplication: vi.fn(),
  agencyCollectionRequestsEnabled: () => false,
  getOrganizationBrandingForDisplay: async () => null,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { db: true }, accountId: 'owner-1', email: 'owner@example.com' }),
}));
vi.mock('./actions', () => ({
  createOrganizationAction: vi.fn(),
  withdrawOrganizationApplicationAction: vi.fn(),
}));
vi.mock('./[orgId]/actions', () => ({
  addMemberAction: vi.fn(),
  updateBrandingAction: vi.fn(),
  inviteClientAction: vi.fn(),
  requestEvidenceAction: vi.fn(),
}));
vi.mock('./[orgId]/console-data', () => mocks);
vi.mock('./[orgId]/member-form', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { AddMemberForm: stub('AddMemberForm') };
});
vi.mock('./[orgId]/invitation-revoke-button', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { InvitationRevokeButton: stub('InvitationRevokeButton') };
});
vi.mock('./[orgId]/member-toggle-button', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { MemberToggleButton: stub('MemberToggleButton') };
});
vi.mock('./[orgId]/team/document-request-toggle', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { DocumentRequestToggle: stub('DocumentRequestToggle') };
});

import { I18nProvider } from '../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../i18n/app-agency';
import { agencyBrand } from '../../../lib/agency-brand';
import { primeLocale } from '../../../lib/i18n-server';

const { default: AgencyPage } = await import('./page');
const { default: TeamPage } = await import('./[orgId]/team/page');
const { CreateOrgForm } = await import('./create-org-form');
const { AgencyWorkspaceHeading } = await import('./[orgId]/workspace-heading');
const { EvidenceTray } = await import('./[orgId]/evidence-tray');
const { CaseTriageSummary } = await import('./[orgId]/case-triage-summary');
const { FormGroup } = await import('./[orgId]/clients/form-group');
const { CaseSearchForm } = await import('./[orgId]/case-search-form');

const BENGALI = /[ঀ-৿]/;
const bn = appAgencyCatalog.bn as Record<string, string>;
const en = appAgencyCatalog.en as Record<string, string>;
const k = (key: string) => `appAgency.${key}`;

async function render(locale: 'en' | 'bn', node: () => Promise<string> | string, primed = false) {
  current.holder = null;
  current.locale = locale;
  // A page must prime the locale itself; only a bare component is primed here, as its page would.
  if (primed) await primeLocale();
  return textOf(await node());
}

function client(locale: 'en' | 'bn', node: React.ReactNode): string {
  return textOf(
    renderToStaticMarkup(
      <I18nProvider locale={locale} pageLang="en">
        {node}
      </I18nProvider>,
    ),
  );
}

const PENDING = '00000000-0000-4000-8000-0000000000a1';
const ACTIVE = '00000000-0000-4000-8000-0000000000a2';
const membership = (id: string, status: string) => ({
  organization: { id, name: `Agency ${id.slice(-2)}`, status },
  membershipId: `m-${id}`,
  role: 'OWNER',
  active: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/team';
});
afterEach(() => {
  current.locale = 'en';
});

describe('the agencies list under Bengali', () => {
  it('shows Bengali for the headings and keeps the access and withdrawal wording in English (list open)', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      membership(PENDING, 'PENDING_VERIFICATION'),
      membership(ACTIVE, 'ACTIVE'),
    ]);
    const text = await render('bn', () =>
      renderServer(AgencyPage({ searchParams: Promise.resolve({}) })),
    );
    expect(text).toContain(bn[k('appAgencyPage.yourOrganizations')]);
    expect(text).toContain(bn[k('appAgencyPage.memberships')]);
    expect(text).toContain(bn[k('appAgencyPage.applyToRegisterAnAgency')]);
    // The withdrawal question says what happens to access: it waits for the owner sign-off.
    const withdraw = k('appAgencyPage.withdrawTheApplicationForNameIt');
    expect(withdraw in bn).toBe(false);
    expect(text).toContain(
      'Withdraw the application for Agency a1? It will no longer be reviewed, and anyone you added to it loses access.',
    );
    expect(text).not.toMatch(/appAgency\./);
  });

  it('shows the empty state in Bengali headings too, and the English page stays English', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([]);
    const bnText = await render('bn', () =>
      renderServer(AgencyPage({ searchParams: Promise.resolve({}) })),
    );
    expect(bnText).toContain(bn[k('appAgencyPage.yourOrganizations')]);
    // The sentence that says what membership grants is held back in English.
    expect(bnText).toContain(en[k('appAgencyPage.agenciesCollaborateOnCasesAndRequest')]);
    const enText = await render('en', () =>
      renderServer(AgencyPage({ searchParams: Promise.resolve({}) })),
    );
    expect(enText).toContain('Your Organizations');
    expect(enText).not.toMatch(BENGALI);
  });
});

describe('the team page under Bengali', () => {
  it('shows the Bengali team headings and keeps the access sentence in English', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    mocks.loadPendingTeamInvitations.mockResolvedValue([]);
    const text = await render('bn', () =>
      renderServer(TeamPage({ params: Promise.resolve({ orgId: 'o1' }) })),
    );
    expect(text).toContain(bn[k('appAgencyOrgidTeamPage.team')]);
    expect(text).toContain(bn[k('appAgencyOrgidTeamPage.members')]);
    expect(text).toContain('it never grants access');
  });
});

describe('agency forms and headings under Bengali', () => {
  it('translates the organization form placeholder', () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="bn" pageLang="en">
        <CreateOrgForm />
      </I18nProvider>,
    );
    expect(html).toContain(`placeholder="${bn[k('appAgencyCreateOrgForm.organizationName')]}"`);
    const enHtml = renderToStaticMarkup(
      <I18nProvider locale="en" pageLang="en">
        <CreateOrgForm />
      </I18nProvider>,
    );
    expect(enHtml).toContain('placeholder="Organization name"');
  });

  it('translates the workspace heading link on a sub page and leaves the overview alone', () => {
    const brand = agencyBrand({ name: 'Acme Travel', accentColor: null, logoUrl: null });
    const props = {
      organizationId: 'o1',
      brand,
      admin: true,
      status: <span>Active</span>,
    };
    navigationState.pathname = '/app/agency/o1/team';
    const sub = client('bn', <AgencyWorkspaceHeading {...props} />);
    expect(sub).toContain(bn[k('appAgencyOrgidWorkspaceHeading.agencyOverview')]);
    expect(sub).toContain(bn[k('appAgencyOrgidBrandingForm.poweredByVisastack')]);
    navigationState.pathname = '/app/agency/o1';
    const overview = client('bn', <AgencyWorkspaceHeading {...props} />);
    expect(overview).not.toContain(bn[k('appAgencyOrgidWorkspaceHeading.agencyOverview')]);
    expect(client('en', <AgencyWorkspaceHeading {...props} />)).not.toMatch(BENGALI);
  });

  it('shows the selected count inside the Bengali label, and an empty tray with none', () => {
    const items = [
      { id: 'a', label: 'Passport', hint: '' },
      { id: 'b', label: 'Bank statement', hint: '' },
      { id: 'c', label: 'Photo', hint: '' },
    ];
    const full = client(
      'bn',
      <EvidenceTray items={items} onRemove={() => undefined} onClear={() => undefined} />,
    );
    // The count is passed as a raw number: the runtime formats it for the language that shows.
    expect(full).toContain('বাছাই করা (৩)');
    expect(full).toContain(bn[k('appAgencyOrgidEvidenceTray.remove')]);
    const empty = client(
      'bn',
      <EvidenceTray items={[]} onRemove={() => undefined} onClear={() => undefined} />,
    );
    expect(empty).toContain(bn[k('appAgencyOrgidEvidenceTray.nothingSelectedYetTickWhatYou')]);
    expect(empty).toContain('বাছাই করা (০)');
    expect(
      client(
        'en',
        <EvidenceTray items={items} onRemove={() => undefined} onClear={() => undefined} />,
      ),
    ).toContain('Selected (3)');
  });

  it('shows the group count in Bengali digits', () => {
    const noun = { one: 'invitation', other: 'invitations' };
    const open = client(
      'bn',
      <FormGroup id="g1" title="Invite" openAtFirst count={12} noun={noun}>
        <p>body</p>
      </FormGroup>,
    );
    expect(open).toContain('১২');
    expect(
      client(
        'en',
        <FormGroup id="g1" title="Invite" openAtFirst count={12} noun={noun}>
          <p>body</p>
        </FormGroup>,
      ),
    ).toContain('12');
  });

  it('shows the triage summary in each state in English where no Bengali is approved', () => {
    const base = { state: 'IN_PROGRESS', stateLabel: 'In Progress', requestsLeftOut: false };
    const empty = client(
      'bn',
      <CaseTriageSummary view={{ ...base, groups: [] } as never} headingId="h1" />,
    );
    // No approved Bengali yet for these lines: English shows, never a raw key.
    expect(empty).toContain('Where Things Stand');
    expect(empty).toContain('Nothing has been asked for or checked yet.');
    expect(empty).not.toMatch(/appAgency\./);
    const withItems = client(
      'bn',
      <CaseTriageSummary
        view={
          {
            ...base,
            requestsLeftOut: true,
            groups: [
              {
                group: 'NEEDS_ATTENTION',
                label: 'Needs Attention',
                items: [{ key: 'i1', label: 'Passport', notes: [], due: '3 Dec 2026' }],
              },
            ],
          } as never
        }
        headingId="h2"
      />,
    );
    // A date inside the sentence is not formatted for Bengali here, so the line stays English.
    expect(withItems).toContain('Due 3 Dec 2026');
    expect(k('appAgencyOrgidCaseTriageSummary.dueDue') in bn).toBe(false);
  });

  it('keeps the filter form labels in Bengali', async () => {
    const props = { orgId: 'o1', members: [], query: '', stage: '', destination: '', assignee: '' };
    const text = await render(
      'bn',
      () => renderToStaticMarkup(<CaseSearchForm {...props} />),
      true,
    );
    expect(text).toContain(bn[k('appAgencyOrgidCaseSearchForm.stage')]);
    expect(text).toContain(bn[k('appAgencyOrgidCaseSearchForm.search')]);
    const enText = await render(
      'en',
      () => renderToStaticMarkup(<CaseSearchForm {...props} />),
      true,
    );
    expect(enText).not.toMatch(BENGALI);
  });
});

describe('wording that waits for the owner sign-off stays English', () => {
  const held = [
    'They alone choose',
    'Only that email address can accept.',
    'Whole Traveller Record (Default)',
    'checked for viruses',
    'Bulk Export',
    'AI Tools',
    'AI Features',
    'Amount Received',
    'Cannot be accepted',
    'Sent {formatMoment}',
    '{accepted} Accepted',
  ];
  it.each(held)('has no Bengali for "%s"', (fragment) => {
    const keys = Object.keys(en).filter((key) => en[key]?.includes(fragment));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key in bn, key).toBe(false);
  });
});
