import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../../../components/icons';
import { StatusBadge } from '../../../components/ui';

/*
 * The cards on Home after Start Here (UX18): a person is a face with two numbers and one chip, a
 * case is a card with a thin bar, and the next case is an open slot. They show only what Home
 * already reads; every card is one link.
 */

/** "Nazmus Sadat" is "NS", "Salma" is "S": the first letters of the first and last word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
  return `${first ?? '?'}${last ?? ''}`.toUpperCase();
}

const stat = (count: number, one: string, many: string) => (
  <span className="home-stat">
    <b>{count}</b> {count === 1 ? one : many}
  </span>
);

export function PersonCard({
  href,
  name,
  documents,
  cases,
  requests,
  actionNeeded,
}: {
  readonly href: string;
  readonly name: string;
  readonly documents: number;
  readonly cases: number;
  readonly requests: number;
  readonly actionNeeded: boolean;
}) {
  return (
    <li className="home-person">
      <Link className="home-person-link plain-link" href={href}>
        <span className="home-avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <span className="home-person-body">
          <span className="home-person-head">
            <span className="home-person-name">{name}</span>
            {actionNeeded ? (
              <StatusBadge tone="warning">Action Needed</StatusBadge>
            ) : documents === 0 ? (
              <StatusBadge tone="neutral">Add a Document</StatusBadge>
            ) : null}
          </span>
          <span className="home-stats">
            {stat(documents, 'Document', 'Documents')}
            {stat(cases, 'Case', 'Cases')}
            {requests > 0 ? stat(requests, 'Request', 'Requests') : null}
          </span>
        </span>
        <span className="home-card-chevron">
          <Icon name="chevron" size={20} />
        </span>
      </Link>
    </li>
  );
}

/** One case, or one set of agency requests, as a card: a title, a person, a bar or a line, a chip. */
export function CaseCard({
  href,
  title,
  person,
  badge,
  children,
}: {
  readonly href: string;
  readonly title: string;
  readonly person: ReactNode;
  readonly badge?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <li className="home-case">
      <Link className="home-case-link plain-link" href={href}>
        <span className="home-case-icon" aria-hidden="true">
          <Icon name="globe" size={20} />
        </span>
        <span className="home-case-title">{title}</span>
        <span className="home-case-person">{person}</span>
        {badge ? <span className="home-case-badge">{badge}</span> : null}
        {children ? <span className="home-case-progress">{children}</span> : null}
      </Link>
    </li>
  );
}

/** The open slot at the end of the cases: one tap to start the next. */
export function StartCaseTile({ href }: { readonly href: string }) {
  return (
    <Link className="home-start-tile plain-link" href={href}>
      <Icon name="plus" size={24} />
      Start a Case
    </Link>
  );
}
