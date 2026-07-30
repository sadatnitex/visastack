import {
  getApplicant,
  getApplicantEvidenceBytes,
  hasConsent,
  listApplicantProfile,
  listDocumentsDetailed,
  listPendingProposals,
  loadUploadQuotaConfig,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAiExtractor } from '../../../../lib/ai';
import { withSession } from '../../../../lib/session';
import { previewDocumentAction } from './actions';
import { AiProposalReview, RunAiExtractionButton } from './ai-review';
import { DocumentUploader } from './document-uploader';
import { NameReview } from './name-review';
import { ProfileEditor } from './profile-editor';
import { UsageMeter } from './usage-meter';

export const dynamic = 'force-dynamic';

const RELATIONSHIP_LABELS: Record<string, string> = {
  SELF: 'Myself',
  FAMILY_MEMBER: 'Family member',
  MINOR_GUARDIAN: 'Minor (guardian)',
};

const SAFETY_BADGE: Record<string, { label: string; tone: string }> = {
  CLEAN: { label: 'Clean', tone: 'badge-success' },
  QUARANTINED: { label: 'Quarantined', tone: 'badge-danger' },
  SCANNING: { label: 'Scanning', tone: 'badge-neutral' },
  PENDING: { label: 'Pending', tone: 'badge-neutral' },
};

export default async function ApplicantPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ readonly preview_error?: string }>;
}) {
  const { id } = await params;
  const { preview_error: previewError } = await searchParams;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [profile, documents, coreGranted, aiGranted, evidenceBytes, pendingProposals] =
      await Promise.all([
        listApplicantProfile(db, id),
        listDocumentsDetailed(db, accountId, id),
        hasConsent(db, accountId, 'CORE_PROCESSING'),
        hasConsent(db, accountId, 'AI_EXTRACTION'),
        getApplicantEvidenceBytes(db, id),
        listPendingProposals(db, id),
      ]);
    return {
      applicant,
      profile,
      documents: documents.ok ? documents.value : [],
      coreGranted,
      aiGranted,
      aiConfigured: Boolean(createAiExtractor()),
      evidenceBytes,
      pendingProposals,
      quota: loadUploadQuotaConfig(),
    };
  });

  if (!data) notFound();

  const values: Record<string, { value: string | null; status: string | null }> = {};
  const repeatingValues: Record<
    string,
    Record<string, { value: string | null; status: string | null }>
  > = {};
  for (const entry of data.profile) {
    if (entry.repeatingRecordKey === null) {
      values[entry.fieldKey] = { value: entry.value, status: entry.status };
    } else {
      const byRecord = repeatingValues[entry.fieldKey] ?? {};
      byRecord[entry.repeatingRecordKey] = { value: entry.value, status: entry.status };
      repeatingValues[entry.fieldKey] = byRecord;
    }
  }

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Workspace
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Applicant</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.applicant.displayName}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {RELATIONSHIP_LABELS[data.applicant.relationship] ?? data.applicant.relationship}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link href={`/app/applicant/${id}/missions`} className="btn btn-secondary">
            Missions
          </Link>
          <Link href={`/app/applicant/${id}/history`} className="btn btn-secondary">
            History
          </Link>
          <Link href={`/app/applicant/${id}/evidence`} className="btn btn-secondary">
            Evidence
          </Link>
          <Link href={`/app/applicant/${id}/sharing`} className="btn btn-secondary">
            Sharing
          </Link>
        </div>
      </div>

      {previewError ? (
        <p className="notice notice-warn" role="alert" style={{ marginBottom: '1.5rem' }}>
          Couldn't open that preview — the document may no longer be available. Please try again.
        </p>
      ) : null}

      {!data.coreGranted ? (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <p className="card-body">
            Grant <strong>Core processing</strong> consent from your{' '}
            <Link href="/app">workspace</Link> to edit this profile and upload documents.
          </p>
        </div>
      ) : null}

      {data.aiConfigured && data.coreGranted && !data.aiGranted ? (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <p className="card-body">
            Grant <strong>AI extraction</strong> consent from your{' '}
            <Link href="/app">workspace</Link> to get automatic field suggestions from your
            documents — every suggestion still requires your explicit approval before it changes
            your profile.
          </p>
        </div>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Master Profile</p>
          <h2 className="card-title">Structured facts</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Every save appends an immutable, provenance-tracked version — earlier values are never
            overwritten.
          </p>
          {data.coreGranted ? (
            <ProfileEditor applicantId={id} values={values} repeatingValues={repeatingValues} />
          ) : (
            <p className="muted">Consent required.</p>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Document Vault</p>
          <h2 className="card-title">Uploads &amp; safety</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Documents are stored privately and pass a structural safety scan before they can be
            previewed.
          </p>

          {data.documents.length === 0 ? (
            <p className="muted" style={{ marginBottom: '1.25rem' }}>
              No documents yet.
            </p>
          ) : (
            <div className="rows" style={{ marginBottom: '1.5rem' }}>
              {data.documents.map((doc) => {
                const badge = SAFETY_BADGE[doc.safetyStatus ?? 'PENDING'] ?? {
                  label: doc.safetyStatus ?? 'Pending',
                  tone: 'badge-neutral',
                };
                const previewable = doc.safetyStatus === 'CLEAN';
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
                          <RunAiExtractionButton applicantId={id} documentVersionId={versionId} />
                          {proposalsForDoc.map(({ proposal, evidence }) => (
                            <AiProposalReview
                              key={proposal.id}
                              applicantId={id}
                              proposal={{
                                id: proposal.id,
                                type: proposal.type,
                                fieldKey: proposal.fieldKey,
                                value: proposal.value,
                                confidence: proposal.confidence,
                                rationale: proposal.rationale,
                                evidenceSnippets: evidence.map((e) => e.snippet),
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

          {data.coreGranted ? (
            <>
              <div style={{ marginBottom: '1.25rem' }}>
                <UsageMeter
                  label="Evidence storage"
                  usedBytes={data.evidenceBytes}
                  limitBytes={data.quota.maxApplicantEvidenceBytes}
                />
              </div>
              <DocumentUploader applicantId={id} />
            </>
          ) : (
            <p className="muted">Consent required.</p>
          )}
        </article>
      </div>
    </section>
  );
}
