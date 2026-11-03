import {
  type AgencyCollectionScope,
  type CollectionResponseItemView,
  type CollectionResponseView,
  type CollectionReview,
  type Db,
  type GuestHoldView,
  type GuestSubmissionView,
  type StepUpProof,
  collectionResponseAccesses,
  listCollectionReviews,
  listGuestSubmissions,
  readCollectionResponse,
  readGuestHold,
} from '@visastack/services';
import Link from 'next/link';
import { StatusBadge } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { formatFileSize } from '../../../../../lib/format-size';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { downloadResponseFileAction } from './collection-response-actions';
import { GuestHoldForm, ReviewAnswerForm } from './collection-review-forms';

/** The newest answers the panel shows at once. */
export const PANEL_RESPONSE_LIMIT = 20;

/** Every live answer to this request, read through the agency's own scope (none for any refusal). */
export async function loadCollectionResponses(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  /** A fresh identity check that opens one answer's protected details (`protectedDetailsStepUp`). */
  reveal?: { readonly responseId: string; readonly stepUp: StepUpProof },
): Promise<CollectionResponseView[]> {
  const encryption = createKeyManagementPort();
  const accesses = (await collectionResponseAccesses(db, scope, requestId)).slice(
    0,
    PANEL_RESPONSE_LIMIT,
  );
  const found: CollectionResponseView[] = [];
  for (const access of accesses) {
    const view = await readCollectionResponse(db, access, {
      ...(encryption ? { encryption } : {}),
      ...(reveal?.responseId === access.responseId ? { stepUp: reveal.stepUp } : {}),
    });
    if (view.ok) found.push(view.value);
  }
  return found;
}

/** UMPE P9: the guest submissions, every review decision and the guest legal hold of one request. */
export interface CollectionQueueExtras {
  readonly guest: readonly GuestSubmissionView[];
  readonly reviews: ReadonlyMap<string, readonly CollectionReview[]>;
  readonly hold: GuestHoldView | null;
}

export const NO_QUEUE_EXTRAS: CollectionQueueExtras = {
  guest: [],
  reviews: new Map(),
  hold: null,
};

export async function loadCollectionQueueExtras(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<CollectionQueueExtras> {
  const [guest, reviews, hold] = await Promise.all([
    listGuestSubmissions(db, scope, requestId),
    listCollectionReviews(db, scope, requestId),
    readGuestHold(db, scope, requestId),
  ]);
  return { guest: guest.slice(0, PANEL_RESPONSE_LIMIT), reviews, hold };
}

const DECISION_LABELS = {
  RECEIVED: 'Received',
  NEEDS_CORRECTION: 'Needs Correction',
  ACCEPTED: 'Accepted',
} as const;

/** The latest decision on an answer, as a badge line, or the plain arrival state. */
function ReviewState({ reviews }: { readonly reviews: readonly CollectionReview[] | undefined }) {
  const latest = reviews?.[0];
  if (!latest) return null;
  return (
    <p className="u-fs-085">
      <StatusBadge
        tone={
          latest.decision === 'NEEDS_CORRECTION'
            ? 'warning'
            : latest.decision === 'ACCEPTED'
              ? 'success'
              : 'neutral'
        }
      >
        {DECISION_LABELS[latest.decision]}
      </StatusBadge>{' '}
      Decided {formatTimestampDate(latest.decidedAt)}
      {latest.note ? ` · ${latest.note}` : ''}
    </p>
  );
}

function itemOptions(lines: readonly CollectionResponseItemView[]) {
  return lines.map((line) => ({ id: line.itemId, label: line.item.label }));
}

/**
 * The answers travellers sent to one request (UMPE P7), newest first. Each shows exactly what the
 * person chose for each issued item: the exact file versions (by name and version number, each
 * with a safe preview), the details they confirmed, and what is Still Missing. "Submitted to
 * Agency" means it arrived; it is never shown as Reviewed or Accepted. A withdrawn answer is not
 * shown at all, and nothing else of the person is ever reachable from here.
 */
export function CollectionResponsesPanel({
  organizationId,
  requestId,
  responses,
  fileUnavailable,
  extras = NO_QUEUE_EXTRAS,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly responses: readonly CollectionResponseView[];
  readonly fileUnavailable: boolean;
  /** UMPE P9: guest submissions in the same queue, review decisions and the guest hold. */
  readonly extras?: CollectionQueueExtras;
}) {
  return (
    <section
      className="card"
      aria-labelledby="collection-responses-title"
      id="collection-responses"
    >
      <div className="card-body stack">
        <h2 id="collection-responses-title">Answers</h2>
        <p className="muted u-fs-085">
          Each answer holds only what the person chose, exactly as it was when they sent it. Files
          download as the originals, after you confirm it is you.
        </p>
        {fileUnavailable ? (
          <p className="notice notice-warn" role="alert">
            That file cannot be downloaded right now. The person may have withdrawn or changed their
            answer, or the file is still being checked.
          </p>
        ) : null}
        {responses.length === 0 && extras.guest.length === 0 ? (
          <p className="muted">
            No answers yet. A person who answers through your link, signed in or without an account,
            appears here with exactly what they chose to send.
          </p>
        ) : (
          responses.map((response) => (
            <article key={response.id} className="collection-response">
              <h3>{response.personName}</h3>
              <p className="u-fs-085">
                <StatusBadge tone="neutral">Submitted to Agency</StatusBadge> Sent{' '}
                {formatTimestampDate(response.submittedAt)} · Revision {response.revisionNo}
              </p>
              <ReviewState reviews={extras.reviews.get(response.id)} />
              {response.intact ? (
                <>
                  <ol className="collection-items">
                    {response.lines.map((line) => (
                      <li key={line.itemId}>
                        <p className="collection-item-label">
                          <strong>{line.item.label}</strong>
                        </p>
                        {line.missing ? (
                          <p className="collect-response-missing u-fs-085">Still Missing</p>
                        ) : null}
                        {line.versions
                          .flatMap((v) => (v.kind === 'DOCUMENT' ? [v] : []))
                          .map((document) => (
                            <form
                              key={document.documentVersionId}
                              action={downloadResponseFileAction}
                              className="collection-response-file"
                            >
                              <input type="hidden" name="organizationId" value={organizationId} />
                              <input type="hidden" name="requestId" value={requestId} />
                              <input type="hidden" name="responseId" value={response.id} />
                              <input
                                type="hidden"
                                name="documentVersionId"
                                value={document.documentVersionId}
                              />
                              <span>
                                {document.title}, Version {document.versionNumber}
                              </span>{' '}
                              <button type="submit" className="btn btn-secondary">
                                Download {document.title}
                              </button>
                            </form>
                          ))}
                        {line.versions
                          .flatMap((v) => (v.kind === 'FIELD' ? [v] : []))
                          .map((detail, index) => (
                            <p key={`${line.itemId}-${index}`} className="u-fs-085">
                              {detail.value ?? 'Protected Detail'}
                            </p>
                          ))}
                      </li>
                    ))}
                  </ol>
                  {response.lines.some((l) =>
                    l.versions.some((v) => v.kind === 'FIELD' && v.value === null),
                  ) ? (
                    <p className="u-fs-085">
                      <Link
                        href={`/app/agency/${encodeURIComponent(organizationId)}/collection/request?id=${encodeURIComponent(requestId)}&details=${encodeURIComponent(response.id)}#collection-responses`}
                      >
                        Show Protected Details
                      </Link>{' '}
                      (you confirm it is you first)
                    </p>
                  ) : null}
                  <ReviewAnswerForm
                    organizationId={organizationId}
                    requestId={requestId}
                    source="account"
                    answerId={response.id}
                    items={itemOptions(response.lines)}
                  />
                </>
              ) : (
                <p className="notice notice-warn">
                  This answer has changed since it was sent, usually because the person removed a
                  file from their record. Ask them to answer again.
                </p>
              )}
            </article>
          ))
        )}
        {extras.guest.map((submission) => (
          <article key={submission.id} className="collection-response">
            <h3>
              Without an Account: Guest {submission.guestNo}, Submission {submission.submissionNo}
            </h3>
            <p className="u-fs-085">
              <StatusBadge tone="neutral">Submitted to Agency</StatusBadge> Sent{' '}
              {formatTimestampDate(submission.submittedAt)} · Revision {submission.revisionNo} ·
              Kept {submission.retentionDays} days after the request closes
            </p>
            <ReviewState reviews={extras.reviews.get(submission.id)} />
            {submission.intact ? (
              <>
                <ol className="collection-items">
                  {submission.lines.map((line) => (
                    <li key={line.itemId}>
                      <p className="collection-item-label">
                        <strong>{line.item.label}</strong>
                      </p>
                      {line.missing ? (
                        <p className="collect-response-missing u-fs-085">Still Missing</p>
                      ) : null}
                      {line.versions
                        .flatMap((v) => (v.kind === 'GUEST_FILE' ? [v] : []))
                        .map((file) => (
                          <p key={file.fileId} className="collection-response-file">
                            <span>
                              {file.title}, {formatFileSize(file.sizeBytes)},{' '}
                              {file.virusScanned
                                ? 'checked for viruses'
                                : 'file checked, not scanned for viruses'}
                            </span>{' '}
                            <a
                              className="btn btn-secondary"
                              href={`/app/agency/${encodeURIComponent(organizationId)}/collection/guest-file?request=${encodeURIComponent(requestId)}&submission=${encodeURIComponent(submission.id)}&file=${encodeURIComponent(file.fileId)}`}
                              rel="nofollow noreferrer"
                            >
                              Download {file.title}
                            </a>
                          </p>
                        ))}
                    </li>
                  ))}
                </ol>
                <ReviewAnswerForm
                  organizationId={organizationId}
                  requestId={requestId}
                  source="guest"
                  answerId={submission.id}
                  items={itemOptions(submission.lines)}
                />
              </>
            ) : (
              <p className="notice notice-warn">
                This submission no longer matches what was sent, so its files are not offered.
              </p>
            )}
          </article>
        ))}
        {extras.guest.length > 0 || extras.hold ? (
          <section className="collection-guest-hold" aria-labelledby="collection-guest-hold-title">
            <h3 id="collection-guest-hold-title">Keeping Guest Files</h3>
            <p className="muted u-fs-085">
              {extras.hold
                ? `A legal hold keeps the guest files of this request past the periods the guests chose. Reason: ${extras.hold.reason}`
                : 'Guest files are deleted when the period each guest chose ends after this request closes. A legal hold keeps them until you release it.'}
            </p>
            <GuestHoldForm
              organizationId={organizationId}
              requestId={requestId}
              held={extras.hold !== null}
            />
          </section>
        ) : null}
      </div>
    </section>
  );
}
