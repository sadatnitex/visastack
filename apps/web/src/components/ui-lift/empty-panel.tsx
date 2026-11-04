import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { LiftHeading, LiftLink } from './lift-parts';
import type { LiftAction, LiftHeadingLevel } from './types';

export interface EmptyPanelProps {
  readonly icon?: IconName;
  /** What is empty, in Title Case. */
  readonly title: string;
  /** Give a level to make the title a real heading; without one it is a paragraph. */
  readonly level?: LiftHeadingLevel | undefined;
  /** One plain line on what goes here and how to start. */
  readonly children: ReactNode;
  /** The one filled button. */
  readonly primary?: LiftAction | undefined;
  /** A quieter second way forward. */
  readonly secondary?: LiftAction | undefined;
}

/** What a place looks like before anything is in it: a tile, a title, one line, one way to begin. */
export function EmptyPanel({
  icon = 'clipboard',
  title,
  level,
  children,
  primary,
  secondary,
}: EmptyPanelProps) {
  return (
    <div className="lift-empty">
      <span className="lift-empty-tile" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      {level ? (
        <LiftHeading level={level} className="lift-empty-title">
          {title}
        </LiftHeading>
      ) : (
        <p className="lift-empty-title">{title}</p>
      )}
      <div className="lift-empty-line">{children}</div>
      {primary || secondary ? (
        <div className="lift-empty-actions">
          {primary ? (
            <LiftLink className="btn btn-primary" href={primary.href} openGroup={primary.openGroup}>
              {primary.label}
            </LiftLink>
          ) : null}
          {secondary ? (
            <LiftLink
              className="btn btn-secondary"
              href={secondary.href}
              openGroup={secondary.openGroup}
            >
              {secondary.label}
            </LiftLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
