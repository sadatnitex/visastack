import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  necessityCanBlock,
} from '@visastack/core';
import {
  AGENCY_ITEM_NECESSITIES,
  COLLECTION_STATUS_LABELS,
  type CollectionItem,
  type CollectionLinkState,
  type CollectionResponseView,
  agencyCollectionPrincipal,
  collectionResponseAccess,
  collectionRuleImpact,
  getCollectionRequest,
  listCollectionPackChoices,
  protectedDetailsStepUp,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { StatusBadge } from '../../../../../../components/ui';
import { formatDateOnly, formatTimestampDate } from '../../../../../../lib/format-date';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';
import { establishStepUpProof } from '../../../../../../lib/step-up';
import {
  AddItemForm,
  EmailLinkForm,
  EndRequestForm,
  IssueRequestForm,
  ItemEditForm,
  NewLinkForm,
  PackChoiceForm,
} from '../collection-forms';
import { CollectionResponsesPanel, loadCollectionResponses } from '../collection-response-panel';
import { STATUS_TONES, collectionPackTerms, destinationName } from '../terms';
import { ChecklistCorrectionCard } from './checklist-correction';

export const metadata: Metadata = { title: 'Agency Document Request', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const LINK_STATES: Readonly<Record<CollectionLinkState, string>> = {
  OPEN: 'Open',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  REPLACED: 'Replaced',
  ISSUER_GONE: 'Closed, Issuer Is No Longer an Admin',
};

const NECESSITY_OPTIONS = AGENCY_ITEM_NECESSITIES.map((value) => ({
  value,
  label: NECESSITY_LABELS[value],
}));

/** Where an item comes from, in plain words: the agency's own items never read as official. */
function sourceLine(item: CollectionItem): string {
  return PROVENANCE_LABELS[item.provenance];
}

function ItemSummary({ item }: { readonly item: CollectionItem }) {
  return (
    <div className="collection-item-summary">
      <p className="collection-item-label">
        <strong>{item.label}</strong>
      </p>
      <p className="muted u-fs-085">
        {NECESSITY_LABELS[item.necessity]} · {sourceLine(item)}
        {item.groupKey ? ` · ${ANY_OF_LABEL}` : ''}
        {item.citation ? ` · ${item.citation}` : ''}
      </p>
      {item.note ? <p className="u-fs-085">Note: {item.note}</p> : null}
    </div>
  );
}

/**
 * One document request: its working checklist (editable until it ends), issuing and sharing, every
 * issued revision (re-verified on each read) and every link. Owners and admins only.
 */
export default async function CollectionRequestPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams: Promise<{
    readonly id?: string | string[];
    readonly file?: string | string[];
    readonly details?: string | string[];
  }>;
}) {
  const { orgId } = await params;
  const { id, file, details } = await searchParams;
  const revealId = typeof details === 'string' ? details : null;
  const requestId = typeof id === 'string' ? id : '';
  const data = await withSession(async ({ db, accountId }) => {
    const scope = await agencyCollectionPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const detail = await getCollectionRequest(db, scope.value, requestId);
    if (!detail.ok) return null;
    const ended = detail.value.storedStatus === 'REVOKED' || detail.value.storedStatus === 'CLOSED';
    const choices = ended
      ? null
      : await listCollectionPackChoices(
          db,
          scope.value,
          requestId,
          collectionPackTerms(detail.value),
        );
    let responses: CollectionResponseView[] = [];
    let reauth: string | null = null;
    if (detail.value.revisions.length > 0) {
      try {
        // Protected details open only after a fresh identity check, bound to that one answer.
        // Only an answer of this very request may ask for the check (never any id in the address).
        const target = revealId ? await collectionResponseAccess(db, scope.value, revealId) : null;
        const step =
          target?.ok && target.value.requestId === requestId
            ? protectedDetailsStepUp({ accountId, responseId: target.value.responseId })
            : null;
        const proof = step
          ? await establishStepUpProof(
              step,
              `/app/agency/${orgId}/collection/request?id=${encodeURIComponent(requestId)}&details=${encodeURIComponent(step.resourceId)}`,
            )
          : null;
        if (proof?.kind === 'reauth_required') reauth = proof.reauthUrl;
        responses = await loadCollectionResponses(
          db,
          scope.value,
          requestId,
          step && proof?.kind === 'proof'
            ? { responseId: step.resourceId, stepUp: proof.proof }
            : undefined,
        );
      } catch (error) {
        // The answers never take the request page down with them.
        reportServerError('collectionResponses', error, { step: 'answers failed' });
      }
    }
    // UMPE P11: a newer published official checklist, through this agency's own scope.
    const impact = await collectionRuleImpact(db, scope.value, requestId);
    return {
      detail: detail.value,
      choices: choices?.ok ? choices.value : [],
      responses,
      reauth,
      impact: impact.ok ? impact.value : undefined,
    };
  });
  if (!data) notFound();
  if (data.reauth) redirect(data.reauth);
  const { detail, choices, responses, impact } = data;
  const editable = detail.storedStatus === 'DRAFT' || detail.storedStatus === 'SENT';
  const items = detail.draftItems ?? [];
  const official = detail.draftPack !== null;

  return (
    <div className="stack">
      <Link href={`/app/agency/${orgId}/collection`} className="page-back">
        <span aria-hidden="true">{'←'}</span> Document Requests
      </Link>
      <h1 className="page-title">Document Request: {destinationName(detail.destination)}</h1>
      <p>
        <StatusBadge tone={STATUS_TONES[detail.status]}>
          {COLLECTION_STATUS_LABELS[detail.status]}
        </StatusBadge>
      </p>

      <section className="card" aria-labelledby="collection-about">
        <div className="card-body">
          <h2 id="collection-about">About This Request</h2>
          <dl className="collection-facts">
            <dt>Purpose</dt>
            <dd>{detail.purpose ?? 'Not Sure Yet'}</dd>
            <dt>Specific Route</dt>
            <dd>{detail.route ?? 'Not Given'}</dd>
            <dt>Travel Dates</dt>
            <dd>
              {detail.travelFrom ? formatDateOnly(detail.travelFrom) : 'Not Given'}
              {detail.travelTo ? ` to ${formatDateOnly(detail.travelTo)}` : ''}
            </dd>
            <dt>Due</dt>
            <dd>{detail.dueAt ? formatTimestampDate(detail.dueAt) : 'No Due Date'}</dd>
            <dt>Known Details</dt>
            <dd>
              {[detail.nationality, detail.residence, detail.applicationPlace]
                .filter((value): value is string => value !== null)
                .join(', ') || 'None Given'}
            </dd>
            <dt>For</dt>
            <dd>{detail.recipientNameHint ?? 'Not Given'}</dd>
          </dl>
        </div>
      </section>

      {editable ? (
        <section className="card" aria-labelledby="collection-checklist">
          <div className="card-body">
            <h2 id="collection-checklist">Checklist</h2>
            {official && detail.draftPack ? (
              <p>
                Following the published official checklist {detail.draftPack.packName} (Version{' '}
                {detail.draftPack.version}). Official items keep the necessity their source gives
                them; items you add are shown as your agency's own.
              </p>
            ) : (
              <p className="notice notice-warn">
                Your agency's own checklist. It is not an official checklist, and the person sees it
                as requested by your agency.
              </p>
            )}
            {detail.draftItems === null ? (
              <p className="notice notice-warn">
                This draft cannot be read. Start a new request instead.
              </p>
            ) : items.length === 0 ? (
              <p className="muted">No items yet. Add what your agency needs below.</p>
            ) : (
              <ol className="collection-items">
                {items.map((item, index) => (
                  <li key={item.id}>
                    <ItemSummary item={item} />
                    <ItemEditForm
                      organizationId={orgId}
                      requestId={detail.id}
                      item={{
                        id: item.id,
                        label: item.label,
                        note: item.note,
                        necessity: item.necessity,
                        agency: item.provenance === 'AGENCY_ADDED',
                      }}
                      first={index === 0}
                      last={index === items.length - 1}
                      removable={
                        item.provenance === 'AGENCY_ADDED' || !necessityCanBlock(item.necessity)
                      }
                      necessities={NECESSITY_OPTIONS}
                    />
                  </li>
                ))}
              </ol>
            )}
            <h3>Add an Item</h3>
            <AddItemForm
              organizationId={orgId}
              requestId={detail.id}
              necessities={NECESSITY_OPTIONS}
            />
            <h3>Official Checklists That Fit</h3>
            {choices.length === 0 ? (
              <p className="muted">
                No published official checklist fits this destination and purpose, so the request
                uses your agency's own checklist.
              </p>
            ) : (
              <PackChoiceForm
                organizationId={orgId}
                requestId={detail.id}
                current={detail.draftPack?.packVersionId ?? null}
                choices={choices.map((choice) => ({
                  packVersionId: choice.packVersionId,
                  label: `${choice.packName} (Version ${choice.version})${choice.coversTraveller ? '' : ', may not cover this person'}`,
                }))}
              />
            )}
            <h3>{detail.revisions.length > 0 ? 'Issue Again' : 'Issue'}</h3>
            <p className="muted">
              Issuing freezes this checklist as a numbered revision that never changes, and makes a
              private link. Issuing again replaces older links with one for the new revision.
            </p>
            <IssueRequestForm
              organizationId={orgId}
              requestId={detail.id}
              reissue={detail.revisions.length > 0}
            />
          </div>
        </section>
      ) : null}

      {detail.storedStatus === 'SENT' ? (
        <section className="card" aria-labelledby="collection-share">
          <div className="card-body">
            <h2 id="collection-share">Share</h2>
            <p className="muted">
              Responding through the link opens in a later release. For now the link shows only who
              is asking.
            </p>
            <NewLinkForm organizationId={orgId} requestId={detail.id} />
            <h3>Send by Email</h3>
            <EmailLinkForm
              organizationId={orgId}
              requestId={detail.id}
              defaultEmail={detail.recipientEmailHint}
            />
          </div>
        </section>
      ) : null}

      {detail.revisions.length > 0 ? (
        <CollectionResponsesPanel
          organizationId={orgId}
          requestId={detail.id}
          responses={responses}
          fileUnavailable={file === 'unavailable'}
        />
      ) : null}

      {detail.links.length > 0 ? (
        <section className="card" aria-labelledby="collection-links">
          <div className="card-body">
            <h2 id="collection-links">Links</h2>
            <table className="data-table">
              <caption className="sr-only">Links Made for This Request, Newest First</caption>
              <thead>
                <tr>
                  <th scope="col">Revision</th>
                  <th scope="col">State</th>
                  <th scope="col">Sent By</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Last Opened</th>
                </tr>
              </thead>
              <tbody>
                {detail.links.map((link) => (
                  <tr key={link.id}>
                    <td>{link.revisionNo}</td>
                    <td>{LINK_STATES[link.state]}</td>
                    <td>{link.emailed ? 'Email' : 'Copied Link'}</td>
                    <td>{formatTimestampDate(link.expiresAt)}</td>
                    <td>
                      {link.lastOpenedAt ? formatTimestampDate(link.lastOpenedAt) : 'Not Yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {detail.revisions.length > 0 ? (
        <section className="card" aria-labelledby="collection-revisions">
          <div className="card-body">
            <h2 id="collection-revisions">Issued Revisions</h2>
            {detail.revisions.map((revision) => (
              <details key={revision.id} className="collection-revision">
                <summary>
                  Revision {revision.revisionNo}, issued {formatTimestampDate(revision.issuedAt)}
                  {revision.packVersionId
                    ? ', official checklist'
                    : ", your agency's own checklist"}
                </summary>
                {revision.intact ? (
                  <ol className="collection-items">
                    {revision.items.map((item) => (
                      <li key={item.id}>
                        <ItemSummary item={item} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="notice notice-warn">
                    This revision no longer matches what was issued, so it is not shown. Tell
                    VisaStack support.
                  </p>
                )}
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {official || detail.revisions.some((revision) => revision.packVersionId) ? (
        <ChecklistCorrectionCard
          organizationId={orgId}
          requestId={detail.id}
          impact={impact}
          open={editable}
          officialItems={items
            .filter((item) => item.provenance === 'OFFICIAL' && item.source !== 'agency')
            .map((item) => ({ value: item.source, label: item.label }))}
        />
      ) : null}

      {editable ? (
        <section className="card" aria-labelledby="collection-end">
          <div className="card-body">
            <h2 id="collection-end">End This Request</h2>
            <p className="muted">
              Close it when you have what you need, or revoke it to withdraw it. Either way every
              link stops working.
            </p>
            <EndRequestForm organizationId={orgId} requestId={detail.id} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
