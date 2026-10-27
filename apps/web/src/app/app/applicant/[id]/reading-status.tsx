import type { ReadingSource, ReadingStage } from '@visastack/services';
import Link from 'next/link';
import { StatusBadge } from '../../../../components/ui';
import {
  READING_SOURCE_LABELS,
  READING_SOURCE_NOTES,
  type ReadingOffer,
  type ReadingStatusCopy,
} from '../../../../lib/document-reading';

/**
 * How a file's reading is going, in the five states of ADR 0019 (S6): Checking the File, Reading
 * the File, We Found These Details, We Could Not Read This One, Needs Attention. The state name
 * and the sentence under it sit in one polite status, so a screen reader hears a file move from
 * one state to the next while the page refreshes itself. A file that could not be read always has
 * a way forward: add the details yourself.
 */
export function ReadingStatus({
  copy,
  stage,
  applicantId,
}: {
  readonly copy: ReadingStatusCopy;
  readonly stage: ReadingStage;
  readonly applicantId: string;
}) {
  return (
    <div className="reading-status" data-stage={stage}>
      <output className="reading-status-text">
        <StatusBadge tone={copy.tone}>{copy.title}</StatusBadge>
        <span>{copy.body}</span>
      </output>
      {stage === 'could_not_read' ? (
        <Link className="btn btn-secondary" href={`/app/applicant/${applicantId}/profile`}>
          Add the Details Yourself
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Where one suggestion came from, in plain words, under the suggestion it belongs to. `detail`
 * replaces the general sentence when the suggestion carries a more exact one of its own.
 */
export function ReadingSourceNote({
  source,
  detail,
}: {
  readonly source: ReadingSource;
  readonly detail?: string | null;
}) {
  return (
    <p className="finding-origin">
      <StatusBadge tone="neutral">{READING_SOURCE_LABELS[source]}</StatusBadge>
      <small className="muted">{detail || READING_SOURCE_NOTES[source]}</small>
    </p>
  );
}

/**
 * The one invitation to switch AI reading on. Shown once at the top of the page, never once per
 * document, and it links to the same switch on Home where reading permissions already live.
 */
export function ReadingOfferCard({ offer }: { readonly offer: ReadingOffer }) {
  return (
    <article className="card reading-offer u-mb-150">
      <h3 className="card-title">{offer.question}</h3>
      <p className="card-body">{offer.detail}</p>
      <Link className="btn btn-primary" href="/app#permissions">
        {offer.action}
      </Link>
    </article>
  );
}
