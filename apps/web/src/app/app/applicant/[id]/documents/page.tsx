import { ORIGINAL_DOCUMENT_KEYS, resolveDocumentType } from '@visastack/core/catalogue';
import { type MessageKey, type Translator, createTranslator } from '@visastack/i18n';
import {
  type DocumentLifecycleStatus,
  classifyExpiry,
  documentCategory,
  getApplicant,
  getApplicantEvidenceBytes,
  getLatestOcrRun,
  getWalletView,
  hasConsent,
  isClearReading,
  isServableProcessingState,
  isTrustedFactStatus,
  listApplicantProfile,
  listDocumentsDetailed,
  listIssuerVerificationsForDocument,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  loadUploadQuotaConfig,
  mbLabel,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '../../../../../components/auto-refresh';
import { DocumentWalletBrowser } from '../../../../../components/document-wallet-browser';
import { PageHeader } from '../../../../../components/ui';
import {
  createAiExtractor,
  isClassificationConfigured,
  isInconsistencyConfigured,
  isOcrConfigured,
} from '../../../../../lib/ai';
import { getPlatformCapabilities } from '../../../../../lib/capabilities';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { documentTypeLabel } from '../../../../../lib/labels';
import { getLocale } from '../../../../../lib/locale';
import {
  categoryLabel,
  evidenceDocumentGroups,
  fieldLabel,
  savableField,
} from '../../../../../lib/master-profile';
import { isStillProcessing } from '../../../../../lib/resilience';
import { withSession } from '../../../../../lib/session';
import {
  previewDocumentAction,
  requestDocumentReadingAction,
  setDocumentDateAction,
} from '../actions';
import {
  DocumentFindings,
  DocumentTypeProposalReview,
  InconsistencyFlagReview,
  OcrResultView,
  RunAiExtractionButton,
  RunClassificationButton,
  RunInconsistencyCheckButton,
  RunOcrButton,
} from '../ai-review';
import { DocumentTypeForm } from '../document-type-form';
import { DocumentUploader } from '../document-uploader';
import { downloadOriginalAction } from '../download-actions';
import { NameReview } from '../name-review';
import { UsageMeter } from '../usage-meter';

const ORIGINAL_KINDS: readonly string[] = [...ORIGINAL_DOCUMENT_KEYS];

export const metadata: Metadata = { title: 'Documents' };

export const dynamic = 'force-dynamic';

/** Real pipeline states (never fake progress - master directive §7 "PR 7"). */
const PROCESSING_STATE_KEYS: Record<string, MessageKey> = {
  UPLOADING: 'document.processing.uploading',
  QUARANTINED: 'document.processing.quarantined',
  SCANNING: 'document.processing.scanning',
  NORMALIZING: 'document.processing.normalizing',
  EXTRACTING: 'document.processing.extracting',
  AWAITING_REVIEW: 'document.processing.awaitingReview',
  APPROVED: 'document.processing.ready',
  NEEDS_ATTENTION: 'document.processing.needsAttention',
  FAILED: 'document.processing.failed',
  REJECTED: 'document.processing.rejected',
};

const SAFETY_BADGE_KEYS: Record<string, { key: MessageKey; tone: string }> = {
  CLEAN: { key: 'document.status.clean', tone: 'badge-success' },
  QUARANTINED: { key: 'document.status.quarantined', tone: 'badge-danger' },
  SCANNING: { key: 'document.status.scanning', tone: 'badge-neutral' },
  PENDING: { key: 'document.status.pending', tone: 'badge-neutral' },
};

function safetyBadge(status: string, t: Translator): { label: string; tone: string } {
  const entry = SAFETY_BADGE_KEYS[status] ?? {
    key: 'document.status.pending' as const,
    tone: 'badge-neutral',
  };
  return { label: t(entry.key), tone: entry.tone };
}

/** What a person can do next when a file could not be used (a state with no next step is a dead end). */
const PROBLEM_NEXT_STEP: Record<string, string> = {
  FAILED:
    'We could not finish checking this file. Try uploading it again. If it keeps failing, contact support.',
  NEEDS_ATTENTION:
    'This file could not be accepted as it is. Try a different copy, such as a clearer scan or a smaller file.',
  REJECTED: 'This file was rejected. Upload a different copy if you still need it.',
};

/** Processing-state badge tone: attention states read as warning/danger, everything mid-flight as neutral. */
function processingTone(status: string | null): string {
  if (status === 'NEEDS_ATTENTION' || status === 'FAILED' || status === 'REJECTED') {
    return 'badge-warning';
  }
  if (status === 'APPROVED') return 'badge-success';
  return 'badge-neutral';
}

/** EVI-04 wallet lifecycle: current/expiring/expired/superseded, distinct from pipeline/safety status above. */
const LIFECYCLE_BADGES: Record<DocumentLifecycleStatus, { label: string; tone: string }> = {
  UNKNOWN: { label: 'Expiry not confirmed', tone: 'badge-neutral' },
  CURRENT: { label: 'Current', tone: 'badge-success' },
  EXPIRING: { label: 'Expiring Soon', tone: 'badge-warning' },
  EXPIRED: { label: 'Expired', tone: 'badge-danger' },
  SUPERSEDED: { label: 'Superseded', tone: 'badge-neutral' },
};

export default async function ApplicantDocumentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{
    readonly document?: string;
    readonly preview_error?: string;
    readonly date_error?: string;
    readonly type_error?: string;
    readonly reading_error?: string;
    readonly reading_queued?: string;
    readonly download_error?: string;
    /** A document kind chosen from a profile section's Upload link (repeated keys arrive as a list). */
    readonly type?: string | string[];
  }>;
}) {
  const { id } = await params;
  const {
    document: initialSelection,
    preview_error: previewError,
    date_error: dateError,
    type_error: typeError,
    reading_error: readingError,
    reading_queued: readingQueued,
    download_error: downloadError,
    type: requestedType,
  } = await searchParams;
  // Only a kind the catalogue knows opens the upload form ready; anything else is ignored.
  const initialKind =
    typeof requestedType === 'string' ? (resolveDocumentType(requestedType)?.key ?? '') : '';
  const locale = await getLocale();
  const t = createTranslator(locale);
  const documentGroups = evidenceDocumentGroups();

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [
      documents,
      coreGranted,
      aiGranted,
      ocrGranted,
      ocrConfigured,
      classificationConfigured,
      inconsistencyConfigured,
      evidenceBytes,
      pendingProposals,
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      wallet,
    ] = await Promise.all([
      listDocumentsDetailed(db, accountId, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      hasConsent(db, accountId, 'AI_EXTRACTION'),
      hasConsent(db, accountId, 'AI_OCR'),
      isOcrConfigured(db),
      isClassificationConfigured(db),
      isInconsistencyConfigured(db),
      getApplicantEvidenceBytes(db, id),
      listPendingProposals(db, id),
      listPendingDocumentTypeProposals(db, id),
      listPendingInconsistencyFlags(db, id),
      getWalletView(db, { actorAccountId: accountId, applicantId: id }),
    ]);
    const documentRows = documents.ok ? documents.value : [];
    // EVI-05: issuer confirmations, per document. There is no batch
    // reader yet (document counts per applicant are small), so this fans
    // out one query per document rather than adding one solely for this.
    const issuerVerificationLists = await Promise.all(
      documentRows.map((doc) => listIssuerVerificationsForDocument(db, doc.id)),
    );
    const issuerVerifications = new Map(
      documentRows.map((doc, i) => [doc.id, issuerVerificationLists[i] ?? []] as const),
    );
    // Same fan-out shape as issuerVerifications above -- the most recent
    // successful OCR run per document, for display (Part 8 §9's own "show
    // ... as review issues" requirement).
    const ocrRunLists = await Promise.all(
      documentRows.map((doc) =>
        doc.latestVersionId ? getLatestOcrRun(db, doc.latestVersionId) : undefined,
      ),
    );
    const ocrRuns = new Map(documentRows.map((doc, i) => [doc.id, ocrRunLists[i]] as const));
    // What the profile already holds, read only when there are readings to compare it with.
    const profile = pendingProposals.length > 0 ? await listApplicantProfile(db, id) : [];
    const currentValues = new Map(
      profile
        .filter((entry) => entry.repeatingRecordKey === null && entry.status !== null)
        .filter((entry) => isTrustedFactStatus(entry.status as never))
        // A protected value is never shown here: null says "there is one" without revealing it.
        .map((entry) => [entry.fieldKey, entry.isProtected ? null : entry.value] as const),
    );
    return {
      documents: documentRows,
      recordsUnavailable: !documents.ok || !wallet.ok,
      coreGranted,
      aiGranted,
      aiConfigured: Boolean(createAiExtractor()),
      ocrGranted,
      ocrConfigured,
      classificationConfigured,
      inconsistencyConfigured,
      evidenceBytes,
      pendingProposals,
      currentValues,
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      quota: loadUploadQuotaConfig(),
      wallet: new Map((wallet.ok ? wallet.value : []).map((w) => [w.document.id, w])),
      issuerVerifications,
      ocrRuns,
    };
  });

  if (!data) notFound();

  if (data.recordsUnavailable)
    return (
      <>
        <PageHeader as="h2" title="Documents" description="Your private evidence wallet" />
        <p role="alert" className="notice notice-warn">
          We could not load your document records or lifecycle status. Refresh to try again.
          Unavailable records are not reported as an empty wallet.
        </p>
      </>
    );

  // While the server is still scanning or reading a file, keep this page up to date by
  // itself: nobody has to reload, and nobody uploads the file again because nothing seemed
  // to happen (directive Part 9 section 3).
  const anyProcessing = data.documents.some((doc) => isStillProcessing(doc.processingStatus));

  return (
    <>
      <PageHeader
        as="h2"
        eyebrow="Your Private Wallet"
        title="Documents"
        description="Keep reusable evidence together. Processing, review and expiry are separate signals."
        actions={
          <a className="btn btn-primary" href="#document-upload">
            + Upload documents
          </a>
        }
      />
      {downloadError ? (
        <p role="alert" className="card-body">
          We could not download this document. Try again after confirming your account. Documents
          still being checked are unavailable for download.
        </p>
      ) : null}
      <AutoRefresh active={anyProcessing} />
      {anyProcessing ? (
        <p className="muted">
          Some documents are still being checked. This page updates by itself, so there is no need
          to upload them again.
        </p>
      ) : null}
      {readingError ? (
        <p className="notice notice-warn" role="alert">
          {readingError}
        </p>
      ) : null}
      {readingQueued === 'true' ? (
        <output className="notice" aria-live="polite">
          Another reading is queued. Keep this page open or return later. Confirm any suggested
          information against the original.
        </output>
      ) : null}
      {previewError ? (
        <p className="notice notice-warn u-mb-150" role="alert">
          Couldn't open that preview - the document may no longer be available. Please try again.
        </p>
      ) : null}

      {dateError ? (
        <p className="notice notice-warn u-mb-150" role="alert">
          Couldn't save that date - enter a valid date that isn't in the future.
        </p>
      ) : null}

      {typeError ? (
        <p className="notice notice-warn u-mb-150" role="alert">
          Couldn't save that kind of document - pick one from the list, or choose Other Document.
        </p>
      ) : null}

      <DocumentWalletBrowser
        key={initialSelection ?? id}
        applicantId={id}
        {...(initialSelection ? { initialSelection } : {})}
        documents={data.documents.map((doc) => {
          const badge = safetyBadge(doc.safetyStatus ?? 'PENDING', t);
          const processingKey = doc.processingStatus
            ? PROCESSING_STATE_KEYS[doc.processingStatus]
            : undefined;
          const previewable =
            doc.safetyStatus === 'CLEAN' &&
            doc.processingStatus !== null &&
            isServableProcessingState(doc.processingStatus);
          const lifecycle = data.wallet.get(doc.id)?.status;
          const needsReview =
            (doc.docType === 'PASSPORT' && lifecycle === 'UNKNOWN') ||
            doc.safetyStatus === 'QUARANTINED' ||
            doc.processingStatus === 'AWAITING_REVIEW' ||
            doc.classification?.reviewRequired === true ||
            doc.pendingNameVersion !== null ||
            ['QUARANTINED', 'REJECTED', 'FAILED', 'NEEDS_ATTENTION'].includes(
              doc.processingStatus ?? '',
            ) ||
            data.pendingProposals.some(
              ({ proposal }) => proposal.documentVersionId === doc.latestVersionId,
            );
          const category = documentCategory(doc.docType);
          const suggested = doc.docType
            ? undefined
            : data.pendingClassificationProposals.find(
                (p) => p.documentVersionId === doc.latestVersionId,
              );
          return {
            id: doc.id,
            name: doc.approvedName ?? doc.originalName,
            // An "Other" kind shows the name the person gave it, when there is one.
            kind: doc.docType
              ? doc.subject && (doc.docType === 'OTHER' || doc.docType.startsWith('OTHER_'))
                ? doc.subject
                : documentTypeLabel(doc.docType)
              : null,
            suggestedKind: suggested ? documentTypeLabel(suggested.suggestedType) : null,
            category: category ? categoryLabel(category) : null,
            version: doc.latestVersionNumber ?? null,
            updatedAt: doc.updatedAt ?? null,
            ready:
              doc.safetyStatus === 'CLEAN' &&
              doc.processingStatus === 'APPROVED' &&
              !needsReview &&
              (lifecycle === 'CURRENT' || lifecycle === 'EXPIRING' || lifecycle === 'UNKNOWN'),
            needsReview,
            expiring: lifecycle === 'EXPIRING',
            safetyLabel: badge.label,
            processingLabel: processingKey ? t(processingKey) : 'Not yet checked',
            previewAllowed: previewable,
            details: (
              <div
                key={doc.id}
                className="wallet-document-actions"
                style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
              >
                <div className="row">
                  <span className="row-key" style={{ wordBreak: 'break-word' }}>
                    {doc.approvedName ?? doc.originalName}
                  </span>
                  <span className="row-end">
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    {(() => {
                      const lifecycle = data.wallet.get(doc.id);
                      if (!lifecycle) return null;
                      const lifecycleBadge = LIFECYCLE_BADGES[lifecycle.status];
                      return (
                        <span className={`badge ${lifecycleBadge.tone}`}>
                          {lifecycleBadge.label}
                        </span>
                      );
                    })()}
                    {processingKey ? (
                      <span
                        className={`badge ${processingTone(doc.processingStatus)}`}
                        aria-live="polite"
                      >
                        {t(processingKey)}
                      </span>
                    ) : null}
                    {previewable ? (
                      <form action={previewDocumentAction}>
                        <input type="hidden" name="applicantId" value={id} />
                        <input type="hidden" name="documentId" value={doc.id} />
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.9rem', fontSize: 'var(--text-small)' }}
                        >
                          Preview
                        </button>
                      </form>
                    ) : null}
                    {previewable && getPlatformCapabilities().originalDownload === 'available' ? (
                      <form action={downloadOriginalAction}>
                        <input type="hidden" name="applicantId" value={id} />
                        <input type="hidden" name="documentId" value={doc.id} />
                        <button type="submit" className="btn btn-secondary">
                          Download Original
                        </button>
                      </form>
                    ) : null}
                  </span>
                </div>
                {(doc.classification?.reviewRequired === true ||
                  !doc.classification ||
                  (doc.docType === 'PASSPORT' && !doc.expiresAt)) &&
                doc.safetyStatus === 'CLEAN' &&
                doc.latestVersionId &&
                ['AWAITING_REVIEW', 'APPROVED'].includes(doc.processingStatus ?? '') ? (
                  <form action={requestDocumentReadingAction}>
                    <input type="hidden" name="applicantId" value={id} />
                    <input type="hidden" name="documentId" value={doc.id} />
                    <input type="hidden" name="versionId" value={doc.latestVersionId} />
                    <button className="btn btn-secondary" type="submit">
                      Read This File Again
                    </button>
                  </form>
                ) : null}
                {doc.processingStatus && PROBLEM_NEXT_STEP[doc.processingStatus] ? (
                  <p className="muted u-fs-075-m0">{PROBLEM_NEXT_STEP[doc.processingStatus]}</p>
                ) : null}
                {(() => {
                  const wallet = data.wallet.get(doc.id);
                  if (
                    !wallet ||
                    (wallet.usedInMissions.length === 0 && wallet.accessibleTo.length === 0)
                  ) {
                    return null;
                  }
                  return (
                    <p className="muted u-fs-075-m0">
                      {wallet.usedInMissions.length > 0
                        ? `Used in ${wallet.usedInMissions.map((m) => m.missionTitle).join(', ')}`
                        : null}
                      {wallet.usedInMissions.length > 0 && wallet.accessibleTo.length > 0
                        ? ' · '
                        : null}
                      {wallet.accessibleTo.length > 0
                        ? `Shared with ${wallet.accessibleTo.map((a) => a.label).join(', ')}`
                        : null}
                    </p>
                  );
                })()}
                <form
                  action={setDocumentDateAction}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <input type="hidden" name="applicantId" value={id} />
                  <input type="hidden" name="documentId" value={doc.id} />
                  <label className="muted u-fs-075" htmlFor={`date-${doc.id}`}>
                    Document Date
                  </label>
                  <input
                    id={`date-${doc.id}`}
                    name="documentDate"
                    type="date"
                    defaultValue={doc.documentDate ?? ''}
                    max={new Date().toISOString().slice(0, 10)}
                    className="input"
                    style={{
                      padding: '0.2rem 0.5rem',
                      fontSize: 'var(--text-small)',
                      width: 'auto',
                    }}
                  />
                  <button type="submit" className="btn btn-secondary u-btn-xs">
                    Save
                  </button>
                  <span className="muted" style={{ fontSize: 'var(--text-caption)' }}>
                    Used to judge freshness for routes that require recently-dated evidence.
                  </span>
                </form>
                <DocumentTypeForm
                  applicantId={id}
                  documentId={doc.id}
                  docType={doc.docType}
                  subject={doc.subject}
                  groups={documentGroups}
                />
                {(() => {
                  const confirmations = data.issuerVerifications.get(doc.id) ?? [];
                  if (confirmations.length === 0) return null;
                  return (
                    <details className="u-fs-075">
                      <summary className="muted" style={{ cursor: 'pointer' }}>
                        {confirmations.length} issuer confirmation
                        {confirmations.length === 1 ? '' : 's'}
                      </summary>
                      <div
                        style={{
                          marginTop: '0.35rem',
                          paddingLeft: '0.75rem',
                          borderLeft: '2px solid var(--hairline-soft)',
                        }}
                      >
                        {confirmations.map((c) => {
                          const verification = classifyExpiry(c.validUntil, new Date());
                          return (
                            <p key={c.id} className="muted" style={{ margin: '0 0 0.3rem' }}>
                              {verification.urgency === 'expired' ? '(expired) ' : ''}
                              {verification.urgency === 'reminder'
                                ? `(expires in ${verification.daysRemaining} day(s)) `
                                : ''}
                              {c.issuerIdentity}: "{c.exactClaim}", response: {c.response}, valid
                              until {formatTimestampDate(c.validUntil)}
                            </p>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
                {doc.pendingNameVersion ? (
                  <NameReview
                    applicantId={id}
                    nameVersionId={doc.pendingNameVersion.id}
                    originalName={doc.originalName}
                    proposedName={doc.pendingNameVersion.proposedName}
                    classification={doc.classification}
                  />
                ) : doc.classification?.reviewRequired ? (
                  <p className="muted u-fs-075">
                    Automatic classification needs review - not confident enough to propose a name.
                  </p>
                ) : null}
                {(() => {
                  if (!data.aiConfigured || !data.aiGranted || !doc.classification) return null;
                  const versionId = doc.latestVersionId;
                  if (!versionId) return null;
                  const proposalsForDoc = data.pendingProposals.filter(
                    (p) => p.proposal.documentVersionId === versionId,
                  );
                  return (
                    <>
                      {/* New AI extraction is new processing - blocked without core
                            processing consent, even though existing proposals below
                            (already-completed processing output) remain reviewable
                            (finding #23). */}
                      {data.coreGranted ? (
                        <RunAiExtractionButton applicantId={id} documentVersionId={versionId} />
                      ) : null}
                      <DocumentFindings
                        applicantId={id}
                        canApprove={data.coreGranted}
                        proposals={proposalsForDoc.map(({ proposal, evidence }) => {
                          const field = proposal.fieldKey
                            ? savableField(proposal.fieldKey)
                            : undefined;
                          const hasCurrent =
                            proposal.fieldKey !== null && data.currentValues.has(proposal.fieldKey);
                          const current = proposal.fieldKey
                            ? data.currentValues.get(proposal.fieldKey)
                            : undefined;
                          // A protected value is not shown here (null): treat it as a difference to settle.
                          const differs =
                            hasCurrent && (current === null || current !== proposal.value);
                          return {
                            id: proposal.id,
                            type: proposal.type,
                            fieldKey: proposal.fieldKey,
                            ...(proposal.fieldKey && fieldLabel(proposal.fieldKey)
                              ? { fieldLabel: fieldLabel(proposal.fieldKey) as string }
                              : {}),
                            value: proposal.value,
                            confidence: proposal.confidence,
                            rationale: proposal.rationale,
                            evidence: evidence.map((e) => ({
                              snippet: e.snippet,
                              verified: e.verified,
                            })),
                            clear: isClearReading(proposal, evidence),
                            sensitive: field !== undefined && field.sensitivity !== 'STANDARD',
                            ...(differs ? { difference: { current: current ?? null } } : {}),
                          };
                        })}
                      />
                    </>
                  );
                })()}
                {(() => {
                  // Part 8 AI-01 item 2: shown only on a genuine deterministic
                  // gap (no classification yet reached, or one reached but not
                  // confident) -- never offered once a confident deterministic
                  // (or already-approved AI) classification already exists.
                  if (!data.classificationConfigured || !data.aiGranted || !doc.classification) {
                    return null;
                  }
                  if (
                    doc.classification.classifiedType !== null &&
                    !doc.classification.reviewRequired
                  ) {
                    return null;
                  }
                  const versionId = doc.latestVersionId;
                  if (!versionId) return null;
                  const classificationProposal = data.pendingClassificationProposals.find(
                    (p) => p.documentVersionId === versionId,
                  );
                  return (
                    <>
                      {data.coreGranted && !classificationProposal ? (
                        <RunClassificationButton applicantId={id} documentVersionId={versionId} />
                      ) : null}
                      {classificationProposal ? (
                        <DocumentTypeProposalReview
                          applicantId={id}
                          canApprove={data.coreGranted}
                          proposal={{
                            id: classificationProposal.id,
                            suggestedType: classificationProposal.suggestedType,
                            confidence: classificationProposal.confidence,
                            rationale: classificationProposal.rationale,
                          }}
                        />
                      ) : null}
                    </>
                  );
                })()}
                {(() => {
                  if (!data.ocrConfigured || !data.ocrGranted || !doc.classification) return null;
                  const versionId = doc.latestVersionId;
                  if (!versionId) return null;
                  const latestRun = data.ocrRuns.get(doc.id);
                  return (
                    <>
                      {/* Same core-processing gate as AI extraction above - new OCR
                            is new processing, but an already-completed run's own
                            result remains viewable regardless. */}
                      {data.coreGranted ? (
                        <RunOcrButton applicantId={id} documentVersionId={versionId} />
                      ) : null}
                      {latestRun ? (
                        <OcrResultView
                          text={latestRun.extractedText ?? ''}
                          reviewIssues={latestRun.reviewIssues ?? []}
                          usedFallback={latestRun.triggeredByRunId !== null}
                        />
                      ) : null}
                    </>
                  );
                })()}
                {(() => {
                  // Part 8 AI-01 item 4: same AI_EXTRACTION consent gate as
                  // extraction/classification above -- the check sends the
                  // document's own text plus the applicant's already-
                  // confirmed TRUSTED profile facts, never a second document.
                  if (!data.inconsistencyConfigured || !data.aiGranted || !doc.classification) {
                    return null;
                  }
                  const versionId = doc.latestVersionId;
                  if (!versionId) return null;
                  const flagsForDoc = data.pendingInconsistencyFlags.filter(
                    (f) => f.documentVersionId === versionId,
                  );
                  return (
                    <>
                      {data.coreGranted ? (
                        <RunInconsistencyCheckButton
                          applicantId={id}
                          documentVersionId={versionId}
                        />
                      ) : null}
                      {flagsForDoc.map((flag) => (
                        <InconsistencyFlagReview
                          key={flag.id}
                          applicantId={id}
                          flag={{
                            id: flag.id,
                            description: flag.description,
                            confidence: flag.confidence,
                            rationale: flag.rationale,
                          }}
                        />
                      ))}
                    </>
                  );
                })()}
              </div>
            ),
          };
        })}
      />
      <details className="wallet-upload-disclosure" open={initialKind ? true : undefined}>
        <summary className="btn btn-secondary">Upload a Document</summary>
        <div id="document-upload">
          {/*
           * Only upload and new processing/extraction are gated on core
           * processing consent - existing documents must remain viewable
           * regardless (docs/audits/post-programme-defect-register.md finding
           * #23): "view existing data" and "permit new processing" are
           * deliberately distinct here.
           */}
          {!data.coreGranted ? (
            <article className="card u-mb-150">
              <p className="card-body">
                Turn on <strong>Let VisaStack process my details</strong> on{' '}
                <Link href="/app">Home</Link> to upload new documents or run processing. Your
                existing documents remain visible above.
              </p>
            </article>
          ) : (
            <>
              {data.aiConfigured && !data.aiGranted ? (
                <div className="card u-mb-150">
                  <p className="card-body">
                    Turn on <strong>Let AI read details from my documents</strong> on{' '}
                    <Link href="/app">Home</Link> to get automatic field suggestions from your
                    documents - every suggestion still requires your explicit approval before it
                    changes your profile.
                  </p>
                </div>
              ) : null}

              {data.ocrConfigured && !data.ocrGranted ? (
                <div className="card u-mb-150">
                  <p className="card-body">
                    Turn on <strong>Let AI read text from my scans</strong> on{' '}
                    <Link href="/app">Home</Link> to read text from scanned or photographed
                    documents. This sends the document's image, which shares more than text alone.
                  </p>
                </div>
              ) : null}

              <article className="card u-mb-150">
                <p className="card-kicker">Upload</p>
                <h2 className="card-title">Add a Document</h2>
                <p className="card-body u-mb-125">
                  Documents are stored privately and pass a structural safety scan before they can
                  be previewed.
                </p>
                <div className="u-mb-125">
                  <UsageMeter
                    label="Evidence Storage"
                    usedBytes={data.evidenceBytes}
                    limitBytes={data.quota.maxApplicantEvidenceBytes}
                  />
                </div>
                <DocumentUploader
                  key={initialKind}
                  applicantId={id}
                  limitLabel={mbLabel(data.quota.maxUploadBytes)}
                  virusScanning={getPlatformCapabilities().malwareScanning === 'available'}
                  kindGroups={documentGroups}
                  initialKind={initialKind}
                  originalKinds={ORIGINAL_KINDS}
                />
              </article>
            </>
          )}
        </div>
      </details>
    </>
  );
}
