'use client';

import { type ReactNode, useEffect, useRef } from 'react';

export interface RiseInProps {
  readonly children: ReactNode;
  /** Seconds of wait before the rise, 0 to 0.4. */
  readonly delay?: number;
  readonly as?: 'div' | 'li' | 'article';
}

/**
 * Rise-in on scroll (R1 kit stand-in, same name and props). Visible with no script, with reduced
 * motion, with data saver and on phones: the stylesheet hides it only while html[data-scenes="live"].
 */
export function RiseIn({ children, delay = 0, as: Tag = 'div' }: RiseInProps) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver !== 'function') {
      node.setAttribute('data-in', '');
      return;
    }
    // Already on the first screen: show it at once, with no wait for a scroll (and no fade to read through).
    if (node.getBoundingClientRect().top < window.innerHeight) {
      node.setAttribute('data-in', 'now');
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '');
            watcher.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);
  // Tenths of a second, 0 to 4, as a shared class (no inline style).
  const wait = Math.round(Math.min(0.4, Math.max(0, delay)) * 10);
  return (
    <Tag ref={ref as never} className={`hk-rise hk-wait-${wait}`}>
      {children}
    </Tag>
  );
}
