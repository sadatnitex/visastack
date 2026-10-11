'use client';

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
import { type WorkspaceAccess, workspaceNavigation } from '../../lib/workspace-navigation';
import { AppNav, WorkspaceToolbar } from './app-nav';

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

function WorkspaceSelector({
  access,
  name,
  caption,
}: {
  readonly access: WorkspaceAccess;
  readonly name: string;
  readonly caption: string;
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
      className="workspace-selector"
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
        <span>
          <b>{name}</b>
          <small>{caption}</small>
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <nav id={id} aria-label="Available workspaces">
        <p>Personal space</p>
        {access.travellers.map((person) => (
          <Link key={person.id} href={`/app/applicant/${person.id}`}>
            {person.name}
          </Link>
        ))}
        <Link href="/app/applicants">Manage travellers</Link>
        {access.agencies.length ? <p>Agencies</p> : null}
        {access.agencies.map((agency) => (
          <Link key={agency.id} href={`/app/agency/${agency.id}`}>
            {agency.name}
          </Link>
        ))}
        <Link href="/app/agency">Manage or create an agency</Link>
        {access.platform ? <Link href="/app/admin">Platform operations</Link> : null}
      </nav>
    </details>
  );
}

export function WorkspaceShell({
  access,
  accountName,
  signOut,
  children,
}: {
  readonly access: WorkspaceAccess;
  readonly accountName: string;
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
            <details className="workspace-tools">
              <summary>More tools</summary>
              <nav className="app-shell-links" aria-label="Contextual tools">
                {nav.tools.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </details>
          ) : null}
          <div className="app-shell-switch">{signOut}</div>
        </AppNav>
        <div className="app-main">
          <WorkspaceToolbar accountLabel={accountName} isAdmin={access.platform !== null} />
          {children}
        </div>
      </div>
    </SubjectContext.Provider>
  );
}
