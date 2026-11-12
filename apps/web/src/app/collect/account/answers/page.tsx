import {
  type OwnCollectionResponse,
  accountPrincipal,
  listApplicants,
  listOwnCollectionResponses,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DestinationLabel } from '../../../../components/destination-label';
import { StatusBadge } from '../../../../components/ui';
import { collectCatalog } from '../../../../i18n/collect';
import { formatTimestampDate } from '../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { withSession } from '../../../../lib/session';
import { destinationName } from '../../../app/agency/[orgId]/collection/terms';
import { WithdrawAnswerButton } from '../response-form';

export const metadata: Metadata = {
  title: 'Your Answers to Agencies',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

interface PersonAnswers {
  readonly personId: string;
  readonly displayName: string;
  readonly answers: readonly OwnCollectionResponse[];
}

function countsLine(answer: OwnCollectionResponse): string {
  const parts = [
    answer.documents === 1 ? '1 Document' : `${answer.documents} Documents`,
    answer.details === 1 ? '1 Detail' : `${answer.details} Details`,
  ];
  if (answer.missing > 0) parts.push(`${answer.missing} Still Missing`);
  return parts.join(' · ');
}

/**
 * Every answer the signed-in person gave to agency requests, for each of their people (UMPE P7):
 * who it went to, when, and how much it holds, with a way to withdraw it. Needs no request link,
 * so an answer can be withdrawn long after the link has closed. "Submitted to Agency" means it was
 * sent; it never means reviewed or accepted.
 */
export default async function YourAnswersPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly sent?: string | string[];
    readonly withdrawn?: string | string[];
  }>;
}) {
  await primeLocale();
  const t = getServerT(collectCatalog);
  // Always open, whatever the switch says: what was shared can always be seen and withdrawn.
  const query = await searchParams;
  const sent = query?.sent === '1';
  const withdrawn = query?.withdrawn === '1';
  const people: PersonAnswers[] = await withSession(async ({ db, accountId }) => {
    // Every person, archived and Recently Deleted too: an answer stays visible and withdrawable.
    const owned = [
      ...(await listApplicants(db, accountId)),
      ...(await listApplicants(db, accountId, { view: 'archived' })),
      ...(await listApplicants(db, accountId, { view: 'recentlyDeleted' })),
    ];
    const found: PersonAnswers[] = [];
    for (const person of owned) {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: person.id },
        { purpose: 'collection_response' },
      );
      if (!proof.ok) continue;
      const answers = await listOwnCollectionResponses(db, proof.value);
      if (answers.ok && answers.value.length > 0) {
        found.push({
          personId: person.id,
          displayName: person.displayName,
          answers: answers.value,
        });
      }
    }
    return found;
  });

  return (
    <section className="section container stack">
      <h1 className="page-title">
        {t.node('collect.collectAccountAnswersPage.yourAnswersToAgencies')}
      </h1>
      {sent ? (
        <output className="notice notice-ok">
          {t.node('collect.collectAccountAnswersPage.submittedToAgencyTheyCanOpen')}
        </output>
      ) : null}
      {withdrawn ? (
        <output className="notice notice-ok">
          {t.node('collect.collectAccountAnswersPage.withdrawnTheAgencyCanNoLonger')}
        </output>
      ) : null}
      {people.length === 0 ? (
        <p className="muted">
          {t.node('collect.collectAccountAnswersPage.youHaveNotAnsweredAnyAgency')}
        </p>
      ) : (
        people.map((person) => (
          <section
            key={person.personId}
            className="card"
            aria-labelledby={`answers-${person.personId}`}
          >
            <div className="card-body stack">
              <h2 id={`answers-${person.personId}`}>{person.displayName}</h2>
              <ul className="collect-response-answers">
                {person.answers.map((answer) => (
                  <li key={answer.id} className="collect-response-answer">
                    <p>
                      <strong>
                        {answer.agencyName ?? 'An Agency No Longer Active on VisaStack'}
                      </strong>
                      , for <DestinationLabel destination={destinationName(answer.destination)} />{' '}
                      (Request Version {answer.revisionNo})
                    </p>
                    <p className="u-fs-085">
                      {answer.withdrawnAt ? (
                        <StatusBadge tone="neutral">
                          {t.node(
                            'collect.collectAccountAnswersPage.withdrawnFormattimestampdate',
                            {
                              formatTimestampDate: formatTimestampDate(answer.withdrawnAt),
                            },
                          )}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">
                          {t.node('collect.collectAccountAnswersPage.submittedToAgency')}
                        </StatusBadge>
                      )}{' '}
                      Sent {formatTimestampDate(answer.submittedAt)} · {countsLine(answer)}
                    </p>
                    {answer.withdrawnAt ? null : (
                      <WithdrawAnswerButton
                        personId={person.personId}
                        responseId={answer.id}
                        agencyName={answer.agencyName ?? 'The agency'}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))
      )}
      <p className="u-fs-085">
        <Link href="/collect/account">
          {t.node('collect.collectAccountAnswersPage.continueAnOpenRequest')}
        </Link>{' '}
        · <Link href="/app">{t.node('collect.collectAccountAnswersPage.goToYourRecord')}</Link>
      </p>
    </section>
  );
}
