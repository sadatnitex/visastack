import { accountPrincipal, getApplicationMemory, requireAccess } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { applicantMemoryCatalog } from '../../../../../i18n/applicant-memory';
import { eventKey, eventLine } from '../../../../../lib/application-memory-labels';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { type SearchParamsRecord, TRAVELLER_LIST_STEP, parseShow } from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { MemoryCaseList, eventDate } from './memory-case-list';

export const metadata: Metadata = { title: 'Case History' };

export const dynamic = 'force-dynamic';

/**
 * v1.2 B08 (U06) Case History (once called Application Memory), WP-V3 part 3: every case of one person,
 * oldest record first within a case, with what was prepared, confirmed,
 * shared, reported as submitted and decided. Owner only.
 *
 * WP-SB1: the ten most recently active cases load first (Show More asks the server for ten more);
 * the latest case is open and older ones are closed, and each case's records scroll inside a panel
 * of fixed height, so the page stays short however long a person has used VisaStack.
 */
export default async function ApplicationMemoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<SearchParamsRecord & { readonly show?: string | string[] }>;
}) {
  await primeLocale();
  const t = getServerT(applicantMemoryCatalog);
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const shown = parseShow(query.show, { step: TRAVELLER_LIST_STEP });

  const memory = await withSession(async ({ db, accountId }) => {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'application_memory' },
    );
    if (!gate.ok) return null;
    const read = await getApplicationMemory(gate.value, { limit: shown });
    return read.ok ? read.value : null;
  });
  if (!memory) notFound();

  return (
    <>
      <PageHeader
        back={{ href: `/app/applicant/${id}/missions`, label: 'Cases' }}
        eyebrow={t('applicantMemory.appApplicantIdMemoryPage.cases')}
        title={t('applicantMemory.appApplicantIdMemoryPage.caseHistory')}
        description={t('applicantMemory.appApplicantIdMemoryPage.everyCaseForThisPersonWhat')}
        as="h2"
      />

      {memory.recordShares.length > 0 ? (
        <article className="card memory-shares" aria-labelledby="memory-shares-heading">
          <h3 className="card-title" id="memory-shares-heading">
            {t('applicantMemory.appApplicantIdMemoryPage.sharedOutsideACase')}
          </h3>
          <p className="memory-case-meta">
            {t('applicantMemory.appApplicantIdMemoryPage.theseSharesAreOfThisPerson')}
          </p>
          <ol className="memory-timeline">
            {memory.recordShares.map((share) => {
              const line = eventLine(share);
              return (
                <li className="memory-event memory-event-shared" key={eventKey(share)}>
                  <span className="memory-event-date">{eventDate(share)}</span>
                  <span className="memory-event-title">{line.title}</span>
                  {line.note ? <span className="memory-event-note">{line.note}</span> : null}
                </li>
              );
            })}
          </ol>
          <Link className="case-changes-all" href={`/app/applicant/${id}/sharing`}>
            {t('applicantMemory.appApplicantIdMemoryPage.openSharing')}
          </Link>
        </article>
      ) : null}

      {memory.cases.length === 0 ? (
        <article className="card">
          <EmptyState
            icon="briefcase"
            title={t('applicantMemory.appApplicantIdMemoryPage.noCasesYet')}
            action={{ href: `/app/applicant/${id}/missions`, label: 'Open Cases' }}
          >
            {t('applicantMemory.appApplicantIdMemoryPage.whenYouPrepareACaseEach')}
          </EmptyState>
        </article>
      ) : (
        <MemoryCaseList
          applicantId={id}
          cases={memory.cases}
          totalCases={memory.totalCases ?? memory.cases.length}
          searchParams={query}
        />
      )}
    </>
  );
}
