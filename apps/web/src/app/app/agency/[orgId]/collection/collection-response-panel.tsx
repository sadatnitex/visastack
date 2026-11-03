import {
  type AgencyCollectionScope,
  type CollectionResponseView,
  type Db,
  type StepUpProof,
  collectionResponseAccesses,
  readCollectionResponse,
} from '@visastack/services';
import Link from 'next/link';
import { StatusBadge } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { downloadResponseFileAction } from './collection-response-actions';

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
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly responses: readonly CollectionResponseView[];
  readonly fileUnavailable: boolean;
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
        {responses.length === 0 ? (
          <p className="muted">
            No answers yet. A person who signs in through your link and submits appears here, with
            exactly what they chose to share.
          </p>
        ) : (
          responses.map((response) => (
            <article key={response.id} className="collection-response">
              <h3>{response.personName}</h3>
              <p className="u-fs-085">
                <StatusBadge tone="neutral">Submitted to Agency</StatusBadge> Sent{' '}
                {formatTimestampDate(response.submittedAt)} · Revision {response.revisionNo}
              </p>
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
      </div>
    </section>
  );
}
