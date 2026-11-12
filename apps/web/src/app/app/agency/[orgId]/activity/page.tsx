import type { Metadata } from 'next';
import Link from 'next/link';
import { ActivityLog, type ActivityLogEntry } from '../../../../../components/activity-log';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { type SearchParamsRecord, pagingHref, parseCursor } from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { caseAnchorId } from '../case-anchor';
import { loadCaseActivity, loadMembers, loadOrgAccess } from '../console-data';

export const metadata: Metadata = { title: 'Agency Case Activity' };

export const dynamic = 'force-dynamic';

/** The address parameter that holds the older page's cursor. */
const BEFORE_KEY = 'before';
const LOG_ID = 'case-activity';

/**
 * A bounded view of actual case notes, not a new organization-wide audit authority. The notes sit
 * in the fixed-height log panel with its filters (case as What, author as Who for an
 * administrator), 50 at a time, newest first, with Show Older Entries for the next page
 * (Scroll Budget WP-SB5).
 */
export default async function AgencyActivityPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const before = parseCursor(query[BEFORE_KEY]);
  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    // Authors are named from the roster, which is administrator data: empty for anyone else.
    const members = await loadMembers(db, accountId, orgId, access);
    return loadCaseActivity(db, accountId, orgId, members, { before });
  });
  if (!data) return null;
  const pathname = `/app/agency/${orgId}/activity`;
  const casesHref = `/app/agency/${orgId}/cases`;
  const entries: ActivityLogEntry[] = data.notes.map((note) => ({
    id: note.id,
    what: note.caseTitle,
    detail: note.body,
    ...(note.authorEmail ? { who: note.authorEmail } : {}),
    at: note.createdAt.toISOString(),
    when: formatTimestampDate(note.createdAt),
  }));
  return (
    <>
      <PageHeader
        title={t('appAgency.appAgencyOrgidActivityPage.caseActivity')}
        description={t('appAgency.appAgencyOrgidActivityPage.recentNotesOnCasesYouCan')}
      />
      <article className="card">
        {data.caseLimitReached ? (
          <p className="card-body">
            {t('appAgency.appAgencyOrgidActivityPage.showingNotesFromTheTenMost')}
          </p>
        ) : null}
        {entries.length ? (
          <>
            <nav
              className="agency-activity-cases"
              aria-label={t('appAgency.appAgencyOrgidActivityPage.casesInThisActivity')}
            >
              <span className="muted u-fs-085">
                {t('appAgency.appAgencyOrgidActivityPage.openACase')}
              </span>
              <ul>
                {data.cases.map((c) => (
                  <li key={c.missionId}>
                    <Link href={`${casesHref}?case=${c.missionId}#${caseAnchorId(c.missionId)}`}>
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <ActivityLog
              id={LOG_ID}
              label={t('appAgency.appAgencyOrgidActivityPage.caseActivityEntries')}
              entries={entries}
              {...(data.nextCursor
                ? {
                    olderHref: pagingHref(
                      pathname,
                      query,
                      { [BEFORE_KEY]: data.nextCursor },
                      LOG_ID,
                    ),
                  }
                : {})}
              {...(before
                ? { newestHref: pagingHref(pathname, query, { [BEFORE_KEY]: null }, LOG_ID) }
                : {})}
            />
          </>
        ) : before ? (
          <p className="card-body">
            No older notes.{' '}
            <Link href={pagingHref(pathname, query, { [BEFORE_KEY]: null }, LOG_ID)}>
              Back to the Newest Notes
            </Link>
          </p>
        ) : (
          <EmptyState
            icon="activity"
            title={t('appAgency.appAgencyOrgidActivityPage.noCaseActivityRecorded')}
          >
            {t('appAgency.appAgencyOrgidActivityPage.newCaseNotesAppearHereWhen')}
          </EmptyState>
        )}
      </article>
    </>
  );
}
