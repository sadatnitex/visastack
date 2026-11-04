import Link from 'next/link';

export interface StatTileProps {
  /** The number. A zero recedes (lighter text) so the tiles that need a person stand out. */
  readonly value: number;
  /** What is counted, in Title Case: "Missing", "On File". */
  readonly label: string;
  /** One short line under the label, optional. */
  readonly note?: string | undefined;
  /** Where the tile leads; without it the tile is not a link. */
  readonly href?: string | undefined;
  /** The tile is the current choice of a set of filters. */
  readonly selected?: boolean | undefined;
}

/** A count with its name, optionally a link or the selected filter of a row of tiles. */
export function StatTile({ value, label, note, href, selected = false }: StatTileProps) {
  const className = `lift-tile${value === 0 ? ' lift-tile-zero' : ''}${selected ? ' lift-tile-selected' : ''}`;
  const body = (
    <>
      <span className="lift-tile-numeral">{value}</span>
      <span className="lift-tile-label">{label}</span>
      {note ? <span className="lift-tile-note">{note}</span> : null}
    </>
  );
  if (!href) return <div className={className}>{body}</div>;
  const current = selected ? ({ 'aria-current': 'true' } as const) : {};
  if (href.startsWith('/')) {
    return (
      <Link className={className} href={href} {...current}>
        {body}
      </Link>
    );
  }
  return (
    <a className={className} href={href} {...current}>
      {body}
    </a>
  );
}
