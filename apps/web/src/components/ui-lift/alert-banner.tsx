import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import type { LiftTone } from './types';

export interface AlertBannerProps {
  /** `danger` and `warning` carry a 4px edge in their colour; `info` is the brand blue. */
  readonly tone: Exclude<LiftTone, 'neutral'>;
  /** What happened, in one plain sentence. Kept a paragraph; the page owns the headings. */
  readonly title: string;
  /** Why it matters, and what was changed: paragraphs, a list. */
  readonly children?: ReactNode;
  /** The one thing to do about it: a button or a link. */
  readonly action?: ReactNode;
  /** `alert` is read out at once; use it only for what a person must stop and read. */
  readonly role?: 'alert' | 'status';
}

const TONE_ICON: Record<AlertBannerProps['tone'], IconName> = {
  danger: 'alert',
  warning: 'alert',
  info: 'circle',
  success: 'check',
};

/** A notice with a tinted ground, a coloured edge, a mark and its words. */
export function AlertBanner({ tone, title, children, action, role }: AlertBannerProps) {
  return (
    <div className={`lift-alert lift-alert-${tone}`} {...(role ? { role } : {})}>
      <span className="lift-alert-icon" aria-hidden="true">
        <Icon name={TONE_ICON[tone]} size={20} />
      </span>
      <div className="lift-alert-main">
        <p className="lift-alert-title">{title}</p>
        {children ? <div className="lift-alert-body">{children}</div> : null}
        {action ? <div className="lift-alert-action">{action}</div> : null}
      </div>
    </div>
  );
}
