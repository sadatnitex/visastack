import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarkTile } from '../../components/mark-tile';
import { PersonAvatar } from '../../components/profile-photo/person-avatar';
import { StatusPill } from '../../components/ui-lift';
import { ExpandableSection } from '../../components/ui-lift/expandable-section';
import type { LiftHeadingLevel, LiftTone } from '../../components/ui-lift/types';
import { initialsOf } from '../../lib/agency-brand';
import type { ItemMark } from '../../lib/item-icons';
import './u7.css';

export { FocusFirstFieldOnOpen } from './agency/[orgId]/u8-fold-focus';

/**
 * The shared pieces of the signed-in traveller screens on the Wallet foundation (U7): one compact
 * row (picture, name, one status chip, one short line, details in the body) built on the
 * Expandable Section, a person's initials as a picture, an area mark as a picture, and the
 * rounded group that holds a list of rows. Presentation only: every word, action and permission
 * stays with the page that draws the row.
 */

/** A person as initials (or their photo) in a flat disc. Decorative: the name is written beside it. */
export function PersonPicture({
  name,
  photoUrl,
}: { readonly name: string; readonly photoUrl?: string | null | undefined }) {
  return <PersonAvatar className="u7-initials" initials={initialsOf(name)} photoUrl={photoUrl} />;
}

/** An area mark (a bell, a shield, a plane) as a flat tile. Decorative: the name is written beside it. */
export function AreaPicture({ mark }: { readonly mark: ItemMark }) {
  return <MarkTile mark={mark} size="lg" className="u7-mark" />;
}

export interface TravellerRowProps {
  /** The name on the row, in the words the page already used. */
  readonly title: ReactNode;
  /** The picture at the start of the row. */
  readonly picture: ReactNode;
  /** One status chip: its words and tone. */
  readonly chip?: { readonly label: ReactNode; readonly tone: LiftTone } | undefined;
  /** One short line after the chip (a date, a count, a short sentence). */
  readonly meta?: ReactNode;
  readonly id?: string | undefined;
  readonly defaultOpen?: boolean | undefined;
  /** Keep the row as the person left it across a page refresh (for a row with a form). */
  readonly remember?: boolean | undefined;
  readonly headingLevel?: LiftHeadingLevel | undefined;
  /** A row with nothing to open that goes somewhere: the name becomes the link, the whole row presses. */
  readonly href?: string | undefined;
  /** An extra class for the page's own spacing. */
  readonly className?: string | undefined;
  /** The details, shown when the row is open. Without children the row is a plain row. */
  readonly children?: ReactNode;
}

/** One compact row for a notification, a person, a trip or an invitation. */
export function TravellerRow({
  title,
  picture,
  chip,
  meta,
  id,
  defaultOpen,
  remember,
  headingLevel = 3,
  href,
  className,
  children,
}: TravellerRowProps) {
  const summary =
    chip || meta ? (
      <span className="u7-line">
        {chip ? (
          <span className="u7-chip" data-parity-text>
            <StatusPill tone={chip.tone}>{chip.label}</StatusPill>
          </span>
        ) : null}
        {meta ? (
          <span className="u7-meta" data-parity-text>
            {meta}
          </span>
        ) : null}
      </span>
    ) : undefined;
  const rowClass = className ? `u7-row ${className}` : 'u7-row';
  if (children === undefined) {
    const Heading = `h${headingLevel}` as const;
    return (
      <div
        className={`expandable-section ${rowClass} u7-plain`}
        data-linked={href ? 'true' : undefined}
        {...(id ? { id } : {})}
      >
        <span className="u7-plain-picture" aria-hidden="true">
          {picture}
        </span>
        <Heading className="expandable-section-title u7-plain-title">
          {href ? (
            <Link href={href} className="u7-plain-link">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        {summary ? (
          <span className="expandable-section-summary u7-plain-line">{summary}</span>
        ) : null}
      </div>
    );
  }
  return (
    <ExpandableSection
      className={rowClass}
      title={title}
      picture={picture}
      headingLevel={headingLevel}
      {...(summary ? { summary } : {})}
      {...(id ? { id } : {})}
      {...(defaultOpen ? { defaultOpen } : {})}
      {...(remember ? { remember } : {})}
    >
      {children}
    </ExpandableSection>
  );
}

/** The rows of one list, spaced the same way on every traveller screen. */
export function TravellerRows({
  children,
  id,
  ariaLabel,
  className,
}: {
  readonly children: ReactNode;
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
}) {
  return (
    <div
      className={className ? `u7-rows ${className}` : 'u7-rows'}
      {...(id ? { id } : {})}
      {...(ariaLabel ? { role: 'group', 'aria-label': ariaLabel } : {})}
    >
      {children}
    </div>
  );
}

/**
 * The part of an accept screen that says what the person is agreeing to. It is drawn open
 * (a consent screen never hides what is asked), and the person may fold it away.
 */
export function AcceptFold({
  title,
  picture,
  children,
}: {
  readonly title: ReactNode;
  readonly picture?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <ExpandableSection
      className="u7-fold u7-accept-fold"
      headingLevel={2}
      title={title}
      picture={picture ?? <AreaPicture mark={{ icon: 'file', tone: 'blue' }} />}
      defaultOpen
    >
      {children}
    </ExpandableSection>
  );
}
