import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface ActionRowProps {
  /** The name of the thing, in Title Case. */
  readonly title: string;
  /** One plain line under the name. */
  readonly meta?: string | undefined;
  /** The picture in the tile at the left. */
  readonly icon?: IconName | undefined;
  /** A status or a count at the right, usually a StatusPill. */
  readonly pill?: ReactNode;
  /** Where the row leads. Without it the row is plain, or the opener of a disclosure. */
  readonly href?: string | undefined;
  /**
   * Render the row as the `<summary>` of a `<details>` the caller provides, so it opens a section
   * in place. Mutually exclusive with `href`.
   */
  readonly asSummary?: boolean | undefined;
}

/** A 56px row: icon tile, name and one line, a status, and a chevron when it leads or opens. */
export function ActionRow({ title, meta, icon, pill, href, asSummary = false }: ActionRowProps) {
  const inner = (
    <>
      {icon ? (
        <span className="lift-action-tile">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <span className="lift-action-text">
        <span className="lift-action-title">{title}</span>
        {meta ? <span className="lift-action-meta">{meta}</span> : null}
      </span>
      {pill ? <span className="lift-action-pill">{pill}</span> : null}
      {href || asSummary ? (
        <span className="lift-action-chevron">
          <Icon name={asSummary ? 'chevronDown' : 'chevron'} size={18} />
        </span>
      ) : null}
    </>
  );
  if (asSummary) return <summary className="lift-action lift-action-summary">{inner}</summary>;
  if (!href) return <div className="lift-action">{inner}</div>;
  if (href.startsWith('/')) {
    return (
      <Link className="lift-action lift-action-link" href={href}>
        {inner}
      </Link>
    );
  }
  return (
    <a className="lift-action lift-action-link" href={href}>
      {inner}
    </a>
  );
}
