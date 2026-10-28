import Link from 'next/link';
import { atLevel } from '../../../../components/depth';
import { agree } from '../../../../lib/plural';
import type { DoNextItem, DoNextTier } from './do-next';
import { FollowUpCopy } from './follow-up-copy';

/** How many items the dashboard shows before pointing to the case list for the rest. */
export const DO_NEXT_VISIBLE = 8;

const TIER_LABEL: Readonly<Record<DoNextTier, string>> = {
  1: 'Past Due',
  2: 'Waiting for Review',
  3: 'Overdue Tasks',
  4: 'Needs an Owner',
};

/**
 * The agency's "Do Next" list: each item with its owner, the reason it is here and one action.
 * Built by `buildDoNext`, which ranks only what this person already sees.
 */
export function DoNextList({
  items,
  admin,
  filtered,
}: {
  readonly items: readonly DoNextItem[];
  readonly admin: boolean;
  /** A search or quick view narrows the cases on the page. */
  readonly filtered: boolean;
}) {
  const shown = items.slice(0, DO_NEXT_VISIBLE);
  return (
    <section className="card do-next" aria-labelledby="do-next-heading">
      <h2 className="card-title" id="do-next-heading">
        Do Next
      </h2>
      <p className="card-body do-next-intro">
        {filtered ? 'For the cases in your current view. ' : ''}
        {admin
          ? 'Past due items first, then items waiting for review, overdue tasks and cases with no owner.'
          : 'Overdue tasks on the cases assigned to you, most overdue first.'}
      </p>
      {shown.length === 0 ? (
        <p className="do-next-empty">Nothing needs you first right now.</p>
      ) : (
        <ol className="do-next-list">
          {shown.map((item, index) => (
            // The first item is the one thing to do now; the rest wait at Browse.
            <li
              key={item.key}
              className={`do-next-item do-next-tier-${item.tier}`}
              {...(index === 0 ? {} : atLevel('browse'))}
            >
              <div className="do-next-item-head">
                <span className="do-next-tier">{TIER_LABEL[item.tier]}</span>
                <h3 className="do-next-title">{item.heading}</h3>
              </div>
              <p className="do-next-context">
                {item.traveller}
                {item.caseTitle && item.caseTitle !== item.heading ? ` · ${item.caseTitle}` : ''}
                {item.caseTitle === null ? ' · Not tied to one case' : ''}
              </p>
              <dl className="do-next-facts">
                <div>
                  <dt>Owner</dt>
                  <dd>{item.owner}</dd>
                </div>
                <div>
                  <dt>Why</dt>
                  <dd>{item.reason}</dd>
                </div>
              </dl>
              <div className="do-next-action">
                {item.action.kind === 'follow-up' ? (
                  <FollowUpCopy
                    text={item.action.message.text}
                    agencyNoteLeftOut={item.action.message.agencyNoteLeftOut}
                    summary={item.action.label}
                  />
                ) : (
                  <Link href={item.action.href} className="btn btn-secondary do-next-link">
                    {item.action.label}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {items.length > 1 ? (
        <p className="muted do-next-more" data-only="glance">
          {items.length - 1} more {agree(items.length - 1, 'needs', 'need')} you. Choose Browse to
          see {agree(items.length - 1, 'it', 'them')}.
        </p>
      ) : null}
      {items.length > shown.length ? (
        <p className="muted do-next-more" {...atLevel('browse')}>
          Showing {shown.length} of {items.length}. The rest are in the case list below.
        </p>
      ) : null}
    </section>
  );
}
