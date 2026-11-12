import Link from 'next/link';
import { atLevel } from '../../../../components/depth';
import { AboutDisclosure } from '../../../../components/ui-lift/about-disclosure';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { getServerT } from '../../../../lib/i18n-server';
import { agree } from '../../../../lib/plural';
import { CHASE_AFTER_DAYS, type DoNextItem, type DoNextTier } from './do-next';
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
 * Built by `buildDoNextList`, which ranks only what this person already sees.
 */
export function DoNextList({
  items,
  admin,
  filtered,
  quietHidden = 0,
  base,
}: {
  readonly items: readonly DoNextItem[];
  readonly admin: boolean;
  /** A search or quick view narrows the cases on the page. */
  readonly filtered: boolean;
  /** Requests with no reply that were left off the list (see `CHASE_VISIBLE`). */
  readonly quietHidden?: number;
  /** The console base path, for the link to the Clients request list. */
  readonly base: string;
}) {
  const t = getServerT(appAgencyCatalog);
  const shown = items.slice(0, DO_NEXT_VISIBLE);
  return (
    <section className="card do-next" aria-labelledby="do-next-heading">
      <h2 className="card-title" id="do-next-heading">
        {t('appAgency.appAgencyOrgidDoNextList.doNext')}
      </h2>
      {filtered ? (
        <span className="badge badge-neutral do-next-filtered">
          {t('appAgency.appAgencyOrgidDoNextList.filteredView')}
        </span>
      ) : null}
      <AboutDisclosure summary={t('appAgency.appAgencyOrgidDoNextList.howThisIsSorted')}>
        <p className="card-body do-next-intro">
          {filtered ? t('appAgency.appAgencyOrgidDoNextList.forTheCasesInYourCurrent') : ''}
          {admin
            ? t('appAgency.appAgencyOrgidDoNextList.pastDueItemsFirstThenRequests', {
                CHASE_AFTER_DAYS,
              })
            : t('appAgency.appAgencyOrgidDoNextList.overdueTasksOnTheCasesAssigned')}
        </p>
      </AboutDisclosure>
      {shown.length === 0 ? (
        <p className="do-next-empty">
          {t('appAgency.appAgencyOrgidDoNextList.nothingNeedsYouFirstRightNow')}
        </p>
      ) : (
        <ol className="do-next-list">
          {shown.map((item, index) => (
            // The first item is the one thing to do now; the rest wait at Browse.
            <li
              key={item.key}
              className={`do-next-item do-next-tier-${item.tier}${item.tierLabel ? ' do-next-chase' : ''}`}
              {...(index === 0 ? {} : atLevel('browse'))}
            >
              <div className="do-next-item-head">
                <span className="do-next-tier">{item.tierLabel ?? TIER_LABEL[item.tier]}</span>
                <h3 className="do-next-title">{item.heading}</h3>
              </div>
              <p className="do-next-context" data-value>
                {item.traveller}
                {item.caseTitle && item.caseTitle !== item.heading ? ` · ${item.caseTitle}` : ''}
                {item.caseTitle === null
                  ? t('appAgency.appAgencyOrgidDoNextList.notTiedToOneCase')
                  : ''}
              </p>
              <dl className="do-next-facts">
                <div>
                  <dt>{t('appAgency.appAgencyOrgidDoNextList.owner')}</dt>
                  <dd data-value>{item.owner}</dd>
                </div>
                <div>
                  <dt>{t('appAgency.appAgencyOrgidDoNextList.why')}</dt>
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
      {quietHidden > 0 ? (
        <p className="muted do-next-more do-next-quiet" {...atLevel('browse')}>
          {filtered ? (
            // The count is for the cases in view; the list it leads to is every open request.
            <>
              {quietHidden} more{' '}
              {agree(quietHidden, 'request in this view has', 'requests in this view have')} had no
              reply. <Link href={`${base}/clients?status=open`}>See All Open Requests</Link>
            </>
          ) : (
            <Link href={`${base}/clients?status=open`}>
              {t('appAgency.appAgencyOrgidDoNextList.quiethiddenMoreAgreeHadNoReply', {
                quietHidden,
                agree: agree(quietHidden, 'request has', 'requests have'),
              })}
            </Link>
          )}
        </p>
      ) : null}
      {items.length > shown.length ? (
        <p className="muted do-next-more" {...atLevel('browse')}>
          {t('appAgency.appAgencyOrgidDoNextList.showingLengthOfLength2TheRest', {
            length: shown.length,
            length2: items.length,
          })}
        </p>
      ) : null}
    </section>
  );
}
