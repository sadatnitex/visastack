import {
  type EvidenceRequestDecision,
  getApplicant,
  listApplicantProfile,
  listDocumentsDetailed,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForApplicant,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader, StatusBadge, type Tone } from '../../../../../components/ui';
import { humanizeCode } from '../../../../../lib/format-code';
import { daysUntilDateOnly, formatDateOnly } from '../../../../../lib/format-date';
import { PROFILE_FIELDS } from '../../../../../lib/profile-fields';
import { withSession } from '../../../../../lib/session';
import { SubmitResponseForm } from './submit-response-form';

export const metadata: Metadata = { title: 'Evidence' };

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

/** What happens next, for each state, in words the person who was asked can act on. */
const NEXT_HINT: Record<string, string> = {
  OPEN: 'Next: send a document or detail from your wallet, or add a new one.',
  RECEIVED: 'Sent. The agency will review it. Nothing more is needed from you yet.',
  UNDER_REVIEW: 'The agency is reviewing what you sent. Nothing more is needed from you yet.',
  ACCEPTED: 'Accepted. Nothing more is needed.',
  NEEDS_REPLACEMENT: 'Next: send a replacement. The reason is shown below.',
  CANCELLED: 'The agency cancelled this request. Nothing is needed.',
};

/** The deadline as a status: overdue is serious, due within a week is a warning, later is calm. */
function dueLabel(
  dueDate: string | Date,
  status: string,
): { readonly label: string; readonly tone: Tone } | null {
  if (!AWAITING_SUBMISSION.has(status)) return null;
  const days = daysUntilDateOnly(dueDate);
  if (days < 0) return { label: `Overdue by ${plural(-days, 'day')}`, tone: 'danger' };
  if (days === 0) return { label: 'Due today', tone: 'warning' };
  if (days <= 7) return { label: `Due in ${plural(days, 'day')}`, tone: 'warning' };
  return { label: `Due in ${plural(days, 'day')}`, tone: 'neutral' };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A person-readable name for what is being asked for, never the stored key. */
function requestTarget(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  if (req.kind === 'FIELD') {
    const field = PROFILE_FIELDS.find((f) => f.key === req.fieldKey);
    return field?.label ?? (req.fieldKey ? humanizeCode(req.fieldKey) : 'Not specified');
  }
  return req.docType ? humanizeCode(req.docType) : 'Not specified';
}

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

  const sorted = [...data.requests].sort((x, y) => {
    const waiting = (r: { status: string }) => (AWAITING_SUBMISSION.has(r.status) ? 0 : 1);
    if (waiting(x) !== waiting(y)) return waiting(x) - waiting(y);
    // Soonest deadline first; no deadline last.
    const dx = x.dueDate ? new Date(x.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const dy = y.dueDate ? new Date(y.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return dx - dy;
  });
  const awaiting = data.requests.filter((r) => AWAITING_SUBMISSION.has(r.status));

  return (
    <>
      <PageHeader
        eyebrow="Evidence requests"
        title="Requests from agencies"
        description="An agency request is that organisation asking you for something, never an official visa requirement on its own. You decide what to submit, and can reuse anything already in your wallet."
        as="h2"
      />

      {awaiting.length > 0 ? (
        <output className="notice notice-warn" style={{ display: 'block', marginBottom: '1.5rem' }}>
          {awaiting.length === 1
            ? '1 request is waiting for you.'
            : `${awaiting.length} requests are waiting for you.`}{' '}
          Reply to each one below.
        </output>
      ) : null}

      <article className="card">
        {data.requests.length === 0 ? (
          <EmptyState title="No evidence requests">
            When an agency asks for a document or a detail, it appears here with what is needed,
            why, and the date it is needed by.
          </EmptyState>
        ) : (
          <div className="rows">
            {sorted.map((req) => {
              const badge = STATUS_BADGE[req.status] ?? {
                label: humanizeCode(req.status),
                tone: 'badge-neutral',
              };
              const target = requestTarget(req);
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
              const due = req.dueDate ? dueLabel(req.dueDate, req.status) : null;
              return (
                <div className="case-row" key={req.id}>
                  <div className="case-row-head">
                    <span className="case-row-title">
                      {req.kind === 'FIELD' ? 'Detail' : 'Document'}: {target}
                    </span>
                    <span className="case-row-badges">
                      {due ? <StatusBadge tone={due.tone}>{due.label}</StatusBadge> : null}
                      <StatusBadge tone={badge.tone.replace('badge-', '') as Tone}>
                        {badge.label}
                      </StatusBadge>
                    </span>
                  </div>
                  <p className="case-row-meta" style={{ margin: 0 }}>
                    {req.message
                      ? `Why it is needed: \u201c${req.message}\u201d`
                      : 'The agency did not add a reason. Ask them if you are unsure.'}
                  </p>
                  {req.dueDate ? (
                    <p className="case-row-meta" style={{ margin: 0 }}>
                      Needed by {formatDateOnly(req.dueDate)}
                    </p>
                  ) : null}
                  <p className="case-row-meta" style={{ margin: 0 }}>
                    {NEXT_HINT[req.status] ?? ''}
                  </p>
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
