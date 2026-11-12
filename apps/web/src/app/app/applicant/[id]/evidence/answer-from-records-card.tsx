import type { AskingAgency } from '@visastack/services';
import Link from 'next/link';
import { evidenceAnswerCatalog } from '../../../../../i18n/evidence-answer';
import { getServerT } from '../../../../../lib/i18n-server';

/** The most agencies the card names; the review step lists them all. */
export const CARD_AGENCY_LIMIT = 3;

/**
 * The one card above the list of requests when at least one agency waits for a document: who
 * waits, how many answers, and one button to the review step. With exactly one agency the button
 * opens that agency's review; with several it opens the list of who is asking, and the person
 * chooses. It reads nothing about what is saved, so it stays cheap.
 */
export function AnswerFromRecordsCard({
  applicantId,
  agencies,
}: {
  readonly applicantId: string;
  /** Agencies with at least one document request waiting on the person (`waitingDocuments >= 1`). */
  readonly agencies: readonly AskingAgency[];
}) {
  const t = getServerT(evidenceAnswerCatalog);
  const [only] = agencies;
  if (!only) return null;
  const base = `/app/applicant/${applicantId}/evidence/answer`;
  const href =
    agencies.length === 1 ? `${base}?agency=${encodeURIComponent(only.organizationId)}` : base;
  return (
    <article className="card answer-card">
      {agencies.length === 1 ? (
        // The agency and the count are facts about the request, so they are marked as data: one
        // line, no full stop, within the 30-word budget the Requests page already spends.
        <p className="u-m-0" data-value>
          {t.node('evidenceAnswer.waitingCard.one', {
            agency: only.organizationName,
            count: only.waiting,
          })}
        </p>
      ) : (
        <>
          <h2 className="card-title u-m-0">{t.node('evidenceAnswer.waitingCard.title')}</h2>
          <ul className="answer-card-list">
            {agencies.slice(0, CARD_AGENCY_LIMIT).map((agency) => (
              <li key={agency.organizationId}>
                <span data-value>
                  {t.node('evidenceAnswer.waitingCard.agencyLine', {
                    agency: agency.organizationName,
                    count: agency.waiting,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link className="btn btn-primary" href={href}>
        {t.node('evidenceAnswer.waitingCard.action')}
      </Link>
    </article>
  );
}
