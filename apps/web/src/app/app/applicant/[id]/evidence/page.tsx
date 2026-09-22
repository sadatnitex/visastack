import {
  type EvidenceRequestDecision,
  getApplicant,
  listApplicantProfile,
  listDocumentsDetailed,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForApplicant,
} from '@visastack/services';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { SubmitResponseForm } from './submit-response-form';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  RECEIVED: { label: 'Submitted', tone: 'badge-neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'badge-neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'badge-success' },
  NEEDS_REPLACEMENT: { label: 'Needs replacement', tone: 'badge-warning' },
  CANCELLED: { label: 'Cancelled', tone: 'badge-neutral' },
  // Legacy statuses: no longer written by new requests, but a request
  // created before Commercial V1 Part 4 §10's state model may still hold one.
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

const AWAITING_SUBMISSION = new Set(['OPEN', 'NEEDS_REPLACEMENT']);

/** Commercial V1 Part 4 §13: the applicant sees which of the four review outcomes a decision was, not just a generic rejection. */
const DECISION_PREFIX: Record<string, string> = {
  NEEDS_REPLACEMENT: 'Replacement needed: ',
  CONTRADICTION: 'Contradicts your profile: ',
  CORRECTION_PROPOSED: 'Suggested correction: ',
};

export default async function EvidencePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [requests, profile, documents] = await Promise.all([
      listEvidenceRequestsForApplicant(db, accountId, id),
      listApplicantProfile(db, id),
      listDocumentsDetailed(db, accountId, id),
    ]);
    const requestList = requests.ok ? requests.value : [];
    const decisionsByRequest = new Map<string, readonly EvidenceRequestDecision[]>();
    for (const req of requestList) {
      if (AWAITING_SUBMISSION.has(req.status)) continue; // nothing decided yet
      const decisions = await listEvidenceRequestDecisions(db, accountId, req.id);
      if (decisions.ok) decisionsByRequest.set(req.id, decisions.value);
    }
    return {
      applicant,
      requests: requestList,
      profile,
      documents: documents.ok ? documents.value : [],
      decisionsByRequest,
    };
  });

  if (!data) notFound();

  return (
    <>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Evidence requests</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Requests from agencies
          </h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            An agency request is that organisation asking you for something, never an official visa
            requirement on its own. You decide what to submit, and can reuse anything already in
            your wallet.
          </p>
        </div>
      </div>

      <article className="card">
        {data.requests.length === 0 ? (
          <p className="card-body">
            No evidence requests. When an agency asks for something, it appears here.
          </p>
        ) : (
          <div className="rows">
            {data.requests.map((req) => {
              const badge = STATUS_BADGE[req.status] ?? {
                label: req.status,
                tone: 'badge-neutral',
              };
              const target = req.kind === 'FIELD' ? req.fieldKey : req.docType;
              const decisions = data.decisionsByRequest.get(req.id) ?? [];
              const latestDecision = decisions[0];
              const candidateFacts =
                req.kind === 'FIELD'
                  ? data.profile.filter(
                      (entry) => entry.fieldKey === req.fieldKey && entry.value !== null,
                    )
                  : [];
              const candidateDocuments =
                req.kind === 'DOCUMENT'
                  ? data.documents.filter((doc) => doc.docType === req.docType)
                  : [];
              return (
                <div
                  className="row"
                  key={req.id}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <span className="row-key">
                      {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target ?? '(unspecified)'}
                      <span
                        className="badge badge-neutral"
                        style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}
                      >
                        Agency request
                      </span>
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                  {req.message ? (
                    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                      &ldquo;{req.message}&rdquo;
                    </p>
                  ) : null}
                  {req.dueDate ? (
                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      Due {new Date(req.dueDate).toLocaleDateString()}
                    </p>
                  ) : null}
                  {latestDecision?.reason ? (
                    <p className="field-msg field-msg-err" style={{ margin: 0 }}>
                      {DECISION_PREFIX[latestDecision.outcome] ?? ''}
                      {latestDecision.reason}
                    </p>
                  ) : null}
                  {AWAITING_SUBMISSION.has(req.status) ? (
                    <SubmitResponseForm
                      applicantId={id}
                      requestId={req.id}
                      kind={req.kind}
                      candidateFacts={candidateFacts.map((f) => ({
                        factId: f.factId,
                        value: f.value ?? '',
                      }))}
                      candidateDocuments={candidateDocuments.map((d) => ({
                        documentId: d.id,
                        displayName: d.approvedName ?? d.originalName,
                        usable: d.safetyStatus === 'CLEAN' && d.processingStatus !== 'FAILED',
                        statusLabel:
                          d.safetyStatus === 'CLEAN'
                            ? (d.processingStatus ?? 'PROCESSING')
                            : (d.safetyStatus ?? 'PROCESSING'),
                      }))}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </>
  );
}
