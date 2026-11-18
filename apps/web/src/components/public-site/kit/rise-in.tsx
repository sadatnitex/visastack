'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import './kit.css';

export interface RiseInProps {
  readonly children: ReactNode;
  /** Seconds to wait once it is on screen, 0 to 0.4. */
  readonly delay?: number;
  readonly as?: 'div' | 'li' | 'article' | 'section';
  readonly className?: string;
}

/** One observer for every part, so a page with many rises pays for one. */
let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver !== 'function') return null;
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        shared?.unobserve(entry.target);
      }
    },
    { threshold: 0.12 },
  );
  return shared;
}

/** The delay class, in tenths of a second (0 to 4), so no inline style is needed (CSP). */
function delayClass(delay: number | undefined): string {
  const tenths = Math.min(4, Math.max(0, Math.round((delay ?? 0) * 10)));
  return tenths === 0 ? '' : ` kit-rise-d${tenths}`;
}

/**
 * Rises in once as it scrolls into view. It is fully visible with no JavaScript, with reduced
 * motion, with data saver and on a phone: it only starts hidden while `html[data-scenes="live"]`,
 * which the early mark sets before the first paint (see kit.css).
 */
export function RiseIn({ children, delay, as = 'div', className }: RiseInProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const watcher = observer();
    if (!watcher) {
      element.classList.add('is-in');
      return;
    }
    watcher.observe(element);
    return () => watcher.unobserve(element);
  }, []);
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`kit-rise${delayClass(delay)}${className ? ` ${className}` : ''}`}
    >
      {children}
    </Tag>
  );
}
