import { getRecipientWorkspace, isPassportPhotoType } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SafeCopyDownload } from '../../../../components/safe-copy-download';
import { ShowMore } from '../../../../components/show-more';
import { EmptyState, PageHeader } from '../../../../components/ui';
import { VisaPhotoSizes } from '../../../../components/visa-photo-sizes';
import { formatTimestampDate } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import { fieldLabel } from '../../../../lib/master-profile';
import { TRAVELLER_LIST_STEP, nextShow, parseShow } from '../../../../lib/paging';
import { mayUseVisaPhotoSizes } from '../../../../lib/photo-sizes';
import { safeCopiesAvailable, safeCopyOffers } from '../../../../lib/safe-copy';
import { withSession } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Shared Record' };

export const dynamic = 'force-dynamic';

/** The address parameters for how many details and documents show. */
const FIELDS_KEY = 'fields';
const DOCS_KEY = 'docs';
const FIELD_NOUN = { one: 'detail', other: 'details' } as const;
const DOCUMENT_NOUN = { one: 'document', other: 'documents' } as const;

export default async function SharedWorkspacePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ grantId: string }>;
  /** `fields` and `docs`: how many shared details and documents to list (WP-SB3: 10, then more). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { grantId } = await params;
  const search = (await searchParams) ?? {};
  const fieldsShown = parseShow(search[FIELDS_KEY], { step: TRAVELLER_LIST_STEP });
  const documentsShown = parseShow(search[DOCS_KEY], { step: TRAVELLER_LIST_STEP });

  const loaded = await withSession(async ({ db, accountId }) => {
    const result = await getRecipientWorkspace(db, { actorAccountId: accountId, grantId });
    if (!result.ok) return null;
    // Only the documents on this page are checked for safe copies and photo sizes (WP-SB3); the
    // grant decides which documents exist here, never the page size.
    const shownDocuments = result.value.documents.slice(0, documentsShown);
    // Visa Photo Sizes only for a photo this viewer may take safe copies of, decided by the same
    // gate question the photo routes ask (across every grant they hold for it), never by this one
    // grant's list of actions, so the section and the server always agree.
    const organizationId = result.value.grant.recipientOrganizationId;
    const actingFor = organizationId ? { organizationId } : ('individual' as const);
    const photoIds: string[] = [];
    // Safe copies (S23): what each document offers this viewer, asked of the gate exactly as the
    // safe copy route asks, so the button and the server always agree. Every check at once and
    // every state in one read; nothing at all while safe copies are off here.
    const safeCopiesOn = safeCopiesAvailable();
    const safeCopies = safeCopiesOn
      ? await safeCopyOffers(
          db,
          accountId,
          shownDocuments.map((doc) => doc.id),
          actingFor,
        )
      : new Map<string, never>();
    for (const doc of shownDocuments) {
      if (!isPassportPhotoType(doc.docType)) continue;
      const allowed = await mayUseVisaPhotoSizes(db, accountId, doc.id, actingFor);
      if (allowed) photoIds.push(doc.id);
    }
    return { workspace: result.value, shownDocuments, photoIds, safeCopies, safeCopiesOn };
  });

  if (!loaded) notFound();
  const { workspace, shownDocuments, photoIds, safeCopies, safeCopiesOn } = loaded;
  const pathname = `/app/shared/${grantId}`;
  const shownFields = workspace.fields.slice(0, fieldsShown);
  const fieldsNext =
    workspace.fields.length > shownFields.length
      ? nextShow(shownFields.length, { step: TRAVELLER_LIST_STEP })
      : null;
  const documentsNext =
    workspace.documents.length > shownDocuments.length
      ? nextShow(shownDocuments.length, { step: TRAVELLER_LIST_STEP })
      : null;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/shared" className="muted u-fs-085">
          ← Shared with you
        </Link>
      </div>
      <PageHeader
        eyebrow="Shared Workspace"
        title={workspace.applicantDisplayName}
        description={
          <>
            {workspace.grant.purpose}
            {workspace.grant.expiryAt
              ? ` · expires ${formatTimestampDate(workspace.grant.expiryAt)}`
              : ''}
          </>
        }
      />

      <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '1.5rem' }}>
        Every item below is re-checked against your grant's permissions on every visit. It never
        shows more than what was shared with you, and never less than you're entitled to.
      </p>

      {workspace.missionScopeUnavailable ? (
        <div className="card u-mb-150">
          <p className="card-body">
            This access is limited to a specific case. Case-scoped sharing isn't available yet -
            nothing is shown below until that support ships.
          </p>
        </div>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Profile</p>
          <h2 className="card-title">Shared Fields</h2>
          {workspace.fields.length === 0 ? (
            <EmptyState icon="user" title="No Profile Details Shared">
              This person has not shared any profile details with you for this purpose.
            </EmptyState>
          ) : (
            <>
              <div className="rows u-mt-050">
                {shownFields.map((field, index) => (
                  <div className="row" key={field.fieldKey}>
                    <span className="row-key" id={`shared-field-${index + 1}`}>
                      {fieldLabel(field.fieldKey) ?? field.fieldKey}
                    </span>
                    <span>{field.value}</span>
                  </div>
                ))}
              </div>
              <ShowMore
                id="shared-fields-more"
                pathname={pathname}
                searchParams={search}
                next={fieldsNext === null ? null : { [FIELDS_KEY]: fieldsNext }}
                shown={shownFields.length}
                total={workspace.fields.length}
                noun={FIELD_NOUN}
                landOn={`shared-field-${shownFields.length + 1}`}
              />
            </>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Document Vault</p>
          <h2 className="card-title">Shared Documents</h2>
          {workspace.documents.length === 0 ? (
            <EmptyState icon="file" title="No Documents Shared">
              This person has not shared any documents with you for this purpose.
            </EmptyState>
          ) : (
            <>
              <div className="rows" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                {shownDocuments.map((doc, index) => {
                  const offer = safeCopies.get(doc.id) ?? 'none';
                  return (
                    <div className="row" key={doc.id}>
                      <span className="row-key" id={`shared-document-${index + 1}`}>
                        {doc.displayName}
                      </span>
                      <span className="row-end">
                        {doc.docType ? (
                          <span className="badge badge-neutral">
                            {documentTypeLabel(doc.docType)}
                          </span>
                        ) : null}
                        {offer === 'not_prepared' ? (
                          <span className="badge badge-neutral">Safe Copy: Not Prepared Yet</span>
                        ) : null}
                        {offer === 'not_available' ? (
                          <span className="badge badge-neutral">
                            Safe Copy Not Available for This File
                          </span>
                        ) : null}
                      </span>
                      {offer === 'ready' || offer === 'confirm' ? (
                        <SafeCopyDownload
                          documentId={doc.id}
                          returnTo={`/app/shared/${grantId}`}
                          actingFor={workspace.grant.recipientOrganizationId ?? 'individual'}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <ShowMore
                id="shared-documents-more"
                pathname={pathname}
                searchParams={search}
                next={documentsNext === null ? null : { [DOCS_KEY]: documentsNext }}
                shown={shownDocuments.length}
                total={workspace.documents.length}
                noun={DOCUMENT_NOUN}
                landOn={`shared-document-${shownDocuments.length + 1}`}
              />
              {photoIds.map((documentId) => (
                <VisaPhotoSizes
                  key={`photo-${documentId}`}
                  documentId={documentId}
                  returnTo={`/app/shared/${grantId}`}
                  actingFor={workspace.grant.recipientOrganizationId ?? 'individual'}
                />
              ))}
              <p className="muted u-fs-085">
                Other documents cannot be previewed here yet. This list shows which documents your
                grant covers. A passport photo shared with safe copies can be sized for a visa
                application above.
              </p>
              {!safeCopiesOn && workspace.grant.actions.includes('DOWNLOAD_REDACTED') ? (
                <p className="muted u-fs-085">Safe copies are not available here yet.</p>
              ) : null}
              {[...safeCopies.values()].some((offer) => offer !== 'none') ? (
                <p className="muted u-fs-085">
                  A safe copy is a picture of each page with the parts the traveller chose covered
                  in black. It is made fresh when you download it.
                </p>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
