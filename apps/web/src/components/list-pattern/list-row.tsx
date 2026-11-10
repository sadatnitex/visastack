import type { ItemMark } from '../../lib/item-icons';
import { Icon, type IconName } from '../icons';
import { MarkTile } from '../mark-tile';
import { LiftLink } from '../ui-lift/lift-parts';
import { StatusPill } from '../ui-lift/status-pill';
import type { LiftAction, LiftTone } from '../ui-lift/types';
import { shortName } from './short-name';

export interface ListRowProps {
  /** The stable id of the item; the panel for this item is found by it. */
  readonly id: string;
  /** The full name. A long one is cut to twelve words and read in full in the panel. */
  readonly name: string;
  /** The tone of the status: success is on file, warning needs a check, danger needs you. */
  readonly tone: LiftTone;
  /** The status in words, from `lib/status-words.ts` (Title Case). */
  readonly status: string;
  /** A quiet tag after the name ("Mandatory"). */
  readonly tag?: string | undefined;
  /** One quiet line of values under the name ("Documents: 3 of 12. Ends 12 Dec 2026"): at most 12 words, never a sentence. */
  readonly meta?: string | undefined;
  /** The one thing to do about this item. */
  readonly action?: LiftAction | undefined;
  /** Where the name leads (the item's panel). Without it the name is plain text. */
  readonly openHref?: string | undefined;
  /** The leading mark when the row has no kind: a status glyph. */
  readonly icon?: IconName | undefined;
  /**
   * What kind of thing the row is (a passport, a bank statement), from `lib/item-icons.ts`: a flat
   * icon in its tone tile in place of the status glyph. The status then shows in the chip, which
   * wears its own symbol. The tile is the same 32px as the glyph, so the row keeps its height.
   */
  readonly mark?: ItemMark | undefined;
}

const TONE_ICON: Record<LiftTone, IconName> = {
  success: 'check',
  warning: 'alert',
  danger: 'close',
  info: 'circle',
  neutral: 'circle',
};

/**
 * One row of any list in the product: a leading mark (the kind of item in a tone tile, or a status glyph), a name cut to twelve words, a status chip,
 * and at most one action. Opening the row (its name) shows the rest in the panel. At least 56px
 * tall on every width, one line of name. This is the only row; screens do not hand-build their own.
 */
export function ListRow({
  id,
  name,
  tone,
  status,
  tag,
  meta,
  action,
  openHref,
  icon,
  mark,
}: ListRowProps) {
  const short = shortName(name);
  const label = (
    <span className="lp-row-name row-key lift-check-name" data-value="name">
      {short.text}
    </span>
  );
  return (
    <div
      className={`row lift-check lift-check-${tone} lp-row`}
      data-pattern="list-row"
      data-row={id}
    >
      {mark ? (
        <MarkTile mark={mark} className="lift-check-mark" />
      ) : (
        <span className="lift-check-icon" aria-hidden="true">
          <Icon name={icon ?? TONE_ICON[tone]} size={16} />
        </span>
      )}
      <div className="lift-check-body lp-row-body">
        <div className="lift-check-line">
          {openHref ? (
            <a
              className="lp-row-open"
              href={openHref}
              data-pane-open={id}
              {...(short.cut ? { 'aria-label': name } : {})}
            >
              {label}
            </a>
          ) : (
            label
          )}
          {tag ? (
            <span className="lift-check-tag">
              <span className="lift-check-dot" aria-hidden="true">
                {'· '}
              </span>
              {tag}
            </span>
          ) : null}
        </div>
        {/* A value (counts and dates), never a sentence: the 30-word rule treats it as data. */}
        {meta ? (
          <p className="lp-row-meta" data-value="meta">
            {meta}
          </p>
        ) : null}
      </div>
      <StatusPill tone={tone} size="md">
        {status}
      </StatusPill>
      {action ? (
        <LiftLink
          className="btn btn-secondary lift-check-action"
          href={action.href}
          openGroup={action.openGroup}
        >
          {action.label}
        </LiftLink>
      ) : null}
    </div>
  );
}
