import type { ReactNode } from 'react';

export interface AboutDisclosureProps {
  /** The name of the fold, in Title Case ("About This", "Why This Step"). */
  readonly summary: string;
  /** The explanation: paragraphs. Folded, so it is read only when someone asks. */
  readonly children: ReactNode;
  /** An extra class for the page's own spacing. */
  readonly className?: string | undefined;
}

/**
 * One tap to read what a screen would otherwise explain in words. The sentences that must stay
 * reachable (what a count means, that preparing is not submitting) live here instead of in the
 * flow of the page, so the page itself stays short.
 */
export function AboutDisclosure({ summary, children, className }: AboutDisclosureProps) {
  return (
    <details className={`lift-help lift-about${className ? ` ${className}` : ''}`}>
      <summary>{summary}</summary>
      <div className="lift-help-body">{children}</div>
    </details>
  );
}
