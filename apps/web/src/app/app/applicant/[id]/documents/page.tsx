import { isOtherDocumentType } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue';
import { type MessageKey, createTranslator } from '@visastack/i18n';
import {
  CONVERTED_FROM_HEIC_SOURCE,
  DEFAULT_DOCUMENT_PROTECTION,
  type DocumentAction,
  type DocumentLifecycleStatus,
  type VersionScanEvidence,
  accountPrincipal,
  availableDocumentActions,
  classifyExpiry,
  documentCategory,
  duplicateStatuses,
  getAiFeatureStates,
  getApplicant,
  getDocumentLifecycles,
  getLatestOcrRun,
  getWalletView,
  hasConsent,
  isPassportPhotoType,
  isServableProcessingState,
  isSharedBetweenPeopleKind,
  lifecycleTablesPresent,
  listApplicantProfile,
  listAutoPlacements,
  listCopyPeople,
  listDeletionReceipts,
  listDocumentExceptions,
  listDocumentReadingStates,
  listDocumentsDetailed,
  listHeldFiles,
  listIssuerVerificationsForDocument,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  listRedactionStates,
  loadVersionScanEvidence,
  readDocumentProtectionSettings,
  referenceCodesFor,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiFeatureOffNote } from '../../../../../components/ai-feature-off';
import { AutoRefresh } from '../../../../../components/auto-refresh';
import { DepthScope } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { DocumentWalletBrowser } from '../../../../../components/document-wallet-browser';
import { ReferenceCode } from '../../../../../components/reference-code';
import { SafeCopyEditor } from '../../../../../components/safe-copy-editor';
import {
  SAFE_COPY_STATE_LABELS,
  type SafeCopyStateName,
} from '../../../../../components/safe-copy-state';
import { PageHeader } from '../../../../../components/ui';
import { VisaPhotoSizes } from '../../../../../components/visa-photo-sizes';
import {
  isClassificationConfigured,
  isInconsistencyConfigured,
  isOcrConfigured,
  resolveAiExtractionAvailability,
} from '../../../../../lib/ai';
import { getPlatformCapabilities } from '../../../../../lib/capabilities';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { confirmedValues, findingViewModel } from '../../../../../lib/document-findings';
import { readingOffer, readingStatusCopy } from '../../../../../lib/document-reading';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { documentTypeLabel } from '../../../../../lib/labels';
import { getLocale } from '../../../../../lib/locale';
import { categoryLabel, evidenceDocumentGroups } from '../../../../../lib/master-profile';
import { protectedKindsOf } from '../../../../../lib/protected-kinds';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { isStillProcessing } from '../../../../../lib/resilience';
import {
  type ScanStatePresentation,
  presentScanState,
  shortScanLine,
} from '../../../../../lib/scan-state';
import { withSession } from '../../../../../lib/session';
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
import { downloadOriginalAction } from '../download-actions';
import { ReadingOfferCard, ReadingStatus } from '../reading-status';
import { type LifecycleTab, LifecycleTabs, lifecycleTabOf } from './manage/lifecycle-tabs';
import { ManageMenu } from './manage/manage-menu';
import { registeredActions } from './manage/registry';
import { removalRequestFacts } from './manage/request/facts';
import { documentActionView, isDocumentAction } from './manage/view';
import { NeedsDecision } from './needs-decision';

export const metadata: Metadata = { title: 'Documents' };

export const dynamic = 'force-dynamic';

/** What a row says for a file that has no processing state yet. */
const NOT_YET_CHECKED = 'Not Yet Checked';

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

/**
 * The checks badge for a document's latest file, read from what was really done to that exact
 * file (scan-state.ts). The stored CLEAN value still decides who can open it; it is never
 * worded as a virus scan unless a trusted scan recorded a pass for this file.
 */
function safetyBadge(
  doc: { readonly latestVersionId: string | null },
  evidence: ReadonlyMap<string, VersionScanEvidence>,
): ScanStatePresentation {
  return presentScanState(doc.latestVersionId ? evidence.get(doc.latestVersionId) : null);
}

/** What a person can do next when a file could not be used (a state with no next step is a dead end). */
const PROBLEM_NEXT_STEP: Record<string, string> = {
  FAILED: 'We could not finish checking this file. Try uploading it again.',
  NEEDS_ATTENTION:
    'This file could not be accepted as it is. Try a different copy, such as a clearer scan or a smaller file.',
  REJECTED: 'This file was rejected. Upload a different copy if you still need it.',
};

/**
 * The same advice in its shortest true form, for the opened document (Owner, 5 Nov 2026: no page
 * should have more than 30 words). The full wording is read under "About This File".
 */
const PROBLEM_NEXT_STEP_SHORT: Record<string, string> = {
  FAILED: 'We could not check this file. Upload it again.',
  NEEDS_ATTENTION: 'This file was not accepted. Try a different copy.',
  REJECTED: 'This file was rejected. Upload a different copy.',
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
  SUPERSEDED: { label: 'Replaced', tone: 'badge-neutral' },
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
    /** Which lifecycle list to show: Current (default), archived or deleted. */
    readonly view?: string;
    /** A reminder's link: the document to manage and the action to open (?manage=&action=). */
    readonly manage?: string;
    readonly action?: string;
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
    view: requestedView,
    manage: manageDocumentId,
    action: requestedAction,
  } = await searchParams;
  const requestedTab: LifecycleTab = lifecycleTabOf(requestedView);
  // Only a kind the catalogue knows opens the upload form ready; anything else is ignored.
  const initialKind =
    typeof requestedType === 'string' ? (resolveDocumentType(requestedType)?.key ?? '') : '';
  const locale = await getLocale();
  const t = createTranslator(locale);
  const documentGroups = evidenceDocumentGroups();
  // The Add Documents page, ready on a kind when the address names one the catalogue knows.
  const addDocumentsBase = `/app/applicant/${id}/documents/add`;
  const addDocumentsHref = initialKind
    ? `${addDocumentsBase}?type=${encodeURIComponent(initialKind)}`
    : addDocumentsBase;

  const data = await withSession(async ({ db, accountId }) => {
    const encryption = createKeyManagementPort();
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
      [pendingProposals, profile],
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      wallet,
    ] = await Promise.all([
      listDocumentsDetailed(db, accountId, id, { lifecycle: 'all' }),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      hasConsent(db, accountId, 'AI_EXTRACTION'),
      hasConsent(db, accountId, 'AI_OCR'),
      isOcrConfigured(db),
      isClassificationConfigured(db),
      isInconsistencyConfigured(db),
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
    // What was really done to each document's latest file, so the badge never says more than the
    // records for that exact file support (scan-state.ts). One query for the whole list, through
    // the same owner proof. Without a proof every file reads Format Checked, never scanned.
    const scanEvidence = readingAccess.ok
      ? await loadVersionScanEvidence(
          readingAccess.value,
          documentRows.flatMap((doc) =>
            doc.latestVersionId && doc.safetyStatus
              ? [{ id: doc.latestVersionId, safetyStatus: doc.safetyStatus }]
              : [],
          ),
        )
      : new Map<string, VersionScanEvidence>();
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
    // UMPE P3: the files needing one decision, through the same owner proof; and whether the
    // server keeps upload receipts, which lets the import send a file with no answer again safely.
    // Both are extras: if either cannot be read, the page shows no list and the import keeps
    // its no-automatic-retry rule, never an error.
    const noDecisions = { exceptions: [], confirmed: [] };
    // UMPE G1: this account's files waiting for Which Person? (seen only by the account that
    // added them), and whether the family batch is available yet. Extras like the list above.
    const noHeldFiles = { files: [], people: [] };
    // UMPE G4: what was placed automatically lately, each with its Change. An extra like the rest.
    const [understanding, heldFiles, automatic] = await Promise.all([
      readingAccess.ok
        ? listDocumentExceptions(readingAccess.value).catch(() => noDecisions)
        : Promise.resolve(noDecisions),
      readingAccess.ok
        ? listHeldFiles(readingAccess.value).catch(() => noHeldFiles)
        : Promise.resolve(noHeldFiles),
      readingAccess.ok
        ? listAutoPlacements(readingAccess.value).catch(() => [])
        : Promise.resolve([]),
    ]);
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
    // Archive, Recently Deleted and the Manage menu (resource lifecycle, migration 0113). Before
    // that migration nothing here is read and the page is exactly as it was: no tabs, no menu,
    // every document in the one list.
    const lifecycle =
      readingAccess.ok && (await lifecycleTablesPresent(db))
        ? await (async () => {
            const states = await getDocumentLifecycles(
              db,
              documentRows.map((doc) => doc.id),
              readingAccess.value,
            );
            const receipts = await listDeletionReceipts(readingAccess.value, { limit: 1 });
            // LC-C: whether each document is an exact copy that may be deleted (D2, D5).
            const duplicates = await duplicateStatuses(
              db,
              documentRows.map((doc) => doc.id),
              readingAccess.value,
            );
            // Lane D's facts: a waiting removal request, a legal hold, the request switch.
            const removal = await removalRequestFacts(
              db,
              readingAccess.value,
              id,
              documentRows.map((doc) => doc.id),
            );
            // Someone else on the account to keep a copy for (a marriage certificate, a joint
            // account statement). An extra: if the list cannot be read, no copy is offered.
            // Asked only when one of the documents belongs to two people.
            const copyPeople = documentRows.some((doc) => isSharedBetweenPeopleKind(doc.docType))
              ? (await listCopyPeople(readingAccess.value).catch(() => [])).map((person) => ({
                  id: person.applicantId,
                  name: person.displayName,
                }))
              : [];
            const actions = new Map<string, readonly DocumentAction[]>(
              documentRows.map((doc) => {
                const state = states.get(doc.id);
                const duplicate = duplicates.get(doc.id);
                const facts = {
                  isDuplicate: duplicate?.isDuplicate ?? false,
                  duplicateBlockReason: duplicate?.blockReason ?? null,
                  keepCopyForOthers:
                    copyPeople.length > 0 && isSharedBetweenPeopleKind(doc.docType),
                  ...removal.get(doc.id),
                };
                return [
                  doc.id,
                  state ? availableDocumentActions(documentActionView(state, facts)) : [],
                ];
              }),
            );
            return {
              states,
              actions,
              copyPeople,
              hasRemovalRecords: receipts.ok && receipts.value.length > 0,
            };
          })()
        : null;
    // Visible codes (ADR 0018) for the documents already read above; none before migration 0091.
    const referenceCodes = await referenceCodesFor(
      db,
      'D',
      documentRows.map((doc) => doc.id),
    );
    return {
      understanding,
      heldFiles,
      automatic,
      protection,
      referenceCodes,
      lifecycle,
      displayName: applicant.displayName ?? 'Unknown',
      documents: documentRows,
      scanEvidence,
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
      pendingProposals,
      confirmed,
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      wallet: new Map((wallet.ok ? wallet.value : []).map((w) => [w.document.id, w])),
      issuerVerifications,
      ocrRuns,
    };
  });

  if (!data) notFound();

  if (data.recordsUnavailable)
    return (
      <>
        <PageHeader eyebrow="Record" title="Documents" description="Your private documents" />
        <p role="alert" className="notice notice-warn">
          We could not load your document records or lifecycle status. Refresh to try again.
          Unavailable records are not shown as an empty list.
        </p>
      </>
    );

  // While the server is still scanning or reading a file, keep this page up to date by
  // itself: nobody has to reload, and nobody uploads the file again because nothing seemed
  // to happen (directive Part 9 section 3).
  // Kinds that need a fresh sign-in check, for the card's warning while a person edits the kind.
  const protectedKinds = protectedKindsOf(documentGroups, data.protection);
  // A document in Recently Deleted is never processed again (LC-A2), so it never keeps the page
  // refreshing, whatever state it was left in.
  const anyProcessing = data.documents.some((doc) => {
    const state = data.lifecycle?.states.get(doc.id)?.state;
    if (state === 'RECENTLY_DELETED' || state === 'REMOVING') return false;
    return isStillProcessing(doc.processingStatus);
  });
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

  // A link that opens one document (?document=, or a reminder's ?manage=) must land on it: the
  // list and the selected document sit at Browse, so such a visit starts at Browse at least,
  // without saving that.
  const savedDepth = await readDepth('documents');
  const depth =
    (initialSelection || manageDocumentId) && (savedDepth === 'auto' || savedDepth === 'glance')
      ? 'browse'
      : savedDepth;
  const depthWords = depthCopyFor('documents');
  const safeCopiesOn = getPlatformCapabilities().redactedDownload === 'available';
  // Which documents the chosen list shows. Without the lifecycle tables every document is Current.
  const lifecycleStateOf = (documentId: string) =>
    data.lifecycle?.states.get(documentId)?.state ?? 'CURRENT';
  const tabOfState = (state: string): LifecycleTab =>
    state === 'ARCHIVED'
      ? 'archived'
      : state === 'RECENTLY_DELETED' || state === 'REMOVING'
        ? 'deleted'
        : 'current';
  // A reminder's link (?manage=<documentId>&action=) opens the list that holds that document.
  const deepLinked =
    data.lifecycle && manageDocumentId && data.documents.some((doc) => doc.id === manageDocumentId)
      ? manageDocumentId
      : undefined;
  const tab: LifecycleTab =
    deepLinked && requestedView === undefined
      ? tabOfState(lifecycleStateOf(deepLinked))
      : requestedTab;
  const inTab = (documentId: string) => {
    const state = lifecycleStateOf(documentId);
    if (tab === 'archived') return state === 'ARCHIVED';
    if (tab === 'deleted') return state === 'RECENTLY_DELETED' || state === 'REMOVING';
    return state === 'CURRENT';
  };
  const archivedCount = data.documents.filter(
    (doc) => lifecycleStateOf(doc.id) === 'ARCHIVED',
  ).length;
  const deletedCount = data.documents.filter((doc) => {
    const state = lifecycleStateOf(doc.id);
    return state === 'RECENTLY_DELETED' || state === 'REMOVING';
  }).length;
  const inList = data.lifecycle ? data.documents.filter((doc) => inTab(doc.id)) : data.documents;
  // The deep-linked document comes first and is selected, so its row (and its menu) is on screen
  // whatever page of the list it would otherwise fall on.
  const listedDocuments = deepLinked
    ? [
        ...inList.filter((doc) => doc.id === deepLinked),
        ...inList.filter((doc) => doc.id !== deepLinked),
      ]
    : inList;
  const selection = initialSelection ?? (deepLinked && inTab(deepLinked) ? deepLinked : undefined);
  // A reminder's deep link opens one document's action; only an action the rule allows opens.
  const deepLinkAction =
    deepLinked && isDocumentAction(requestedAction) ? requestedAction : undefined;
  // Only actions a lane has registered: until then no row gets a menu, or any wrapper for one.
  const actionsFor = (documentId: string): readonly DocumentAction[] =>
    registeredActions(data.lifecycle?.actions.get(documentId) ?? []).map((item) => item.action);

  return (
    <>
      <PageHeader
        eyebrow="Record"
        title="Documents"
        actions={
          <>
            <Link className="btn btn-secondary" href={`/app/applicant/${id}/insights`}>
              See Document Insights
            </Link>
            <Link
              className="btn btn-primary docs-add-primary"
              href={`/app/applicant/${id}/documents/add`}
            >
              Add Documents
            </Link>
          </>
        }
      />
      <DepthScope family="documents" depth={depth}>
        <DepthSwitch family="documents" initial={depth} copy={depthWords} notesBehindInfo />
        {downloadError ? (
          <p role="alert" className="card-body">
            We could not download this document. Try again after confirming your account. Documents
            still being checked are unavailable for download.
          </p>
        ) : null}
        <AutoRefresh active={anyProcessing || readingInProgress} />
        {anyProcessing ? (
          <p className="muted docs-working-note">Checking your files. This page updates itself.</p>
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

        <NeedsDecision
          applicantId={id}
          items={data.understanding.exceptions.map((item) =>
            item.kind === 'relation'
              ? {
                  kind: 'relation' as const,
                  proposalId: item.proposalId,
                  documentId: item.documentId,
                  title: item.title,
                  relatedDocumentId: item.relatedDocumentId,
                  relatedTitle: item.relatedTitle,
                  relation: item.relation,
                  labels: item.labels,
                }
              : item,
          )}
          linked={data.understanding.confirmed}
          held={data.heldFiles.files.map((file) => ({
            holdId: file.holdId,
            fileName: file.fileName,
            basis: file.basis,
            proposedApplicantId: file.proposedApplicantId,
            nameSuggestionApplicantId: file.nameSuggestionApplicantId,
            addedOn: formatTimestampDate(file.addedAt),
          }))}
          people={data.heldFiles.people}
          automatic={data.automatic}
          personName={data.displayName}
        />

        {data.lifecycle ? (
          <div>
            <LifecycleTabs
              basePath={`/app/applicant/${id}/documents`}
              active={tab}
              archivedCount={archivedCount}
              deletedCount={deletedCount}
              removalRecordsHref={
                data.lifecycle.hasRemovalRecords ? `/app/applicant/${id}/removal-records` : null
              }
            />
          </div>
        ) : null}

        <DocumentWalletBrowser
          key={`${selection ?? id}:${tab}`}
          applicantId={id}
          {...(selection ? { initialSelection: selection } : {})}
          documents={listedDocuments.map((doc) => {
            const badge = safetyBadge(doc, data.scanEvidence);
            const processingKey = doc.processingStatus
              ? PROCESSING_STATE_KEYS[doc.processingStatus]
              : undefined;
            // A document in Recently Deleted or being removed is never opened, downloaded or read
            // again (the server refuses each), so none of those buttons is offered. An archived
            // document is still the person's own file and keeps them.
            const binned =
              lifecycleStateOf(doc.id) === 'RECENTLY_DELETED' ||
              lifecycleStateOf(doc.id) === 'REMOVING';
            const previewable =
              !binned &&
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
            // The one word a row shows when something is not normal. A normal file shows nothing;
            // how it was checked is in its details (Owner, 5 Nov 2026: no page should have more
            // than 30 words). The most serious thing wins, so a row never carries two pills.
            const lifecycleStatus = data.wallet.get(doc.id)?.status;
            const stateWords: { label: string; tone: 'neutral' | 'warning' | 'danger' } | null =
              badge.tone === 'danger' || badge.tone === 'warning'
                ? { label: badge.label, tone: badge.tone }
                : needsReview
                  ? { label: processingKey ? t(processingKey) : NOT_YET_CHECKED, tone: 'warning' }
                  : lifecycleStatus === 'EXPIRED'
                    ? { label: LIFECYCLE_BADGES.EXPIRED.label, tone: 'danger' }
                    : lifecycleStatus === 'EXPIRING'
                      ? { label: LIFECYCLE_BADGES.EXPIRING.label, tone: 'warning' }
                      : lifecycleStatus === 'SUPERSEDED'
                        ? { label: LIFECYCLE_BADGES.SUPERSEDED.label, tone: 'neutral' }
                        : doc.processingStatus !== 'APPROVED'
                          ? {
                              label: processingKey ? t(processingKey) : NOT_YET_CHECKED,
                              tone: 'neutral',
                            }
                          : null;
            // Read Again needs the switch for what it would do: text, or a scan first and then text.
            const readingOn = data.aiFeatures?.ai_document_reading.available !== false;
            const couldReadAgain =
              !binned &&
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
              safetyTone: badge.tone,
              processingLabel: processingKey ? t(processingKey) : NOT_YET_CHECKED,
              previewAllowed: previewable,
              // The Manage menu, at Browse depth; absent (the row exactly as before) until the
              // lifecycle tables exist and a lane has registered an action this document allows.
              ...(actionsFor(doc.id).length > 0
                ? {
                    manage: (
                      <div>
                        <ManageMenu
                          applicantId={id}
                          documentId={doc.id}
                          documentName={doc.approvedName ?? doc.originalName}
                          actions={actionsFor(doc.id)}
                          {...(data.lifecycle?.copyPeople.length
                            ? { copyPeople: data.lifecycle.copyPeople }
                            : {})}
                          {...(deepLinkAction && deepLinked === doc.id
                            ? { initialAction: deepLinkAction }
                            : {})}
                        />
                      </div>
                    ),
                  }
                : {}),
              stateWords,
              // Every sentence about this file that is not a fact or an action: one closed fold.
              aboutFile: (
                <>
                  <p className="muted">{badge.detail}</p>
                  {doc.source === CONVERTED_FROM_HEIC_SOURCE ? (
                    <p className="muted">
                      Saved as a JPG copy of the iPhone photo (HEIC) that was uploaded, so it opens
                      anywhere. The HEIC file itself was not kept.
                    </p>
                  ) : null}
                  {doc.processingStatus &&
                  PROBLEM_NEXT_STEP[doc.processingStatus] &&
                  !(doc.latestVersionId && data.reading?.states.has(doc.latestVersionId)) ? (
                    <p className="muted">
                      {PROBLEM_NEXT_STEP[doc.processingStatus]}
                      {doc.processingStatus === 'FAILED' ? (
                        <>
                          {' '}
                          Still failing? <Link href="/app/help#contact">Get Help</Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="field-hint" id={`date-hint-${doc.id}`}>
                    Used to judge freshness for routes that require recently-dated evidence.
                  </p>
                </>
              ),
              details: (
                <div key={doc.id}>
                  <div
                    className="wallet-document-actions"
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
                  >
                    <ReferenceCode
                      code={data.referenceCodes.get(doc.id)}
                      label="Document Reference"
                    />
                    <div className="row">
                      <span
                        className="row-key"
                        data-value="name"
                        style={{ wordBreak: 'break-word' }}
                      >
                        {doc.approvedName ?? doc.originalName}
                      </span>
                      <span className="row-end">
                        <span className={`badge ${badge.badgeClass}`}>{badge.label}</span>
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
                    <p className="muted u-fs-075-m0">{shortScanLine(badge.kind)}</p>
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
                    !binned &&
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
                      <p className="muted u-fs-075-m0">
                        {PROBLEM_NEXT_STEP_SHORT[doc.processingStatus]}
                      </p>
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
                    {suggestion && !binned ? (
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
                      // Lane Z review: a file in Recently Deleted or being removed offers no
                      // findings to save (the server refuses them too).
                      const proposalsForDoc = binned
                        ? []
                        : data.pendingProposals.filter(
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
                      // Lane Z: a file in Recently Deleted or being removed is never read again.
                      if (
                        binned ||
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
                      if (
                        binned ||
                        !data.inconsistencyConfigured ||
                        !data.aiGranted ||
                        !doc.classification
                      ) {
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
        <details className="docs-about">
          <summary>About Documents</summary>
          <p>
            Keep reusable evidence together. Processing, review and expiry are separate signals.
          </p>
          {anyProcessing ? (
            <p className="muted">
              Some documents are still being checked, which can take a few minutes. This page
              updates by itself, so there is no need to upload them again.
            </p>
          ) : null}
        </details>
      </DepthScope>
      {/* On a phone, adding a file is always one tap away; larger screens have the button in the header. The spacer keeps the end of the page clear of it. */}
      <div className="docs-add-fab-space" aria-hidden="true" />
      <Link className="docs-add-fab" href={addDocumentsHref} aria-label="Add Documents">
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span aria-hidden="true">Add</span>
      </Link>
    </>
  );
}
