import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { LiftLink } from './lift-parts';
import { StatusPill } from './status-pill';
import type { LiftAction, LiftTone } from './types';

export interface ChecklistRowProps {
  /** The item's name. */
  readonly name: string;
  /** The tone of the status: success is on file, warning needs a check, danger needs you. */
  readonly tone: LiftTone;
  /** The status in words, in Title Case ("Missing", "On File"). */
  readonly status: string;
  /** A quiet tag after the name ("Mandatory"). */
  readonly necessity?: string | undefined;
  /** One plain sentence on what to do next. Done rows leave it out. */
  readonly next?: string | undefined;
  /** The one thing to do about this item. */
  readonly action?: LiftAction | undefined;
  /** Where the rule comes from, one quiet line. */
  readonly note?: ReactNode;
  /** Short facts that change what to do (which alternatives count, the chosen document), quiet. */
  readonly context?: ReactNode;
  /** A finished item: one line, with the fold beside the name instead of under it. */
  readonly compact?: boolean | undefined;
  /** The status picture; defaults to the tone's own (tick, triangle, cross, ring). */
  readonly icon?: IconName | undefined;
  /** Everything else about the item, folded under `moreLabel`. */
  readonly more?: ReactNode;
  /** The name of the fold, in Title Case ("More About This Item"). */
  readonly moreLabel?: string | undefined;
}

const TONE_ICON: Record<LiftTone, IconName> = {
  success: 'check',
  warning: 'alert',
  danger: 'close',
  info: 'circle',
  neutral: 'circle',
};

/** One item of a checklist: status icon, name and tag, one next step, one action, the rest folded. */
export function ChecklistRow({
  name,
  tone,
  status,
  necessity,
  next,
  action,
  note,
  context,
  compact,
  icon,
  more,
  moreLabel,
}: ChecklistRowProps) {
  return (
    <div className={`row lift-check lift-check-${tone}${compact ? ' lift-check-compact' : ''}`}>
      <span className="lift-check-icon" aria-hidden="true">
        <Icon name={icon ?? TONE_ICON[tone]} size={16} />
      </span>
      <div className="lift-check-body">
        <div className="lift-check-line">
          <span className="row-key lift-check-name">{name}</span>
          {necessity ? <span className="lift-check-tag">{necessity}</span> : null}
        </div>
        {next ? <p className="lift-check-next">{next}</p> : null}
        {context ? <div className="lift-check-context">{context}</div> : null}
        {note ? <p className="lift-check-note">{note}</p> : null}
        {more ? (
          <details className="lift-row-more">
            <summary>{moreLabel ?? 'More About This Item'}</summary>
            <div className="lift-row-more-body">{more}</div>
          </details>
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
