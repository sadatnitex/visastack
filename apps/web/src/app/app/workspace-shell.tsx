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
import {
  type WorkspaceAccess,
  type WorkspaceNavigation,
  workspaceNavigation,
} from '../../lib/workspace-navigation';

type WorkspaceKind = WorkspaceNavigation['kind'];
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
  kind = 'personal',
}: {
  readonly access: WorkspaceAccess;
  readonly name: string;
  readonly caption: string;
  readonly compact?: boolean;
  readonly kind?: WorkspaceKind;
}) {
  const id = useId();
  const pathname = usePathname();
  const selector = useRef<HTMLDetailsElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route closes the context selector
  useEffect(() => {
    if (selector.current) selector.current.open = false;
  }, [pathname]);
  // The chip closes when someone taps anywhere else (another menu, the page),
  // as the account menu and the More sheet do, so two menus never overlap.
  useEffect(() => {
    if (!compact) return;
    const outside = (event: PointerEvent) => {
      const details = selector.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [compact]);
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
      <summary aria-controls={id}>
        {compact && !isPerson ? null : (
          <span className="workspace-avatar" aria-hidden="true">
            {name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0))
              .join('')
              .toUpperCase()}
          </span>
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
              <WorkspaceSelector
                access={access}
                name={nav.name}
                caption={nav.caption}
                kind={nav.kind}
                compact
              />
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
