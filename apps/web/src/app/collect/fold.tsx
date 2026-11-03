import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';

/**
 * A quiet fold for what a guest does not need to look at right now (UMPE P13): the choice already
 * made, files already placed, items that never hold up a submission. The summary says what is
 * inside and, in a status line, where it stands, so nothing is hidden without being named. Native
 * details, so keyboard and screen readers work with no script; one tap opens it.
 */
export function Fold({
  title,
  headingId,
  status,
  open,
  children,
}: {
  readonly title: string;
  /** When given, the title is a level-two heading with this id, so the page outline keeps it. */
  readonly headingId?: string;
  readonly status?: string | undefined;
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details className="collect-fold" open={open}>
      <summary className="collect-fold-summary">
        {headingId ? (
          <h2 id={headingId} className="collect-fold-title">
            {title}
          </h2>
        ) : (
          <span className="collect-fold-title">{title}</span>
        )}
        {status ? <output className="collect-fold-status">{status}</output> : null}
        <Icon name="chevronDown" size={18} />
      </summary>
      <div className="collect-fold-body">{children}</div>
    </details>
  );
}
