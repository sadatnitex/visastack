import { type MessageKey, type Translator, createTranslator } from '@visastack/i18n';
import {
  type DocumentLifecycleStatus,
  classifyExpiry,
  getApplicantEvidenceBytes,
  getLatestOcrRun,
  getWalletView,
  hasConsent,
  isServableProcessingState,
  listDocumentsDetailed,
  listIssuerVerificationsForDocument,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  loadUploadQuotaConfig,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  createAiExtractor,
  isClassificationConfigured,
  isInconsistencyConfigured,
  isOcrConfigured,
} from '../../../../../lib/ai';
import { getLocale } from '../../../../../lib/locale';
import { withSession } from '../../../../../lib/session';
import { previewDocumentAction, setDocumentDateAction } from '../actions';
import {
  AiProposalReview,
  DocumentTypeProposalReview,
  InconsistencyFlagReview,
  OcrResultView,
  RunAiExtractionButton,
  RunClassificationButton,
  RunInconsistencyCheckButton,
  RunOcrButton,
} from '../ai-review';
import { DocumentUploader } from '../document-uploader';
import { NameReview } from '../name-review';
import { UsageMeter } from '../usage-meter';

export const metadata: Metadata = { title: 'Documents' };

export const dynamic = 'force-dynamic';

/** Real pipeline states (never fake progress — master directive §7 "PR 7"). */
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
  CURRENT: { label: 'Current', tone: 'badge-success' },
  EXPIRING: { label: 'Expiring soon', tone: 'badge-warning' },
  EXPIRED: { label: 'Expired', tone: 'badge-danger' },
  SUPERSEDED: { label: 'Superseded', tone: 'badge-neutral' },
};

export default async function ApplicantDocumentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ readonly preview_error?: string; readonly date_error?: string }>;
}) {
  const { id } = await params;
  const { preview_error: previewError, date_error: dateError } = await searchParams;
  const locale = await getLocale();
  const t = createTranslator(locale);

  const data = await withSession(async ({ db, accountId }) => {
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
    return {
      documents: documentRows,
      coreGranted,
      aiGranted,
      aiConfigured: Boolean(createAiExtractor()),
      ocrGranted,
      ocrConfigured,
      classificationConfigured,
      inconsistencyConfigured,
      evidenceBytes,
      pendingProposals,
      pendingClassificationProposals,
      pendingInconsistencyFlags,
      quota: loadUploadQuotaConfig(),
      wallet: new Map((wallet.ok ? wallet.value : []).map((w) => [w.document.id, w])),
      issuerVerifications,
      ocrRuns,
    };
  });

  return (
    <>
      {previewError ? (
        <p className="notice notice-warn" role="alert" style={{ marginBottom: '1.5rem' }}>
          Couldn't open that preview - the document may no longer be available. Please try again.
        </p>
      ) : null}

      {dateError ? (
        <p className="notice notice-warn" role="alert" style={{ marginBottom: '1.5rem' }}>
          Couldn't save that date - enter a valid date that isn't in the future.
        </p>
      ) : null}

      {/*
       * Only upload and new processing/extraction are gated on core
       * processing consent — existing documents must remain viewable
       * regardless (docs/audits/post-programme-defect-register.md finding
       * #23): "view existing data" and "permit new processing" are
       * deliberately distinct here.
       */}
      {!data.coreGranted ? (
        <article className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="card-body">
            Grant <strong>Core processing</strong> consent from <Link href="/app">Home</Link> to
            upload new documents or run processing. Your existing documents remain visible below.
          </p>
        </article>
      ) : (
        <>
          {data.aiConfigured && !data.aiGranted ? (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-body">
                Grant <strong>AI extraction</strong> consent from <Link href="/app">Home</Link> to
                get automatic field suggestions from your documents — every suggestion still
                requires your explicit approval before it changes your profile.
              </p>
            </div>
          ) : null}

          {data.ocrConfigured && !data.ocrGranted ? (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-body">
                Grant <strong>AI OCR</strong> consent from <Link href="/app">Home</Link> to read
                text from scanned or photographed documents - this sends the document's image, a
                larger disclosure than AI extraction's text-only sharing.
              </p>
            </div>
          ) : null}

          <article className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="card-kicker">Upload</p>
            <h2 className="card-title">Add a document</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Documents are stored privately and pass a structural safety scan before they can be
              previewed.
            </p>
            <div style={{ marginBottom: '1.25rem' }}>
              <UsageMeter
                label="Evidence storage"
                usedBytes={data.evidenceBytes}
                limitBytes={data.quota.maxApplicantEvidenceBytes}
              />
            </div>
            <DocumentUploader applicantId={id} />
          </article>
        </>
      )}

      <article className="card">
        <p className="card-kicker">Document Vault</p>
        <h2 className="card-title">{data.documents.length} document(s)</h2>
        {data.documents.length === 0 ? (
          <p className="muted">No documents yet.</p>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {data.documents.map((doc) => {
              const badge = safetyBadge(doc.safetyStatus ?? 'PENDING', t);
              const processingKey = doc.processingStatus
                ? PROCESSING_STATE_KEYS[doc.processingStatus]
                : undefined;
              const previewable =
                doc.safetyStatus === 'CLEAN' &&
                doc.processingStatus !== null &&
                isServableProcessingState(doc.processingStatus);
              return (
                <div
                  key={doc.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
                >
                  <div className="row">
                    <span className="row-key" style={{ wordBreak: 'break-word' }}>
                      {doc.approvedName ?? doc.originalName}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
                            style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
                          >
                            Preview
                          </button>
                        </form>
                      ) : null}
                    </span>
                  </div>
                  {(() => {
                    const wallet = data.wallet.get(doc.id);
                    if (
                      !wallet ||
                      (wallet.usedInMissions.length === 0 && wallet.accessibleTo.length === 0)
                    ) {
                      return null;
                    }
                    return (
                      <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
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
                    <label
                      className="muted"
                      style={{ fontSize: '0.75rem' }}
                      htmlFor={`date-${doc.id}`}
                    >
                      Document date
                    </label>
                    <input
                      id={`date-${doc.id}`}
                      name="documentDate"
                      type="date"
                      defaultValue={doc.documentDate ?? ''}
                      max={new Date().toISOString().slice(0, 10)}
                      className="input"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}
                    />
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Save
                    </button>
                    <span className="muted" style={{ fontSize: '0.7rem' }}>
                      Used to judge freshness for routes that require recently-dated evidence.
                    </span>
                  </form>
                  {(() => {
                    const confirmations = data.issuerVerifications.get(doc.id) ?? [];
                    if (confirmations.length === 0) return null;
                    return (
                      <details style={{ fontSize: '0.75rem' }}>
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
                                until {c.validUntil.toLocaleDateString()}
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
                    <p className="muted" style={{ fontSize: '0.75rem' }}>
                      Automatic classification needs review — not confident enough to propose a
                      name.
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
                        {/* New AI extraction is new processing — blocked without core
                            processing consent, even though existing proposals below
                            (already-completed processing output) remain reviewable
                            (finding #23). */}
                        {data.coreGranted ? (
                          <RunAiExtractionButton applicantId={id} documentVersionId={versionId} />
                        ) : null}
                        {proposalsForDoc.map(({ proposal, evidence }) => (
                          <AiProposalReview
                            key={proposal.id}
                            applicantId={id}
                            canApprove={data.coreGranted}
                            proposal={{
                              id: proposal.id,
                              type: proposal.type,
                              fieldKey: proposal.fieldKey,
                              value: proposal.value,
                              confidence: proposal.confidence,
                              rationale: proposal.rationale,
                              evidence: evidence.map((e) => ({
                                snippet: e.snippet,
                                verified: e.verified,
                              })),
                            }}
                          />
                        ))}
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
              );
            })}
          </div>
        )}
      </article>
    </>
  );
}
