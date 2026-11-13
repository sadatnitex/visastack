// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceAccess, workspaceNavigation } from '../../lib/workspace-navigation';

const route = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./actions', () => ({ createApplicantAction: vi.fn() }));

const { I18nProvider } = await import('../../components/i18n-provider');
const { appHomeCatalog } = await import('../../i18n/app-home');
const { AddApplicantForm } = await import('./add-applicant-form');
const { AppNav, WorkspaceToolbar } = await import('./app-nav');
const { AccountMenu } = await import('./account-menu');
const { WorkspaceShell } = await import('./workspace-shell');
const { WorkspaceRecordToolbar } = await import('./workspace-record-toolbar');
const { default: WorkspaceError } = await import('./error');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The signed-in frame (navigation, record search, account menu, the add-a-person form and the
 * error screen) under Bengali, in each state a reader can reach. Every Bengali value asserted here
 * comes from the catalogue, which the register filled; English readers see the English as before.
 */

const bn = appHomeCatalog.bn as Record<string, string>;
const en = appHomeCatalog.en as Record<string, string>;
const v = (key: string) => {
  const value = bn[`appHome.${key}`];
  if (value === undefined) throw new Error(`no Bengali for appHome.${key}`);
  return value;
};
const SELF = '10000000-0000-4000-8000-000000000001';
const ORG = '20000000-0000-4000-8000-000000000001';
const WITH_AGENCY: WorkspaceAccess = {
  travellers: [{ id: SELF, name: 'Synthetic Self', relationship: 'SELF' }],
  agencies: [{ id: ORG, name: 'Synthetic Agency', admin: true }],
  platform: null,
};
const NONE: WorkspaceAccess = { travellers: [], agencies: [], platform: null };

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  route.pathname = '/app';
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(node: ReactNode, locale: 'en' | 'bn' = 'bn') {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang="en">
        {node}
      </I18nProvider>,
    ),
  );
}

/** What a reader sees or hears: the text, field hints and spoken names. */
function readable(): string {
  const spoken = [...container.querySelectorAll('[placeholder], [aria-label]')].map(
    (el) => `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`,
  );
  return [container.textContent ?? '', ...spoken].join('\n');
}

/** `shared`: the English word also appears elsewhere on the frame (a held label), so only presence is checked. */
function expectBengali(keys: readonly string[], shared = false) {
  const text = readable();
  for (const key of keys) {
    expect(text, key).toContain(v(key));
    if (!shared) expect(text, key).not.toContain(en[`appHome.${key}`]);
  }
  expect(text).not.toMatch(/appHome\.app[A-Z]/);
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the add-a-person form under Bengali', () => {
  it('first run: the Me and Someone I Manage choices, with the managed kinds', () => {
    mount(<AddApplicantForm firstRun />);
    expectBengali([
      'appAddApplicantForm.whoIsThisRecordFor',
      'appAddApplicantForm.me',
      'appAddApplicantForm.myOwnPapers',
      'appAddApplicantForm.someoneIManage',
      'appAddApplicantForm.aFamilyMember',
      'appAddApplicantForm.nameAsOnThePassport',
      'appAddApplicantForm.youCanChangeThisLaterNothing',
    ]);
    const managed = container.querySelector<HTMLInputElement>('input[value="MANAGED"]');
    if (!managed) throw new Error('Someone I Manage choice');
    act(() => managed.click());
    expectBengali([
      'appAddApplicantForm.howAreTheyRelatedToYou',
      'appAddApplicantForm.familyMember',
      'appAddApplicantForm.adultRelative',
      'appAddApplicantForm.minorGuardian',
      'appAddApplicantForm.aChildInMyCare',
    ]);
  });

  it('the full form: name, relationship and the Myself choice', () => {
    mount(<AddApplicantForm />);
    expectBengali([
      'appAddApplicantForm.fullName',
      'appAddApplicantForm.relationship',
      'appAddApplicantForm.myself',
      'appAddApplicantForm.familyMember',
      'appAddApplicantForm.minorGuardian',
    ]);
  });

  it('the full form once a record for yourself exists: Myself (Already Added) and what it does', () => {
    mount(<AddApplicantForm selfAdded />);
    const select = container.querySelector<HTMLSelectElement>('select[name="relationship"]');
    if (!select) throw new Error('relationship box');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        select,
        'SELF',
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expectBengali([
      'appAddApplicantForm.myselfAlreadyAdded',
      'appAddApplicantForm.youAlreadyHaveARecordFor',
    ]);
  });

  it('stays English for English readers', () => {
    mount(<AddApplicantForm firstRun />, 'en');
    expect(container.textContent).toContain('Who is this record for?');
    expect(container.textContent).not.toMatch(/[ঀ-৿]/);
  });
});

describe('the workspace navigation under Bengali', () => {
  const links = [
    { href: '/app', label: 'Overview' },
    { href: '/app/notifications', label: 'Notifications' },
  ];

  it('personal workspace: account details, the menu button, new-item counts and settings links', () => {
    mount(
      <AppNav
        links={links}
        badges={{ '/app/notifications': 3 }}
        secondaryLinks={[{ href: '/app/help', label: 'Help' }]}
        sidebarCollapsed
        onToggleSidebar={() => undefined}
      />,
    );
    expectBengali([
      'appAppNav.personalWorkspace',
      'appAppNav.accountDetails',
      'appAppNav.showMenu',
      'appAppNav.settingsAndSupport',
    ]);
    // The count is spoken with the destination's name: "{label}, {spoken} new".
    const named = container
      .querySelector('a[href="/app/notifications"]')
      ?.getAttribute('aria-label');
    const [before, after] = v('appAppNav.labelSpokenNew').split('{spoken}') as [string, string];
    expect(named).toContain(before.replace('{label}', 'Notifications'));
    expect(named).toContain(after);
  });

  it('agency workspace: the sidebar names the agency workspace', () => {
    route.pathname = `/app/agency/${ORG}`;
    mount(<AppNav links={links} />);
    expectBengali(['appAppNav.agencyWorkspace']);
  });

  it('the page finder: its hint, matches and the no-match line, with the shortcuts', async () => {
    mount(<WorkspaceToolbar accountLabel="Synthetic Self" />);
    expectBengali([
      'appAppNav.findAPage',
      'appAppNav.findAPage6ae3fa',
      'appAppNav.workspaceShortcuts',
      'appAppNav.helpAndServiceStatus',
      'appAppNav.notifications',
      'appAppNav.yourAccount',
    ]);
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('finder');
    await type(input, 'agency');
    expectBengali(['appAppNav.matchingPages']);
    await type(input, 'zzzz');
    expectBengali(['appAppNav.noPagesMatchTryAnotherName']);
  });
});

describe('the record search and account menu under Bengali', () => {
  const draw = (pathname: string, access: WorkspaceAccess) => {
    route.pathname = pathname;
    mount(
      <WorkspaceRecordToolbar
        accountName="Synthetic Self"
        access={access}
        navigation={workspaceNavigation(pathname, access)}
        state={{ unread: 0, personalPlan: null, agencyPlans: [] }}
        signOut={<span />}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('record search');
    return input;
  };

  it('agency scope: the hint, searching, no match, an error and the results list', async () => {
    const input = draw(`/app/agency/${ORG}`, WITH_AGENCY);
    expectBengali(['appWorkspaceRecordToolbar.searchAccessibleCasesAndClients']);
    let answer: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await type(input, 'rina');
    expectBengali(['appWorkspaceRecordToolbar.searching']);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () =>
      answer({ ok: true, json: async () => ({ results: [] }) } as unknown as Response),
    );
    expectBengali(['appWorkspaceRecordToolbar.noAccessibleRecordsMatchThisSearch']);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await type(input, 'rin');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expectBengali(['appWorkspaceRecordToolbar.searchIsUnavailableTryAgainOr']);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            kind: 'case',
            id: 'c1',
            title: 'Rina, Japan',
            subtitle: 'Case',
            href: `/app/agency/${ORG}?case=c1`,
          },
        ],
      }),
    });
    await type(input, 'rinaa');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expectBengali(['appWorkspaceRecordToolbar.searchResults']);
  });

  it('no workspace to search: the hint asks for one', () => {
    draw(`/app/agency/${ORG}`, NONE);
    expectBengali(['appWorkspaceRecordToolbar.chooseAnAvailableWorkspace']);
  });

  it('the account menu falls back to Account when the name is blank (phone width)', () => {
    mount(
      <AccountMenu
        name=" "
        email="synthetic.self@example.test"
        plan={{ name: 'Traveller Free', href: '/app/account' }}
        signOut={<span />}
      />,
    );
    expectBengali(['appAccountMenu.account'], true);
  });
});

describe('the workspace list under Bengali', () => {
  it('lists the agencies heading, and in staff mode offers the account overview', () => {
    route.pathname = '/app';
    mount(
      <WorkspaceShell access={WITH_AGENCY} accountName="Synthetic Self" signOut={<span />}>
        <p>Page</p>
      </WorkspaceShell>,
    );
    expectBengali(['appWorkspaceShell.agencies'], true);
    act(() => root.unmount());
    root = createRoot(container);
    route.pathname = '/app/admin';
    mount(
      <WorkspaceShell
        access={{ ...WITH_AGENCY, platform: { role: 'owner' } as never }}
        accountName="Synthetic Self"
        signOut={<span />}
      >
        <p>Page</p>
      </WorkspaceShell>,
    );
    expectBengali(['appWorkspaceShell.accountOverview']);
  });
});

describe('the error screen under Bengali', () => {
  it('says the page did not load, keeps the reference, and offers a way on', () => {
    mount(
      <WorkspaceError
        error={Object.assign(new Error('boom'), { digest: '99' })}
        reset={() => undefined}
      />,
    );
    expectBengali([
      'appError.thisPageDidNotLoad',
      'appError.somethingWentWrong',
      'appError.theProblemIsOnOurSide',
      'appError.tryAgain',
      'appError.goToYourOverview',
    ]);
    expect(container.textContent).not.toContain('boom');
  });
});
