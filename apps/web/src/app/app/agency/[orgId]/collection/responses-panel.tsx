import {
  type AgencyCollectionScope,
  type AgencyResponseView,
  type Db,
  collectionResponseAccesses,
  readCollectionResponse,
} from '@visastack/services';
import { StatusBadge } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { previewResponseFileAction } from './response-actions';

/** Every live answer to this request, read through the agency's own scope (none for any refusal). */
export async function loadCollectionResponses(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<AgencyResponseView[]> {
  const encryption = createKeyManagementPort();
  const found: AgencyResponseView[] = [];
  for (const access of await collectionResponseAccesses(db, scope, requestId)) {
    const view = await readCollectionResponse(db, access, encryption ? { encryption } : {});
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
  readonly responses: readonly AgencyResponseView[];
  readonly fileUnavailable: boolean;
}) {
  return (
    <section className="card" aria-labelledby="collection-responses" id="collection-responses">
      <div className="card-body stack">
        <h2 id="collection-responses">Answers</h2>
        {fileUnavailable ? (
          <p className="notice notice-warn" role="alert">
            That file cannot be opened right now. The person may have withdrawn their answer, or the
            file is still being checked.
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
                <ol className="collection-items">
                  {response.lines.map((line) => (
                    <li key={line.item.id}>
                      <p className="collection-item-label">
                        <strong>{line.item.label}</strong>
                      </p>
                      {line.missing ? (
                        <p className="collect-response-missing u-fs-085">Still Missing</p>
                      ) : null}
                      {line.documents.map((document) => (
                        <form
                          key={document.documentVersionId}
                          action={previewResponseFileAction}
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
                            Preview {document.title}
                          </button>
                        </form>
                      ))}
                      {line.details.map((detail, index) => (
                        <p key={`${line.item.id}-${index}`} className="u-fs-085">
                          {detail.value}
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
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
