'use client';

import type { WorkspaceToolbarState } from '@visastack/services';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Icon, type IconName } from '../../components/icons';
import { LinkPending, RouteProgress } from '../../components/link-pending';
import { PersonAvatar } from '../../components/profile-photo/person-avatar';
import { ToastHost } from '../../components/toast';
import { isCurrentPath } from '../../lib/navigation';
import { type SidebarState, saveSidebarState } from '../../lib/sidebar-preference';
import { tabBadges } from '../../lib/tab-badges';
import { useCloseOnOutsidePress, useMediaQuery } from '../../lib/use-popover';
import {
  type WorkspaceAccess,
  type WorkspaceNavigation,
  workspaceNavigation,
} from '../../lib/workspace-navigation';

import { useT } from '../../components/i18n-provider';
import { appHomeCatalog } from '../../i18n/app-home';
import { AppNav, navIconFor } from './app-nav';
import { WorkspaceRecordToolbar } from './workspace-record-toolbar';

type WorkspaceKind = WorkspaceNavigation['kind'];

type Subject = { readonly route: string; readonly applicantId: string };
const SubjectContext = createContext<((subject: Subject) => void) | null>(null);

/**
 * The case layout supplies a subject only after its existing owner check succeeds. It registers
 * before the browser paints, so moving to a case from another page never shows the neutral sidebar
 * for a frame; the first load already carries the same subject from the server.
 */
export function WorkspaceCaseSubject({ route, applicantId }: Subject) {
  const register = useContext(SubjectContext);
  useLayoutEffect(() => {
    register?.({ route, applicantId });
  }, [register, route, applicantId]);
  return null;
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const restOfName = (name: string) => name.trim().slice(firstWord(name).length);

/**
 * Who you are acting as, and the places you can switch to. The phone top bar
 * shows a compact copy (WP-X3) so this is visible without opening More; both
 * read the same access and navigation, and neither grants anything.
 */
function WorkspaceSelector({
  access,
  name,
  caption,
  compact = false,
  popover = false,
  kind = 'personal',
  photo,
  staff = kind === 'platform',
}: {
  readonly access: WorkspaceAccess;
  readonly name: string;
  readonly caption: string;
  readonly compact?: boolean;
  /** The sidebar is a slim rail: the list opens beside it as a popover and closes like one. */
  readonly popover?: boolean;
  readonly kind?: WorkspaceKind;
  readonly photo?: string | undefined;
  /** A platform page: the list offers the Account Overview instead of traveller names. */
  readonly staff?: boolean;
}) {
  const t = useT(appHomeCatalog);
  const id = useId();
  const pathname = usePathname();
  const selector = useRef<HTMLDetailsElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route closes the context selector
  useEffect(() => {
    if (selector.current) selector.current.open = false;
  }, [pathname]);
  // The chip (and the list beside the slim rail) closes when someone taps anywhere else (another
  // menu, the page), as the account menu and the More sheet do, so two menus never overlap.
  useCloseOnOutsidePress(selector, compact || popover);
  // A person's first name is enough to recognise them. Other contexts get a
  // short label that fits a phone and drop the initials so the label has room; the full wording is still read aloud.
  const isPerson = kind === 'personal' && access.travellers.some((t) => t.name === name);
  const chipText = isPerson
    ? firstWord(name)
    : kind === 'platform'
      ? 'Platform'
      : kind === 'unavailable'
        ? 'No access'
        : name;
  const spoken = isPerson
    ? `${restOfName(name)}, acting as this person, ${caption}`
    : `, current workspace: ${[name, caption].filter((part) => part !== chipText).join(', ')}`;
  return (
    <details
      ref={selector}
      className={compact ? 'workspace-selector workspace-chip' : 'workspace-selector'}
      data-initials={compact && !isPerson ? 'false' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selector.current?.open) {
          selector.current.open = false;
          selector.current.querySelector('summary')?.focus();
          event.stopPropagation();
        }
      }}
    >
      {/* Beside the rail only the avatar shows, so the summary carries the full name itself. */}
      <summary
        aria-controls={id}
        aria-label={
          popover
            ? t('appHome.appWorkspaceShell.nameCaptionSwitchWorkspace', { name, caption })
            : undefined
        }
      >
        {compact && !isPerson ? null : (
          <PersonAvatar
            className="workspace-avatar"
            initials={name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0))
              .join('')
              .toUpperCase()}
            photoUrl={isPerson ? photo : undefined}
          />
        )}
        {compact ? (
          // Visible: a short label. Read aloud: the visible words first, then the full context.
          <>
            <span className="workspace-chip-label">
              <b dir="auto">{chipText || caption}</b>
              <span className="sr-only">{spoken}</span>
            </span>
            <Icon name="chevronDown" size={12} />
          </>
        ) : (
          <>
            <span>
              <b>{name}</b>
              <small>{caption}</small>
            </span>
            <Icon name="chevron" size={16} />
          </>
        )}
      </summary>
      <nav id={id} aria-label={t('appHome.appWorkspaceShell.availableWorkspaces')}>
        <p>{t.node('appHome.appWorkspaceShell.personalSpace')}</p>
        {/* Staff mode keeps traveller names off platform screens (owner list item 18): one way
            back to the account's own overview, where the travellers are listed. */}
        {staff ? (
          <Link href="/app">{t.node('appHome.appWorkspaceShell.accountOverview')}</Link>
        ) : (
          access.travellers.map((person) => (
            <Link key={person.id} href={`/app/applicant/${person.id}`}>
              {person.name}
            </Link>
          ))
        )}
        {access.agencies.length ? <p>{t.node('appHome.appWorkspaceShell.agencies')}</p> : null}
        {access.agencies.map((agency) => (
          <Link key={agency.id} href={`/app/agency/${agency.id}`}>
            {agency.name}
          </Link>
        ))}
        {access.platform ? (
          <Link href="/app/admin">{t.node('appHome.appWorkspaceShell.platformOperations')}</Link>
        ) : null}
      </nav>
    </details>
  );
}

/**
 * Staff mode, said plainly at the top of every platform page (owner list item 18), so nobody
 * mistakes platform tools for their own traveller space. It grants nothing: every platform page
 * keeps its own permission checks, and the way out goes to the account's own overview.
 */
function StaffModeBanner() {
  const t = useT(appHomeCatalog);
  return (
    <section className="staff-mode-banner" aria-label={t('appHome.appWorkspaceShell.staffMode')}>
      <Icon name="lock" size={18} />
      <p>
        <b>Staff Mode.</b> You are using platform tools. What you change here can affect other
        people&apos;s accounts.
      </p>
      <Link className="staff-mode-leave" href="/app">
        {t.node('appHome.appWorkspaceShell.leaveStaffMode')}
      </Link>
    </section>
  );
}

/**
 * The contextual destinations that have no icon of their own. In the full sidebar the list opens in
 * place; beside the slim rail it is an icon that opens a popover, so these pages stay reachable
 * and the choice never costs a destination.
 */
function WorkspaceTools({
  tools,
  primary = [],
  popover,
  title = 'More Tools',
  groupIcon = 'more',
  listLabel = 'Contextual tools',
}: {
  readonly tools: WorkspaceNavigation['tools'];
  /** The words on the closed list, and the icon beside them (the same treatment as a main link). */
  readonly title?: string;
  readonly groupIcon?: IconName;
  readonly listLabel?: string;
  /**
   * The sidebar's own destinations. When one of them already marks this page (an entry point
   * lights up on the pages that belong to it, UMPE P13), no tool marks it too, so a page has one
   * current link.
   */
  readonly primary?: WorkspaceNavigation['primary'];
  readonly popover: boolean;
}) {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  const claimed = primary.some((item) => isCurrentPath(pathname, item));
  const currentTool = (item: WorkspaceNavigation['tools'][number]) =>
    !claimed && isCurrentPath(pathname, item);
  const current = tools.some(currentTool);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route closes the popover
  useEffect(() => {
    if (popover && details.current) details.current.open = false;
  }, [pathname, popover]);
  useCloseOnOutsidePress(details, popover);
  return (
    <details
      ref={details}
      className="workspace-tools"
      open={popover ? false : current}
      onKeyDown={(event) => {
        if (popover && event.key === 'Escape' && details.current?.open) {
          details.current.open = false;
          details.current.querySelector('summary')?.focus();
          event.stopPropagation();
        }
      }}
    >
      <summary aria-label={popover ? title : undefined}>
        <span className="workspace-tools-icon">
          <Icon name={groupIcon} size={20} />
        </span>
        <span className="workspace-tools-label">{title}</span>
        <span className="workspace-tools-chevron">
          <Icon name="chevronDown" size={16} />
        </span>
      </summary>
      <nav className="app-shell-links workspace-tools-list" aria-label={listLabel}>
        {tools.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={currentTool(item) ? 'page' : undefined}
          >
            <LinkPending />
            <Icon name={navIconFor(item)} size={20} />
            <span className="app-link-label app-link-full">{item.label}</span>
          </Link>
        ))}
      </nav>
    </details>
  );
}

export function WorkspaceShell({
  access,
  accountName,
  accountEmail,
  toolbarState,
  signOut,
  sidebarState = 'expanded',
  initialCaseSubject = null,
  children,
}: {
  readonly access: WorkspaceAccess;
  readonly accountName: string;
  /** The signed-in address from the session the layout already holds; no extra read. */
  readonly accountEmail?: string | undefined;
  readonly toolbarState?: WorkspaceToolbarState;
  readonly signOut: ReactNode;
  /** The sidebar state this device chose, read from its cookie by the layout so the first paint is right. */
  readonly sidebarState?: SidebarState;
  /**
   * The traveller behind the case page this load opened, read on the server with the owner's own
   * check so the first paint is right. It is used only while the address still matches its route.
   */
  readonly initialCaseSubject?: Subject | null;
  readonly children: ReactNode;
}) {
  const t = useT(appHomeCatalog);
  const pathname = usePathname();
  // Every case this visit has reported (its route and, from the layout's owner check, its
  // traveller), so going back to a case or one of its pages shows its traveller at once.
  const [subjects, setSubjects] = useState<readonly Subject[]>(() =>
    initialCaseSubject ? [initialCaseSubject] : [],
  );
  const registerSubject = useCallback((next: Subject) => {
    setSubjects((list) =>
      list.some((item) => item.route === next.route && item.applicantId === next.applicantId)
        ? list
        : [next, ...list.filter((item) => item.route !== next.route)].slice(0, 20),
    );
  }, []);
  const subject =
    subjects.find((item) => pathname === item.route || pathname.startsWith(`${item.route}/`)) ??
    null;
  const frame = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(sidebarState === 'collapsed');
  // The rail exists only from 1024px up; below that the saved choice changes nothing, so the lists
  // there stay ordinary and keep their full names.
  const railShown = useMediaQuery('(min-width: 1024px)') && collapsed;
  const nav = workspaceNavigation(pathname, access, subject);
  // The small label beside a rail control can be put away with Escape (WCAG 1.4.13); it returns when
  // the pointer or focus reaches another control.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const control = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('a, button, summary') : null;
    let away: Element | null = null;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const hovered = [...element.querySelectorAll(':hover')].at(-1) ?? null;
      away = control(document.activeElement) ?? control(hovered);
      if (away) element.setAttribute('data-tips-dismissed', 'true');
    };
    const restore = (event: Event) => {
      if (control(event.target) !== away) element.removeAttribute('data-tips-dismissed');
    };
    document.addEventListener('keydown', dismiss);
    element.addEventListener('pointerover', restore);
    element.addEventListener('focusin', restore);
    return () => {
      document.removeEventListener('keydown', dismiss);
      element.removeEventListener('pointerover', restore);
      element.removeEventListener('focusin', restore);
    };
  }, []);
  const toggleSidebar = () => {
    setCollapsed(!collapsed);
    saveSidebarState(collapsed ? 'expanded' : 'collapsed');
  };
  return (
    <SubjectContext.Provider value={registerSubject}>
      <div
        ref={frame}
        className="app-frame"
        data-workspace={nav.kind}
        data-sidebar={collapsed ? 'collapsed' : 'expanded'}
      >
        <RouteProgress />
        <ToastHost />
        <AppNav
          links={nav.primary}
          accountLabel={accountName}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          badges={tabBadges(nav.primary, toolbarState)}
          identity={
            <WorkspaceSelector
              // A fresh list each time the sidebar changes size, so none stays open across it.
              key={railShown ? 'rail' : 'full'}
              access={access}
              name={nav.name}
              caption={nav.caption}
              staff={nav.kind === 'platform'}
              photo={nav.photo}
              popover={railShown}
            />
          }
          secondaryLinks={nav.settings}
          footer={
            nav.kind === 'platform' ? (
              <p className="workspace-assurance">
                <Icon name="lock" size={18} />
                <span>
                  <b>{t.node('appHome.appWorkspaceShell.staffMode')}</b>
                  <small>
                    {t.node('appHome.appWorkspaceShell.platformToolsForVisastackStaff')}
                  </small>
                </span>
              </p>
            ) : (
              <p className="workspace-assurance">
                <Icon name="shield" size={18} />
                <span>
                  <b>{t.node('appHome.appWorkspaceShell.youControlAccess')}</b>
                  <small>
                    {t.node('appHome.appWorkspaceShell.sharingFollowsYourSavedPermissions')}
                  </small>
                </span>
              </p>
            )
          }
        >
          {nav.tools.length ? (
            <WorkspaceTools
              key={railShown ? 'rail' : 'full'}
              tools={nav.tools}
              primary={nav.primary}
              popover={railShown}
            />
          ) : null}
          {nav.billing?.length ? (
            <WorkspaceTools
              key={`billing-${railShown ? 'rail' : 'full'}`}
              tools={nav.billing}
              primary={nav.primary}
              popover={railShown}
              title={t('appHome.appWorkspaceShell.operationsAndBilling')}
              groupIcon="briefcase"
              listLabel="Billing and plans"
            />
          ) : null}
        </AppNav>
        <div className="app-main">
          <WorkspaceRecordToolbar
            key={`${nav.kind}:${nav.primary[0]?.href ?? 'none'}`}
            contextChip={
              <WorkspaceSelector
                access={access}
                name={nav.name}
                caption={nav.caption}
                kind={nav.kind}
                photo={nav.photo}
                compact
              />
            }
            accountName={accountName}
            accountEmail={accountEmail}
            access={access}
            navigation={nav}
            {...(toolbarState ? { state: toolbarState } : {})}
            signOut={signOut}
          />
          {nav.kind === 'platform' ? <StaffModeBanner /> : null}
          {children}
        </div>
      </div>
    </SubjectContext.Provider>
  );
}
