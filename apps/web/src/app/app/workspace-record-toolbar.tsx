'use client';

import type {
  WorkspaceSearchResult,
  WorkspaceSearchScope,
  WorkspaceToolbarState,
} from '@visastack/services';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from '../../components/brand-mark';
import { useLocale, useT } from '../../components/i18n-provider';
import { Icon } from '../../components/icons';
import { ShortcutHint } from '../../components/shortcut-hint';
import { appHomeCatalog } from '../../i18n/app-home';
import { countLabel } from '../../lib/count-label';
import type { WorkspaceAccess, WorkspaceNavigation } from '../../lib/workspace-navigation';
import { AccountMenu } from './account-menu';

export function WorkspaceRecordToolbar({
  accountName,
  accountEmail,
  navigation,
  state,
  signOut,
  contextChip,
}: {
  readonly accountName: string;
  /** The signed-in address the session already holds, shown in the account menu. */
  readonly accountEmail?: string | undefined;
  readonly access: WorkspaceAccess;
  readonly navigation: WorkspaceNavigation;
  readonly state?: WorkspaceToolbarState;
  readonly signOut: ReactNode;
  /** WP-X3: who you are acting as, shown in the phone top bar so it is visible without opening More. */
  readonly contextChip?: ReactNode;
}) {
  const t = useT(appHomeCatalog);
  const locale = useLocale();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [mobileSearch, setMobileSearch] = useState(false);
  const [result, setResult] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    rows: readonly WorkspaceSearchResult[];
    /** Said instead of "no match", for example when a typed reference has a wrong character. */
    notice?: string;
  }>({ status: 'idle', rows: [] });
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLElement>(null);
  const inputId = useId();
  const resultsId = useId();
  const searchId = useId();
  // Staff mode (owner list item 18): platform pages carry no traveller search and no personal plan.
  const staff = navigation.kind === 'platform';
  const scope: WorkspaceSearchScope | null =
    navigation.kind === 'agency'
      ? { kind: 'agency', organizationId: pathname.split('/')[3] ?? '' }
      : navigation.kind === 'unavailable' || staff
        ? null
        : navigation.kind === 'personal' &&
            navigation.primary[0]?.href.startsWith('/app/applicant/')
          ? { kind: 'personal', applicantId: navigation.primary[0].href.split('/')[3] ?? '' }
          : { kind: 'personal' };
  const scopeKey = JSON.stringify(scope);
  const selectedOrg = scope?.kind === 'agency' ? scope.organizationId : null;
  const plan = selectedOrg
    ? state?.agencyPlans.find((item) => item.organizationId === selectedOrg)
    : state?.personalPlan;
  const planLabel = plan?.key === 'agency_founding_access' ? 'Founding Access' : plan?.name;
  const planHref = selectedOrg ? `/app/agency/${selectedOrg}/plan` : '/app/account/plan';

  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes close transient controls
  useEffect(() => {
    setQuery('');
    setMobileSearch(false);
  }, [pathname]);
  useEffect(() => {
    // Staff pages have no traveller search, so the shortcut is left to the browser.
    if (staff) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileSearch(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [staff]);
  useEffect(() => {
    const selected = JSON.parse(scopeKey) as WorkspaceSearchScope | null;
    const value = query.trim();
    if (!selected || value.length < 2) {
      setResult({ status: 'idle', rows: [] });
      return;
    }
    const controller = new AbortController();
    setResult({ status: 'loading', rows: [] });
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch('/api/workspace/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: value, scope: selected }),
          signal: controller.signal,
          redirect: 'error',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Search unavailable');
        const body = (await response.json()) as {
          results: WorkspaceSearchResult[];
          notice?: string;
        };
        if (!controller.signal.aborted)
          setResult({
            status: 'ready',
            rows: body.results,
            ...(typeof body.notice === 'string' ? { notice: body.notice } : {}),
          });
      } catch {
        if (!controller.signal.aborted) setResult({ status: 'error', rows: [] });
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, scopeKey]);

  const closeSearch = () => {
    setQuery('');
    setMobileSearch(false);
    if (mobileSearch) toggle.current?.focus();
    else input.current?.focus();
  };
  return (
    <header
      className="workspace-toolbar record-toolbar"
      data-search-open={mobileSearch ? 'true' : 'false'}
    >
      <Link
        href="/"
        className="brand workspace-brand"
        aria-label={t('appHome.appWorkspaceRecordToolbar.visastackHome')}
      >
        <BrandMark />
        <span className="record-brand-label">
          {t('appHome.appWorkspaceRecordToolbar.visastack')}
        </span>
      </Link>
      {contextChip}
      {staff ? null : (
        <>
          <button
            type="button"
            ref={toggle}
            className="record-search-toggle"
            aria-label={t('appHome.appWorkspaceRecordToolbar.searchAccessibleRecords')}
            aria-expanded={mobileSearch}
            aria-controls={searchId}
            onClick={() => {
              const open = !mobileSearch;
              setMobileSearch(open);
              if (open) requestAnimationFrame(() => input.current?.focus());
            }}
          >
            <Icon name="search" size={20} />
          </button>
          <search
            id={searchId}
            className="record-search"
            aria-label={t('appHome.appWorkspaceRecordToolbar.accessibleRecordSearch')}
            ref={search}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeSearch();
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const links = Array.from(
                search.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [],
              );
              if (!links.length) return;
              const current = links.findIndex((item) => item === document.activeElement);
              event.preventDefault();
              if (event.key === 'ArrowUp' && current <= 0) input.current?.focus();
              else
                links[
                  Math.min(
                    links.length - 1,
                    Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)),
                  )
                ]?.focus();
            }}
          >
            <Icon name="search" size={19} />
            <label className="sr-only" htmlFor={inputId}>
              {t('appHome.appWorkspaceRecordToolbar.searchAccessibleProfilesCasesAndDocument')}
            </label>
            <input
              id={inputId}
              ref={input}
              type="search"
              placeholder={
                !scope
                  ? t('appHome.appWorkspaceRecordToolbar.chooseAnAvailableWorkspace')
                  : selectedOrg
                    ? t('appHome.appWorkspaceRecordToolbar.searchAccessibleCasesAndClients')
                    : t('appHome.appWorkspaceRecordToolbar.searchProfilesCasesDocuments')
              }
              value={query}
              maxLength={80}
              readOnly={!scope}
              aria-describedby={resultsId}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ShortcutHint keyName="K" />
            <div id={resultsId} className="record-search-results" hidden={!query.trim()}>
              {result.status === 'loading' ? (
                <output aria-live="polite">
                  {t('appHome.appWorkspaceRecordToolbar.searching')}
                </output>
              ) : null}
              {result.status === 'error' ? (
                <p role="alert">
                  {t('appHome.appWorkspaceRecordToolbar.searchIsUnavailableTryAgainOr')}
                </p>
              ) : null}
              {result.status === 'idle' ? (
                <p>{t('appHome.appWorkspaceRecordToolbar.typeAtLeastTwoCharacters')}</p>
              ) : null}
              {result.status === 'ready' && !result.rows.length ? (
                <output aria-live="polite">
                  {result.notice ??
                    t('appHome.appWorkspaceRecordToolbar.noAccessibleRecordsMatchThisSearch')}
                </output>
              ) : null}
              {result.status === 'ready' && result.rows.length ? (
                <nav aria-label={t('appHome.appWorkspaceRecordToolbar.searchResults')}>
                  <ul>
                    {result.rows.map((item) => (
                      <li key={`${item.category}:${item.id}`}>
                        <Link href={item.href} onClick={() => setQuery('')}>
                          <small>{item.category}</small>
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}
            </div>
          </search>
        </>
      )}
      <span className="record-toolbar-spacer" />
      {staff ? null : (
        <Link className="record-plan-badge" href={planHref}>
          {planLabel || t('appHome.appWorkspaceRecordToolbar.planInformation')}
        </Link>
      )}
      <nav
        className="record-toolbar-shortcuts"
        aria-label={t('appHome.appWorkspaceRecordToolbar.helpAndNotifications')}
      >
        <Link href="/app/help" aria-label={t('appHome.appWorkspaceRecordToolbar.helpAndSupport')}>
          <Icon name="alert" size={20} />
        </Link>
        <Link
          href="/app/notifications"
          aria-label={
            state
              ? t('appHome.appWorkspaceRecordToolbar.notificationsUnreadUnread', {
                  unread: state.unread,
                })
              : t('appHome.appWorkspaceRecordToolbar.notifications')
          }
        >
          <Icon name="bell" size={20} />
          {state && state.unread > 0 ? (
            <span className="record-unread" aria-hidden="true">
              {countLabel(state.unread, 99, locale)}
            </span>
          ) : null}
        </Link>
      </nav>
      <AccountMenu
        name={accountName}
        email={accountEmail}
        plan={
          state?.personalPlan && !staff
            ? { name: state.personalPlan.name, href: '/app/account/plan' }
            : null
        }
        signOut={signOut}
      />
    </header>
  );
}
