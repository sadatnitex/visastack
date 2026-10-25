'use client';

import type { WorkspaceToolbarState } from '@visastack/services';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Icon } from '../../components/icons';
import { isCurrentPath } from '../../lib/navigation';
import { type WorkspaceAccess, workspaceNavigation } from '../../lib/workspace-navigation';
import { AppNav } from './app-nav';
import { WorkspaceRecordToolbar } from './workspace-record-toolbar';

type Subject = { readonly route: string; readonly applicantId: string };
const SubjectContext = createContext<((subject: Subject) => void) | null>(null);

/** The case layout supplies a subject only after its existing owner check succeeds. */
export function WorkspaceCaseSubject({ route, applicantId }: Subject) {
  const register = useContext(SubjectContext);
  useEffect(() => {
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
}: {
  readonly access: WorkspaceAccess;
  readonly name: string;
  readonly caption: string;
  readonly compact?: boolean;
}) {
  const id = useId();
  const pathname = usePathname();
  const selector = useRef<HTMLDetailsElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route closes the context selector
  useEffect(() => {
    if (selector.current) selector.current.open = false;
  }, [pathname]);
  return (
    <details
      ref={selector}
      className={compact ? 'workspace-selector workspace-chip' : 'workspace-selector'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selector.current?.open) {
          selector.current.open = false;
          selector.current.querySelector('summary')?.focus();
          event.stopPropagation();
        }
      }}
    >
      <summary aria-controls={id}>
        <span className="workspace-avatar" aria-hidden="true">
          {name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')
            .toUpperCase()}
        </span>
        {compact ? (
          // The chip shows the first name; screen readers hear "Acting as", the full name and context.
          <span>
            <span className="sr-only">Acting as </span>
            <b>{firstWord(name)}</b>
            <span className="sr-only">
              {restOfName(name)}, {caption}
            </span>
          </span>
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
      <nav id={id} aria-label="Available workspaces">
        <p>Personal space</p>
        {access.travellers.map((person) => (
          <Link key={person.id} href={`/app/applicant/${person.id}`}>
            {person.name}
          </Link>
        ))}
        {access.agencies.length ? <p>Agencies</p> : null}
        {access.agencies.map((agency) => (
          <Link key={agency.id} href={`/app/agency/${agency.id}`}>
            {agency.name}
          </Link>
        ))}
        {access.platform ? <Link href="/app/admin">Platform operations</Link> : null}
      </nav>
    </details>
  );
}

export function WorkspaceShell({
  access,
  accountName,
  toolbarState,
  signOut,
  children,
}: {
  readonly access: WorkspaceAccess;
  readonly accountName: string;
  readonly toolbarState?: WorkspaceToolbarState;
  readonly signOut: ReactNode;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const [subject, setSubject] = useState<Subject | null>(null);
  const nav = workspaceNavigation(pathname, access, subject);
  return (
    <SubjectContext.Provider value={setSubject}>
      <div className="app-frame" data-workspace={nav.kind}>
        <AppNav
          links={nav.primary}
          accountLabel={accountName}
          identity={<WorkspaceSelector access={access} name={nav.name} caption={nav.caption} />}
          secondaryLinks={nav.settings}
          footer={
            <p className="workspace-assurance">
              <Icon name="shield" size={18} />
              <span>
                <b>You control access</b>
                <small>Sharing follows your saved permissions.</small>
              </span>
            </p>
          }
        >
          {nav.tools.length ? (
            <details
              className="workspace-tools"
              open={nav.tools.some((item) => isCurrentPath(pathname, item))}
            >
              <summary>More tools</summary>
              <nav className="app-shell-links" aria-label="Contextual tools">
                {nav.tools.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isCurrentPath(pathname, item) ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </details>
          ) : null}
        </AppNav>
        <div className="app-main">
          <WorkspaceRecordToolbar
            key={`${nav.kind}:${nav.primary[0]?.href ?? 'none'}`}
            contextChip={
              <WorkspaceSelector access={access} name={nav.name} caption={nav.caption} compact />
            }
            accountName={accountName}
            access={access}
            navigation={nav}
            {...(toolbarState ? { state: toolbarState } : {})}
            signOut={signOut}
          />
          {children}
        </div>
      </div>
    </SubjectContext.Provider>
  );
}
