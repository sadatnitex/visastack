import type { ReactNode } from 'react';
import { statusIcon } from '../../lib/item-icons';
import { Icon } from '../icons';
import type { LiftTone } from './types';

export interface StatusPillProps {
  readonly tone: LiftTone;
  /** `sm` is the badge size; `md` is the 28px pill used beside a row's name. */
  readonly size?: 'sm' | 'md';
  /** The words of the status, in Title Case. The tone adds a mark; it never stands alone. */
  readonly children: ReactNode;
}

/**
 * A status in words with a symbol and a colour. Built on the shared badge so the tones stay in one
 * place; `info` is the brand blue, which has no badge of its own, so it sits on the neutral badge
 * and the lift block recolours it. A word in the status map (`lib/item-icons.ts`) wears its own
 * symbol (done, needs you, needs a check, waiting, received, locked) in place of the plain tick,
 * triangle or cross; any other word keeps the plain mark. The word is always the name.
 */
export function StatusPill({ tone, size = 'sm', children }: StatusPillProps) {
  const tones = tone === 'info' ? 'badge-neutral lift-pill-info' : `badge-${tone}`;
  const icon = typeof children === 'string' ? statusIcon(children) : undefined;
  return (
    <span className={`badge ${tones} lift-pill lift-pill-${size}${icon ? ' lift-pill-icon' : ''}`}>
      {icon ? <Icon name={icon} size={size === 'md' ? 16 : 14} /> : null}
      {children}
    </span>
  );
}
