import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './axe.test-support';
import { navigationState, textOf } from './next-mocks.test-support';

/**
 * Signed-in pages, as whole pages in the real signed-in shell (site header, signed-in
 * navigation, the page, footer), in each state a person can meet: nothing yet, a list, a
 * pending item, a finished item. The data behind each page is simulated; what this cannot
 * see (colour contrast, layout, how a screen reader reads the page) is checked elsewhere or
 * is owed to a person. Directive Part 9 section 2 and section 5.
 */

const state = vi.hoisted(() => ({
  notifications: [] as unknown[],
  grants: [] as unknown[],
  applicants: [] as unknown[],
  memberships: [] as unknown[],
  coreGranted: true,
  isAdmin: false,
}));

// Fonts are files the build turns into styles; a test only needs the class names to exist.
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'font-variable', className: 'font-class' }),
}));
vi.mock('./locale', () => ({ getLocale: async () => 'en' }));
vi.mock('./session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./admin', () => ({
  isPlatformAdmin: async () => state.isAdmin,
  holdsPlatformRole: async () => state.isAdmin,
  isPlatformOwnerAccount: async () => state.isAdmin,
  hasPlatformPermission: async () => state.isAdmin,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listNotificationsForAccount: async () => state.notifications,
  listGrantsForRecipientAccount: async () => state.grants,
  listApplicants: async () => state.applicants,
  getConsents: async () => (state.coreGranted ? { CORE_PROCESSING: { granted: true } } : {}),
  listMembershipsForAccount: async () => state.memberships,
  loadWorkspaceToolbarState: async () => ({
    unread: state.notifications.filter((row) => !(row as { read?: boolean }).read).length,
    personalPlan: null,
    agencyPlans: [],
  }),
}));

const { default: RootLayout } = await import('../app/layout');
const { default: AppLayout } = await import('../app/app/layout');
const { default: NotificationsPage } = await import('../app/app/notifications/page');
const { default: SharedPage } = await import('../app/app/shared/page');
const { default: ApplicantsPage } = await import('../app/app/applicants/page');
const { default: AccountPage } = await import('../app/app/account/page');
const { default: AgencyPage } = await import('../app/app/agency/page');
const { default: AppLoading } = await import('../app/app/loading');
const { default: AppError } = await import('../app/error');

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly setup?: () => void;
  readonly build: () => Promise<ReactElement>;
}

const NOW = new Date('2026-10-06T08:00:00Z');
const grant = (status: string, id: string) => ({
  grant: { id, status, purpose: 'Visa application review', actions: ['READ'], expiryAt: null },
  applicantName: 'Karim Hossain',
});

const SCREENS: readonly Screen[] = [
  {
    name: 'alerts, nothing yet',
    path: '/app/notifications',
    build: async () => await NotificationsPage(),
  },
  {
    name: 'alerts, one new and one read',
    path: '/app/notifications',
    setup: () => {
      state.notifications = [
        {
          id: 'n1',
          subject: 'Passport nearing expiry',
          summary: 'Your passport expires in 60 days.',
          deepLinkPath: '/app/applicant/a1/expiry',
          read: false,
          createdAt: NOW,
        },
        {
          id: 'n2',
          subject: 'Evidence Requested',
          summary: 'An agency asked for a bank statement.',
          deepLinkPath: '/app/applicant/a1/evidence',
          read: true,
          createdAt: NOW,
        },
      ];
    },
    build: async () => await NotificationsPage(),
  },
  {
    name: 'shared with me, nothing yet',
    path: '/app/shared',
    build: async () => await SharedPage(),
  },
  {
    name: 'shared with me, pending, active, revoked and expired',
    path: '/app/shared',
    setup: () => {
      state.grants = [
        grant('PENDING_ACCEPTANCE', 'g1'),
        grant('ACTIVE', 'g2'),
        grant('REVOKED', 'g3'),
        grant('EXPIRED', 'g4'),
        grant('PAUSED', 'g5'),
      ];
    },
    build: async () => await SharedPage(),
  },
  {
    name: 'applicants, none yet and consent given',
    path: '/app/applicants',
    build: async () => await ApplicantsPage(),
  },
  {
    name: 'applicants, consent not given',
    path: '/app/applicants',
    setup: () => {
      state.coreGranted = false;
    },
    build: async () => await ApplicantsPage(),
  },
  {
    name: 'applicants, one person on the account',
    path: '/app/applicants',
    setup: () => {
      state.applicants = [{ id: 'a1', displayName: 'Karim Hossain', relationship: 'SELF' }];
    },
    build: async () => await ApplicantsPage(),
  },
  { name: 'account', path: '/app/account', build: async () => await AccountPage() },
  {
    name: 'account for a platform administrator with agency access',
    path: '/app/account',
    setup: () => {
      state.isAdmin = true;
      state.memberships = [
        {
          active: true,
          role: 'OWNER',
          organization: { id: 'o1', name: 'Dhaka Visa Desk', status: 'ACTIVE' },
        },
      ];
    },
    build: async () => await AccountPage(),
  },
  {
    name: 'agency, no organization yet',
    path: '/app/agency',
    build: async () => await AgencyPage(),
  },
  {
    name: 'agency, active, pending and suspended organizations',
    path: '/app/agency',
    setup: () => {
      state.memberships = [
        { role: 'OWNER', organization: { id: 'o1', name: 'Dhaka Visa Desk', status: 'ACTIVE' } },
        { role: 'ADMIN', organization: { id: 'o2', name: 'Sylhet Travel', status: 'PENDING' } },
        { role: 'STAFF', organization: { id: 'o3', name: 'Old Agency', status: 'SUSPENDED' } },
      ];
    },
    build: async () => await AgencyPage(),
  },
  { name: 'loading screen', path: '/app', build: async () => <AppLoading /> },
  {
    name: 'something went wrong, with a retry',
    path: '/app',
    build: async () => (
      <AppError error={Object.assign(new Error('x'), { digest: '99' })} reset={() => undefined} />
    ),
  },
];

async function shellMarkup(screen: Screen): Promise<string> {
  navigationState.pathname = screen.path;
  screen.setup?.();
  const page = await screen.build();
  const shell = await AppLayout({ children: page });
  return renderToStaticMarkup(await RootLayout({ children: shell }));
}

beforeEach(() => {
  state.notifications = [];
  state.grants = [];
  state.applicants = [];
  state.memberships = [];
  state.coreGranted = true;
  state.isAdmin = false;
});

describe('signed-in pages, as whole pages in the signed-in shell', () => {
  it.each(SCREENS.map((s) => [s.name, s] as const))(
    '%s has no accessibility problems',
    async (_name, screen) => {
      expect(await axeViolations(await shellMarkup(screen), { wholePage: true })).toEqual([]);
    },
    30_000,
  );

  it('marks the current section in the signed-in navigation', async () => {
    const html = await shellMarkup(SCREENS[0] as Screen);
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>.*?<\/a>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('Notifications');
  });
});

describe('what each state says, in plain words', () => {
  it('tells a person with no alerts what will appear here', async () => {
    expect(textOf(await shellMarkup(SCREENS[0] as Screen))).toContain('No Alerts Yet');
  });

  it('shows a pending share as waiting for the person, with the one action that moves it on', async () => {
    const text = textOf(await shellMarkup(SCREENS[3] as Screen));
    expect(text).toContain('Awaiting Your Acceptance');
    expect(text).toContain('Accept Access');
    expect(text).toContain('Open Workspace');
    expect(text).toContain('Revoked');
    expect(text).toContain('Expired');
  });

  it('does not offer a way into an access that is revoked, expired or paused', async () => {
    const html = await shellMarkup(SCREENS[3] as Screen);
    expect(html.match(/Open Workspace/g)?.length).toBe(1);
    expect(html.match(/Accept Access/g)?.length).toBe(1);
  });

  it('explains why adding a person is not offered yet', async () => {
    expect(textOf(await shellMarkup(SCREENS[5] as Screen))).toContain(
      'Let VisaStack Process My Details',
    );
  });

  it('shows the error screen with a retry that is a real button', async () => {
    const html = await shellMarkup(SCREENS[SCREENS.length - 1] as Screen);
    expect(html).toContain('<button type="button" class="btn btn-primary">Try Again</button>');
    expect(textOf(html)).toContain('Everything you already saved is safe');
    // It must not promise that nothing was lost: a half-typed form may be.
    expect(textOf(html)).not.toContain('was lost or damaged');
  });
});
