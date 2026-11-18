import type { ReactNode } from 'react';
import './kit.css';

/** R5 local stand-in for the shared RiseIn: always visible (no JavaScript needed). Swapped at the TURN. */
export function RiseIn({
  children,
  delay = 0,
  as = 'div',
}: {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly as?: 'div' | 'li' | 'article';
}) {
  const Tag = as;
  const step = Math.max(0, Math.min(4, Math.round(delay / 0.1)));
  return <Tag className={`r5-rise r5-rise-${step}`}>{children}</Tag>;
}
