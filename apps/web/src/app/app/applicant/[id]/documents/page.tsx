import { isOtherDocumentType } from '@visastack/core';
import { ORIGINAL_DOCUMENT_KEYS, resolveDocumentType } from '@visastack/core/catalogue';
import { type MessageKey, type Translator, createTranslator } from '@visastack/i18n';
import {
  CONVERTED_FROM_HEIC_SOURCE,
  DEFAULT_DOCUMENT_PROTECTION,
  type DocumentLifecycleStatus,
  accountPrincipal,
  classifyExpiry,
  documentCategory,
  getAiFeatureStates,
  getApplicant,
  getApplicantEvidenceBytes,
  getLatestOcrRun,
  getWalletView,
  hasConsent,
  isPassportPhotoType,
  isRestrictedDocumentType,
  isServableProcessingState,
  listApplicantProfile,
  listDocumentReadingStates,
  listDocumentsDetailed,
  listIssuerVerificationsForDocument,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  listRedactionStates,
  loadUploadQuotaConfig,
  mbLabel,
  readDocumentProtectionSettings,
  referenceCodesFor,
  requireAccess,
  storageLimitsForOwner,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiFeatureOffNote } from '../../../../../components/ai-feature-off';
import { AutoRefresh } from '../../../../../components/auto-refresh';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { DocumentWalletBrowser } from '../../../../../components/document-wallet-browser';
import { ReferenceCode } from '../../../../../components/reference-code';
import {
  SAFE_COPY_STATE_LABELS,
  SafeCopyEditor,
  type SafeCopyStateName,
} from '../../../../../components/safe-copy-editor';
import { PageHeader } from '../../../../../components/ui';
import { VisaPhotoSizes } from '../../../../../components/visa-photo-sizes';
import {
  isClassificationConfigured,
  isInconsistencyConfigured,
  isOcrConfigured,
  resolveAiExtractionAvailability,
} from '../../../../../lib/ai';
import {
  getPlatformCapabilities,
  resolvePlatformCapabilities,
} from '../../../../../lib/capabilities';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { confirmedValues, findingViewModel } from '../../../../../lib/document-findings';
import { readingOffer, readingStatusCopy } from '../../../../../lib/document-reading';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { documentTypeLabel } from '../../../../../lib/labels';
import { getLocale } from '../../../../../lib/locale';
import { categoryLabel, evidenceDocumentGroups } from '../../../../../lib/master-profile';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { isStillProcessing } from '../../../../../lib/resilience';
import { withSession } from '../../../../../lib/session';
import { pdfUploadsAccepted, uploadLimitBytes } from '../../../../../lib/upload-preflight';
import {
  previewDocumentAction,
  requestDocumentReadingAction,
  setDocumentDateAction,
} from '../actions';
import {
  DocumentFindings,
  InconsistencyFlagReview,
  OcrResultView,
  ReadAgainButton,
  RunClassificationButton,
  RunInconsistencyCheckButton,
} from '../ai-review';
import { DocumentRenameForm } from '../document-rename-form';
import { documentSuggestionView } from '../document-suggestion';
import { DocumentSuggestionCard } from '../document-suggestion-card';
import { DocumentTypeForm } from '../document-type-form';
import { DocumentUploader } from '../document-uploader';
import { downloadOriginalAction } from '../download-actions';
import { ReadingOfferCard, ReadingStatus } from '../reading-status';
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
  UNKNOWN: { label: 'Expiry Not Confirmed', tone: 'badge-neutral' },
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
    const encryption = createKeyManagementPort();
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const quota = loadUploadQuotaConfig();
    const [
      documents,
      coreGranted,
      aiGranted,
      ocrGranted,
      ocrConfigured,
      classificationConfigured,
      inconsistencyConfigured,
      evidenceBytes,
      [pendingProposals, profile],
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
      // What the profile already holds, read only when there are readings to compare it with.
      listPendingProposals(db, id).then(
        async (proposals) =>
          [
            proposals,
            proposals.length > 0 ? await listApplicantProfile(db, id, encryption) : [],
          ] as const,
      ),
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
    const confirmed = confirmedValues(profile, encryption !== undefined);
    // How each file's reading is going and where each suggestion came from (S6, ADR 0019). Owner
    // only, through the access gate; if it is refused the page simply shows no reading states.
    const readingAccess = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    const reading = readingAccess.ok
      ? await listDocumentReadingStates(
          readingAccess.value,
          documentRows.flatMap((doc) => (doc.latestVersionId ? [doc.latestVersionId] : [])),
        )
      : undefined;
    // Where each document's safe copy stands (S23, ADR 0022), through the same owner proof. If it
    // cannot be read, every document reads Not Prepared Yet, which is what the server enforces too.
    const safeCopies = readingAccess.ok
      ? await listRedactionStates(
          readingAccess.value,
          documentRows.flatMap((doc) => (doc.latestVersionId ? [doc.latestVersionId] : [])),
        )
      : undefined;
    const detailsAvailable =
      (await resolveAiExtractionAvailability(db, encryption !== undefined)) === 'available';
    // Each AI button's own switch (S28), through the same owner proof. If it cannot be read, the
    // buttons stay as they were and the service still refuses a feature that is off.
    const aiFeatures = readingAccess.ok
      ? await getAiFeatureStates(
          db,
          ['ai_document_reading', 'ai_document_kind', 'ai_consistency_checks'] as const,
          { proof: readingAccess.value },
        )
      : undefined;
    // The live protection rule, for the card's fresh sign-in warning. If it cannot be read, the
    // built-in rule applies, which protects every file whose kind is not known yet.
    const protection = await readDocumentProtectionSettings(db).catch(
      () => DEFAULT_DOCUMENT_PROTECTION,
    );
    // Visible codes (ADR 0018) for the documents already read above; none before migration 0091.
    const referenceCodes = await referenceCodesFor(
      db,
      'D',
      documentRows.map((doc) => doc.id),
    );
    return {
      protection,
      referenceCodes,
      displayName: applicant.displayName ?? 'Unknown',
      documents: documentRows,
      recordsUnavailable: !documents.ok || !wallet.ok,
      coreGranted,
      aiGranted,
      detailsAvailable,
      aiFeatures,
      reading: reading?.ok ? reading.value : undefined,
      safeCopies: safeCopies?.ok ? safeCopies.value : new Map<string, SafeCopyStateName>(),
      ocrGranted,
      ocrConfigured,
      classificationConfigured,
      inconsistencyConfigured,
      evidenceBytes,
      pendingProposals,
      confirmed,
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      quota,
      // The record owner's storage limit for one person: their plan's rule, else the setting.
      personLimitBytes: (await storageLimitsForOwner(db, applicant.ownerAccountId, quota))
        .personBytes,
      virusScanning: (await resolvePlatformCapabilities(db)).malwareScanning === 'available',
      wallet: new Map((wallet.ok ? wallet.value : []).map((w) => [w.document.id, w])),
      issuerVerifications,
      ocrRuns,
    };
  });

  if (!data) notFound();

  if (data.recordsUnavailable)
    return (
      <>
        <PageHeader eyebrow="Record" title="Documents" description="Your private evidence wallet" />
        <p role="alert" className="notice notice-warn">
          We could not load your document records or lifecycle status. Refresh to try again.
          Unavailable records are not reported as an empty wallet.
        </p>
      </>
    );

  // While the server is still scanning or reading a file, keep this page up to date by
  // itself: nobody has to reload, and nobody uploads the file again because nothing seemed
  // to happen (directive Part 9 section 3).
  // Kinds that need a fresh sign-in check, for the card's warning while a person edits the kind.
  const protectedKinds = documentGroups
    .flatMap((group) => group.choices.map((choice) => choice.key))
    .filter((key) => isRestrictedDocumentType(key, data.protection));
  const anyProcessing = data.documents.some((doc) => isStillProcessing(doc.processingStatus));
  // A queued or running AI reading keeps the page fresh too, though the file itself is ready.
  const readingInProgress = [...(data.reading?.states.values() ?? [])].some(
    (state) => state.stage === 'reading' || state.stage === 'checking',
  );
  // One invitation for the whole page, only once documents can be processed at all.
  const offer = data.coreGranted
    ? readingOffer({
        detailsAvailable: data.detailsAvailable,
        scansAvailable: data.ocrConfigured,
        detailsGranted: data.aiGranted,
        scansGranted: data.ocrGranted,
      })
    : null;

  // A link that opens one document (?document=) must land on it: the list and the selected
  // document sit at Browse, so such a visit starts at Browse at least, without saving that.
  const savedDepth = await readDepth('documents');
  const depth =
    initialSelection && (savedDepth === 'auto' || savedDepth === 'glance') ? 'browse' : savedDepth;
  const depthWords = depthCopyFor('documents');
  const safeCopiesOn = getPlatformCapabilities().redactedDownload === 'available';

  return (
    <>
      <PageHeader
        eyebrow="Record"
        title="Documents"
        description="Keep reusable evidence together. Processing, review and expiry are separate signals."
        actions={
          <>
            <Link className="btn btn-secondary" href={`/app/applicant/${id}/insights`}>
              See Document Insights
            </Link>
            <a className="btn btn-primary" href="#document-upload">
              Upload Document
            </a>
          </>
        }
      />
      <DepthScope family="documents" depth={depth}>
        <DepthSwitch family="documents" initial={depth} copy={depthWords} />
        {downloadError ? (
          <p role="alert" className="card-body">
            We could not download this document. Try again after confirming your account. Documents
            still being checked are unavailable for download.
          </p>
        ) : null}
        <AutoRefresh active={anyProcessing || readingInProgress} />
        {anyProcessing ? (
          <p className="muted">
            Some documents are still being checked, which can take a few minutes. This page updates
            by itself, so there is no need to upload them again.
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

        {offer ? <ReadingOfferCard offer={offer} /> : null}

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
            const safeCopyState: SafeCopyStateName =
              (doc.latestVersionId ? data.safeCopies.get(doc.latestVersionId) : undefined) ??
              'NOT_PREPARED';
            const safeCopyLabel = SAFE_COPY_STATE_LABELS[safeCopyState];
            const safeCopyReady = safeCopyState === 'MASKED' || safeCopyState === 'NOTHING_TO_HIDE';
            // A waiting AI kind for the file as it is now (an older file's suggestion no longer applies).
            const waitingKind = data.pendingClassificationProposals.find(
              (p) => p.documentVersionId === doc.latestVersionId,
            );
            // What we think this document is and what to call it: nothing is saved until the
            // person accepts (owner request 2026-10-25).
            const suggestion = documentSuggestionView(
              doc,
              waitingKind,
              data.displayName,
              data.protection,
            );
            const needsReview =
              (doc.docType === 'PASSPORT' && lifecycle === 'UNKNOWN') ||
              doc.safetyStatus === 'QUARANTINED' ||
              doc.processingStatus === 'AWAITING_REVIEW' ||
              doc.classification?.reviewRequired === true ||
              doc.pendingNameVersion !== null ||
              suggestion !== null ||
              ['QUARANTINED', 'REJECTED', 'FAILED', 'NEEDS_ATTENTION'].includes(
                doc.processingStatus ?? '',
              ) ||
              data.pendingProposals.some(
                ({ proposal }) => proposal.documentVersionId === doc.latestVersionId,
              );
            const category = documentCategory(doc.docType);
            const suggested = doc.docType ? undefined : waitingKind;
            // Read Again needs the switch for what it would do: text, or a scan first and then text.
            const readingOn = data.aiFeatures?.ai_document_reading.available !== false;
            const couldReadAgain =
              data.coreGranted &&
              ((data.detailsAvailable && data.aiGranted) ||
                (data.ocrConfigured && data.ocrGranted));
            // Read with AI turned off (S28): the hint takes the button's place.
            const canReadAgain = couldReadAgain && readingOn;
            return {
              id: doc.id,
              name: doc.approvedName ?? doc.originalName,
              // An "Other" kind shows the name the person gave it, when there is one.
              kind: doc.docType
                ? doc.subject && isOtherDocumentType(doc.docType)
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
                <div key={doc.id} {...atLevel('browse')}>
                  <div
                    className="wallet-document-actions"
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
                  >
                    <ReferenceCode
                      code={data.referenceCodes.get(doc.id)}
                      label="Document Reference"
                    />
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
                        {previewable && safeCopiesOn ? (
                          <span
                            className={`badge ${safeCopyReady ? 'badge-success' : 'badge-neutral'}`}
                          >
                            {safeCopyLabel}
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
                        {previewable &&
                        getPlatformCapabilities().originalDownload === 'available' ? (
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
                    {doc.source === CONVERTED_FROM_HEIC_SOURCE ? (
                      <p className="muted u-fs-075-m0">
                        Saved as a JPG copy of the iPhone photo (HEIC) that was uploaded, so it
                        opens anywhere. The HEIC file itself was not kept.
                      </p>
                    ) : null}
                    {previewable && isPassportPhotoType(doc.docType) ? (
                      <VisaPhotoSizes
                        documentId={doc.id}
                        returnTo={`/app/applicant/${id}/documents?document=${doc.id}`}
                      />
                    ) : null}
                    {previewable ? (
                      <SafeCopyEditor
                        key={`${doc.id}-${doc.latestVersionId ?? ''}`}
                        documentId={doc.id}
                        versionId={doc.latestVersionId}
                        available={safeCopiesOn}
                        returnTo={`/app/applicant/${id}/documents?document=${doc.id}#safe-copy-${doc.id}`}
                        initialState={safeCopyState}
                      />
                    ) : null}
                    {(() => {
                      const state = doc.latestVersionId
                        ? data.reading?.states.get(doc.latestVersionId)
                        : undefined;
                      const copy = state
                        ? readingStatusCopy(state, {
                            ...(doc.processingStatus && PROBLEM_NEXT_STEP[doc.processingStatus]
                              ? { problemNextStep: PROBLEM_NEXT_STEP[doc.processingStatus] }
                              : {}),
                            canReadAgain,
                          })
                        : null;
                      return state && copy ? (
                        <ReadingStatus copy={copy} stage={state.stage} applicantId={id} />
                      ) : null;
                    })()}
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
                          Check the File Again
                        </button>
                      </form>
                    ) : null}
                    {/* A file with no reading state (the reading service was refused) keeps the plain advice. */}
                    {doc.processingStatus &&
                    PROBLEM_NEXT_STEP[doc.processingStatus] &&
                    !(doc.latestVersionId && data.reading?.states.has(doc.latestVersionId)) ? (
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
                    <form action={setDocumentDateAction} className="field-stack">
                      <input type="hidden" name="applicantId" value={id} />
                      <input type="hidden" name="documentId" value={doc.id} />
                      <label className="field-label" htmlFor={`date-${doc.id}`}>
                        Document Date
                      </label>
                      <div className="field-inline">
                        <input
                          id={`date-${doc.id}`}
                          name="documentDate"
                          type="date"
                          defaultValue={doc.documentDate ?? ''}
                          max={new Date().toISOString().slice(0, 10)}
                          className="input"
                          aria-describedby={`date-hint-${doc.id}`}
                        />
                        <button type="submit" className="btn btn-secondary">
                          Save
                        </button>
                      </div>
                      <span className="field-hint" id={`date-hint-${doc.id}`}>
                        Used to judge freshness for routes that require recently-dated evidence.
                      </span>
                    </form>
                    <DocumentRenameForm
                      applicantId={id}
                      documentId={doc.id}
                      name={doc.approvedName ?? doc.originalName}
                    />
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
                                  {c.issuerIdentity}: "{c.exactClaim}", response: {c.response},
                                  valid until {formatTimestampDate(c.validUntil)}
                                </p>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()}
                    {suggestion ? (
                      <DocumentSuggestionCard
                        applicantId={id}
                        suggestion={suggestion}
                        groups={documentGroups}
                        protectedKinds={protectedKinds}
                      />
                    ) : doc.classification?.reviewRequired ? (
                      <p className="muted u-fs-075">
                        We could not tell what kind of document this is. Choose the kind above.
                      </p>
                    ) : null}
                    {(() => {
                      const versionId = doc.latestVersionId;
                      if (!versionId) return null;
                      const proposalsForDoc = data.pendingProposals.filter(
                        (p) => p.proposal.documentVersionId === versionId,
                      );
                      const stage = data.reading?.states.get(versionId)?.stage;
                      // Read Again is the retry: offered once the first reading is over, never while it runs.
                      const readAgainStage =
                        couldReadAgain &&
                        doc.classification &&
                        (stage === 'found' || stage === 'could_not_read' || stage === 'done');
                      return (
                        <>
                          {readAgainStage && readingOn ? (
                            <ReadAgainButton applicantId={id} documentVersionId={versionId} />
                          ) : readAgainStage ? (
                            <AiFeatureOffNote
                              reason={data.aiFeatures?.ai_document_reading.reason ?? null}
                            />
                          ) : null}
                          {/* Suggestions are shown whatever the AI switches say: the passport's
                          machine-readable lines need no AI. Accepting still needs core processing
                          consent (finding #23). */}
                          <DocumentFindings
                            applicantId={id}
                            canApprove={data.coreGranted}
                            proposals={proposalsForDoc.map((reading) =>
                              findingViewModel(
                                reading,
                                data.confirmed,
                                data.reading?.sourceOfRun.get(reading.proposal.aiExtractionRunId),
                              ),
                            )}
                          />
                        </>
                      );
                    })()}
                    {(() => {
                      // Part 8 AI-01 item 2: shown only on a genuine deterministic
                      // gap (no classification yet reached, or one reached but not
                      // confident) -- never offered once a confident deterministic
                      // (or already-approved AI) classification already exists.
                      if (
                        !data.classificationConfigured ||
                        !data.aiGranted ||
                        !doc.classification
                      ) {
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
                      // A waiting AI kind is shown in the card above, decided with its name.
                      if (waitingKind || !data.coreGranted || doc.docType) return null;
                      const kindFeature = data.aiFeatures?.ai_document_kind;
                      if (kindFeature && !kindFeature.available) {
                        return <AiFeatureOffNote reason={kindFeature.reason} />;
                      }
                      return (
                        <RunClassificationButton applicantId={id} documentVersionId={versionId} />
                      );
                    })()}
                    {(() => {
                      if (!data.ocrConfigured || !data.ocrGranted || !doc.classification)
                        return null;
                      const latestRun = data.ocrRuns.get(doc.id);
                      return latestRun ? (
                        <OcrResultView
                          text={latestRun.extractedText ?? ''}
                          reviewIssues={latestRun.reviewIssues ?? []}
                          usedFallback={latestRun.triggeredByRunId !== null}
                        />
                      ) : null;
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
                          {data.coreGranted &&
                          data.aiFeatures?.ai_consistency_checks.available !== false ? (
                            <RunInconsistencyCheckButton
                              applicantId={id}
                              documentVersionId={versionId}
                            />
                          ) : data.coreGranted ? (
                            <AiFeatureOffNote
                              reason={data.aiFeatures?.ai_consistency_checks.reason ?? null}
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
                </div>
              ),
            };
          })}
        />
        <details
          className="wallet-upload-disclosure"
          id="add-document"
          {...atLevel('everything')}
          open={initialKind ? true : undefined}
        >
          <summary className="btn btn-secondary">Upload Document</summary>
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
                  Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
                  <Link href="/app">Home</Link> to upload new documents or run processing. Your
                  existing documents remain visible above.
                </p>
              </article>
            ) : (
              <>
                <article className="card u-mb-150">
                  <p className="card-kicker">Upload</p>
                  <h2 className="card-title">Add Documents</h2>
                  <p className="card-body u-mb-125">
                    Add several at once. Documents are stored privately and pass a structural safety
                    scan before they can be previewed.
                  </p>
                  <div className="u-mb-125">
                    <UsageMeter
                      label="Evidence Storage"
                      usedBytes={data.evidenceBytes}
                      limitBytes={data.personLimitBytes}
                    />
                  </div>
                  <DocumentUploader
                    key={initialKind}
                    applicantId={id}
                    limitBytes={uploadLimitBytes(data.quota)}
                    limitLabel={mbLabel(uploadLimitBytes(data.quota))}
                    pdfAccepted={pdfUploadsAccepted()}
                    virusScanning={data.virusScanning}
                    kindGroups={documentGroups}
                    initialKind={initialKind}
                    originalKinds={ORIGINAL_KINDS}
                  />
                </article>
              </>
            )}
          </div>
        </details>
      </DepthScope>
    </>
  );
}
