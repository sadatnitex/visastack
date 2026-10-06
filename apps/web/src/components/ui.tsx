import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Small shared building blocks for the signed-in screens. They carry no state and no
 * data fetching, so a server page can use them directly. Each one maps to a class in
 * `app/globals.css`; the words are always supplied by the page, never invented here.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** A status label. The tone adds a mark (tick, triangle, cross) as well as a colour. */
export function StatusBadge({
  tone,
  children,
}: {
  readonly tone: Tone;
  readonly children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** The one thing to do next, with the reason, so the person never has to guess. */
export function NextStepCard({
  title,
  why,
  href,
  action,
  tone,
}: {
  readonly title: string;
  readonly why?: string;
  readonly href: string;
  readonly action: string;
  readonly tone?: 'warning' | 'ok';
}) {
  return (
    <section
      className={`next-step${tone ? ` next-step-tone-${tone}` : ''}`}
      aria-labelledby="next-step-title"
    >
      <div className="next-step-text">
        <p className="card-kicker" style={{ marginBottom: '0.25rem' }}>
          Next step
        </p>
        <h2 className="next-step-title" id="next-step-title">
          {title}
        </h2>
        {why ? <p className="next-step-why">{why}</p> : null}
      </div>
      <Link href={href} className="btn btn-primary">
        {action}
      </Link>
    </section>
  );
}

export interface AttentionEntry {
  readonly key: string;
  readonly href: string;
  readonly label: string;
  readonly detail?: string;
  /** How many items this line stands for; shown as a count. */
  readonly count?: number;
  readonly tone?: Tone;
}

/** What needs a person's attention, each line a link to where it is dealt with. */
export function AttentionList({ items }: { readonly items: readonly AttentionEntry[] }) {
  return (
    <ul className="attention-list">
      {items.map((item) => (
        <li className="attention-item" key={item.key}>
          <Link className="attention-link" href={item.href}>
            <span className="attention-text">
              <span className="attention-label">{item.label}</span>
              {item.detail ? <span className="attention-detail">{item.detail}</span> : null}
            </span>
            <span className="attention-end">
              {item.count !== undefined ? (
                <StatusBadge tone={item.tone ?? 'warning'}>{item.count}</StatusBadge>
              ) : null}
              <span className="attention-chevron" aria-hidden="true">
                ›
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** An empty area that says what it is for and what to do about it. */
export function EmptyState({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: { readonly href: string; readonly label: string };
}) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-body">{children}</p>
      {action ? (
        <Link href={action.href} className="btn btn-secondary">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Secondary detail that stays out of the way until asked for. */
export function Disclosure({
  title,
  hint,
  open,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        <span className="disclosure-title">{title}</span>
        {hint ? <span className="disclosure-hint">{hint}</span> : null}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
