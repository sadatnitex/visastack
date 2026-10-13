import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

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

/** An empty area that says what it is for and what to do about it. It always shows an icon (a folder when none is given) so an empty list never reads as a broken one. */
export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: { readonly href: string; readonly label: string };
  readonly icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <IconTile name={icon ?? 'folder'} />
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

export interface ChecklistEntry {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
  readonly done: boolean;
  readonly href: string;
}

/**
 * A short "get started" list built from what the person has already done, so it is never
 * out of date and disappears on its own (the page shows it only while something is left).
 * Items still to do are links; finished ones are plain text with a tick.
 */
export function Checklist({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly ChecklistEntry[];
}) {
  const done = items.filter((item) => item.done).length;
  return (
    <article className="card u-mb-150">
      <p className="card-kicker">Get started</p>
      <h2 className="card-title">{title}</h2>
      <div className="meter-label">
        <span>
          {done} of {items.length} done
        </span>
      </div>
      <div className="meter" aria-hidden="true">
        <div
          className="meter-fill"
          style={{ width: `${Math.round((done / items.length) * 100)}%` }}
        />
      </div>
      <ol className="checklist">
        {items.map((item, index) => {
          const body = (
            <>
              <span className="checklist-mark" aria-hidden="true">
                {item.done ? '\u2713' : index + 1}
              </span>
              <span className="checklist-text">
                <span className="checklist-label">{item.label}</span>
                {item.hint ? <span className="checklist-hint">{item.hint}</span> : null}
              </span>
              {item.done ? <span className="sr-only">Done</span> : null}
            </>
          );
          return (
            <li key={item.key} className={item.done ? 'checklist-done' : undefined}>
              {item.done ? (
                <span className="checklist-item">{body}</span>
              ) : (
                <Link className="checklist-item" href={item.href}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

/**
 * The top of every page: where you are (small label), what this is (one heading), one
 * sentence on what it is for, and the actions that belong to the whole page. One pattern
 * everywhere, so a person learns the layout once.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
  as: Heading = 'h1',
  meta,
  lead,
}: {
  readonly eyebrow?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
  readonly as?: 'h1' | 'h2';
  /** A line of small facts under the description, for example stage and deadline. */
  readonly meta?: ReactNode;
  /** Something that belongs above the label, such as an organization's logo. */
  readonly lead?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {back ? (
          <Link href={back.href} className="page-back">
            <span aria-hidden="true">{'\u2190'}</span> {back.label}
          </Link>
        ) : null}
        {lead}
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <Heading className="page-title">{title}</Heading>
        {description ? <p className="page-description">{description}</p> : null}
        {meta ? <div className="page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/** A round-cornered square holding an icon, for empty states and list leads. */
export function IconTile({ name }: { readonly name: IconName }) {
  return (
    <span className="icon-tile">
      <Icon name={name} size={20} />
    </span>
  );
}
