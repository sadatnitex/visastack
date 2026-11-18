import type { ReactNode } from 'react';

/** R5 local stand-in for the shared RiseIn: a plain element, always visible. Swapped for the real kit at the TURN. */
export function RiseIn({
  children,
  as = 'div',
}: {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly as?: 'div' | 'li' | 'article';
}) {
  const Tag = as;
  return <Tag>{children}</Tag>;
}
