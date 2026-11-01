import { createTranslator } from '@visastack/i18n';
import {
  type ListedApplicant,
  TRAVELLER_RECENTLY_DELETED_DAYS,
  getConsents,
  listApplicants,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShowMore } from '../../../components/show-more';
import { EmptyState, PageHeader } from '../../../components/ui';
import { formatTimestampDate } from '../../../lib/format-date';
import { getLocale } from '../../../lib/locale';
import {
  type SearchParamsRecord,
  TRAVELLER_LIST_STEP,
  nextShow,
  parseShow,
} from '../../../lib/paging';
import { relationshipLabel } from '../../../lib/relationship-labels';
import { withSession } from '../../../lib/session';
import { AddApplicantForm } from '../add-applicant-form';
import { removedInDays } from '../applicant/[id]/traveller-manage/labels';
import { OUTCOME_PARAM, outcomeMessage } from '../applicant/[id]/traveller-manage/messages';
import { RestoreTravellerForm } from '../applicant/[id]/traveller-manage/restore-form';

export const metadata: Metadata = { title: 'All Travellers' };

export const dynamic = 'force-dynamic';

const PATHNAME = '/app/applicants';

/** One capped list of travellers that are not in everyday use (LC-E): Archived or Recently Deleted. */
function ParkedTravellers({
  kind,
  people,
  query,
  t,
  now,
}: {
  readonly kind: 'archived' | 'deleted';
  readonly people: readonly ListedApplicant[];
  readonly query: SearchParamsRecord;
  readonly t: ReturnType<typeof createTranslator>;
  readonly now: Date;
}) {
  if (people.length === 0) return null;
  const paging = { step: TRAVELLER_LIST_STEP };
  const shown = Math.min(parseShow(query[kind], paging), people.length);
  const next = shown < people.length ? nextShow(shown, paging) : null;
  const deleted = kind === 'deleted';
  // The result of the last action is shown once: Show More does not carry it along.
  const { [OUTCOME_PARAM]: _outcome, ...listQuery } = query;
  const headingId = `travellers-${kind}-heading`;
  return (
    <article className="card" aria-labelledby={headingId}>
      <p className="card-kicker">{deleted ? 'Recently Deleted' : 'Archived'}</p>
      <h2 className="card-title" id={headingId}>
        {deleted ? 'Recently Deleted Records' : 'Archived Travellers'}
      </h2>
      <p className="card-body muted">
        {deleted
          ? `Empty records you removed. Each is removed for good after ${TRAVELLER_RECENTLY_DELETED_DAYS} days; until then you can restore it.`
          : 'Hidden from your everyday lists, and their reminders are paused. Nothing is deleted.'}
      </p>
      <ul className="rows u-mt-050 lc-traveller-list">
        {people.slice(0, shown).map((person, index) => (
          <li className="row lc-traveller-row" key={person.id} id={`travellers-${kind}-${index}`}>
            <span className="row-key">
              {deleted ? (
                person.displayName
              ) : (
                <Link href={`/app/applicant/${person.id}`}>{person.displayName}</Link>
              )}
            </span>
            <span className="row-end">
              <span className="badge badge-neutral">
                {relationshipLabel(person.relationship, t)}
              </span>
              <span className="muted">
                {deleted
                  ? person.purgeAfter
                    ? removedInDays(person.purgeAfter, now)
                    : 'Recently Deleted'
                  : person.archivedAt
                    ? `Archived ${formatTimestampDate(person.archivedAt)}`
                    : 'Archived'}
              </span>
              <RestoreTravellerForm
                applicantId={person.id}
                name={person.displayName}
                deleted={deleted}
                returnTo="list"
              />
            </span>
          </li>
        ))}
      </ul>
      {people.length > TRAVELLER_LIST_STEP ? (
        <ShowMore
          id={`travellers-${kind}-more`}
          landOn={`travellers-${kind}-${shown}`}
          pathname={PATHNAME}
          searchParams={listQuery}
          next={next === null ? null : { [kind]: next }}
          shown={shown}
          total={people.length}
          noun={
            deleted
              ? { one: 'record', other: 'records' }
              : { one: 'traveller', other: 'travellers' }
          }
        />
      ) : null}
    </article>
  );
}

export default async function ApplicantsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const query = (await searchParams) ?? {};
  const t = createTranslator(await getLocale());
  const data = await withSession(async ({ db, accountId }) => {
    const [applicants, archived, deleted, consents] = await Promise.all([
      listApplicants(db, accountId),
      listApplicants(db, accountId, { view: 'archived' }),
      listApplicants(db, accountId, { view: 'recentlyDeleted' }),
      getConsents(db, accountId),
    ]);
    return { applicants, archived, deleted, coreGranted: Boolean(consents.CORE_PROCESSING) };
  });
  const result = outcomeMessage(query[OUTCOME_PARAM]);
  const now = new Date();

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Travellers"
        title="People on Your Account"
        description="Yourself and anyone you manage records for - family members or a minor under your guardianship."
      />
      {result ? (
        <output
          id="traveller-outcome"
          tabIndex={-1}
          className={`notice ${result.ok ? 'notice-ok' : 'notice-warn'}`}
        >
          {result.text}
        </output>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">All Travellers</p>
          <h2 className="card-title">
            {data.applicants.length} {data.applicants.length === 1 ? 'person' : 'people'}
          </h2>
          {data.applicants.length === 0 ? (
            <EmptyState icon="users" title="No Travellers Yet">
              Add yourself first. Your passport details and documents are entered once and reused
              for every application.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.applicants.map((a) => (
                <Link className="row row-link" key={a.id} href={`/app/applicant/${a.id}`}>
                  <span className="row-key">{a.displayName}</span>
                  <span className="row-end">
                    <span className="badge badge-neutral">
                      {relationshipLabel(a.relationship, t)}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">New</p>
          <h2 className="card-title">Add a Traveller</h2>
          {data.coreGranted ? (
            <AddApplicantForm selfAdded={data.applicants.some((a) => a.relationship === 'SELF')} />
          ) : (
            <p className="card-body">
              Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
              <Link href="/app">Home</Link> to start adding traveller records.
            </p>
          )}
        </article>

        <ParkedTravellers kind="archived" people={data.archived} query={query} t={t} now={now} />
        <ParkedTravellers kind="deleted" people={data.deleted} query={query} t={t} now={now} />
      </div>
    </section>
  );
}
