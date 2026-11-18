import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../../../components/icons';
import { PersonAvatar } from '../../../components/profile-photo/person-avatar';
import { StatusBadge } from '../../../components/ui';
import { appHomeCatalog } from '../../../i18n/app-home';
import { getServerT } from '../../../lib/i18n-server';

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

/**
 * The account photo for one person's card: only the account's own Myself record, owned by this
 * account, gets it (the same photo the sidebar account card shows). Every other person, and every
 * record another account owns, keeps their initials. A missing photo is also initials.
 */
export function ownPhotoFor(
  applicant: {
    readonly id: string;
    readonly relationship: string;
    readonly ownerAccountId: string;
  },
  accountId: string,
  own: { readonly id: string; readonly photoUrl: string | null } | null,
): string | null {
  if (!own?.photoUrl) return null;
  if (applicant.relationship !== 'SELF') return null;
  if (applicant.ownerAccountId !== accountId) return null;
  return applicant.id === own.id ? own.photoUrl : null;
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
  photoUrl,
}: {
  readonly href: string;
  readonly name: string;
  readonly documents: number;
  readonly cases: number;
  readonly requests: number;
  readonly actionNeeded: boolean;
  /** The account photo, for the account's own Myself record only (see `ownPhotoFor`). */
  readonly photoUrl?: string | null | undefined;
}) {
  const t = getServerT(appHomeCatalog);
  return (
    <li className="home-person">
      <Link className="home-person-link plain-link" href={href}>
        <PersonAvatar className="home-avatar" initials={initialsOf(name)} photoUrl={photoUrl} />
        <span className="home-person-body">
          <span className="home-person-head">
            <span className="home-person-name">{name}</span>
            {actionNeeded ? (
              <StatusBadge tone="warning">
                {t.node('appHome.appHomeCards.actionNeeded')}
              </StatusBadge>
            ) : documents === 0 ? (
              <StatusBadge tone="neutral">
                {t.node('appHome.appHomeCards.addADocument')}
              </StatusBadge>
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
  flag,
  children,
}: {
  readonly href: string;
  readonly title: string;
  readonly person: ReactNode;
  readonly badge?: ReactNode;
  /** The flag of the case's country, in place of the plain globe when the case names one. */
  readonly flag?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <li className="home-case">
      <Link className="home-case-link plain-link" href={href}>
        <span className="home-case-icon" {...(flag ? {} : { 'aria-hidden': true as const })}>
          {flag ?? <Icon name="globe" size={20} />}
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
  const t = getServerT(appHomeCatalog);
  return (
    <Link className="home-start-tile plain-link" href={href}>
      <Icon name="plus" size={24} />
      {t.node('appHome.appHomeCards.startACase')}
    </Link>
  );
}
