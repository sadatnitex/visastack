import type { ReactNode } from 'react';
import type { LiftTone } from './types';

export interface StatusPillProps {
  readonly tone: LiftTone;
  /** `sm` is the badge size; `md` is the 28px pill used beside a row's name. */
  readonly size?: 'sm' | 'md';
  /** The words of the status, in Title Case. The tone adds a mark; it never stands alone. */
  readonly children: ReactNode;
}

/**
 * A status in words with a mark (a tick, a triangle or a cross) and a colour. Built on the shared
 * badge so the marks and tones stay in one place; `info` is the brand blue, which has no badge of
 * its own, so it sits on the neutral badge and the lift block recolours it.
 */
export function StatusPill({ tone, size = 'sm', children }: StatusPillProps) {
  const tones = tone === 'info' ? 'badge-neutral lift-pill-info' : `badge-${tone}`;
  return <span className={`badge ${tones} lift-pill lift-pill-${size}`}>{children}</span>;
}
