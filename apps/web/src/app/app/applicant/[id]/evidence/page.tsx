import {
  type DocumentSummary,
  type EvidenceRequest,
  type EvidenceRequestDecision,
  REQUEST_QUESTION_LIMIT,
  REQUEST_QUESTION_MAX_LENGTH,
  type RequestItemExtras,
  type TriageDocumentState,
  accountPrincipal,
  getApplicant,
  listApplicantProfile,
  listDocumentsDetailed,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForApplicant,
  listRequestItemExtras,
  referenceCodesFor,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { ReferenceCode } from '../../../../../components/reference-code';
import { ShowMore } from '../../../../../components/show-more';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatDateOnly } from '../../../../../lib/format-date';
import { fieldLabel } from '../../../../../lib/master-profile';
import { TRAVELLER_LIST_STEP, nextShow, parseShow } from '../../../../../lib/paging';
import { formatMoment } from '../../../../../lib/save-status';
import { withSession } from '../../../../../lib/session';
import { AskAboutItemForm } from './ask-about-item-form';
import { AWAITING_SUBMISSION, dueLabel } from './due-label';
import { requestItemView } from './request-item';
import { SubmitResponseForm } from './submit-response-form';

export const metadata: Metadata = { title: 'Evidence Requests' };

export const dynamic = 'force-dynamic';

/** Statuses where the traveller's answer is on the request and the date it was sent is worth showing. */
const ANSWERED_STATUSES: ReadonlySet<string> = new Set(['RECEIVED', 'UNDER_REVIEW', 'ACCEPTED']);

/**
 * The responding document's latest state, for the Processing and Needs Correction groups. `undefined`
 * when the documents could not be read (the request status alone then decides); `null` when the
 * request names no document, or it is gone, so what was sent can no longer be used.
 */
function respondingDocumentState(
  request: Pick<EvidenceRequest, 'kind' | 'respondingDocumentId'>,
  documents: readonly DocumentSummary[],
  documentsRead: boolean,
): TriageDocumentState | null | undefined {
  if (request.kind !== 'DOCUMENT' || !documentsRead) return undefined;
  const found = request.respondingDocumentId
    ? documents.find((doc) => doc.id === request.respondingDocumentId)
    : undefined;
  if (!found?.latestVersionId || !found.processingStatus || !found.safetyStatus) return null;
  return { processingStatus: found.processingStatus, safetyStatus: found.safetyStatus };
}

/** A person-readable name for what is being asked for, never the stored key. */
function requestTarget(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  if (req.kind === 'FIELD') {
    const label = req.fieldKey ? fieldLabel(req.fieldKey) : undefined;
    return label ?? (req.fieldKey ? humanizeCode(req.fieldKey) : 'Not specified');
  }
  return req.docType ? humanizeCode(req.docType) : 'Not specified';
}

/** Commercial V1 Part 4 §13: the applicant sees which of the four review outcomes a decision was, not just a generic rejection. */
const DECISION_PREFIX: Record<string, string> = {
  NEEDS_REPLACEMENT: 'Replacement needed: ',
  CONTRADICTION: 'Contradicts your profile: ',
  CORRECTION_PROPOSED: 'Suggested correction: ',
};

/** The address parameter for how many requests show. */
const SHOW_KEY = 'show';
const REQUEST_NOUN = { one: 'request', other: 'requests' } as const;

export default async function EvidencePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  /** `show`: how many requests to list (WP-SB3: 10, then 10 more with each Show More). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const requestsShown = parseShow(search[SHOW_KEY], { step: TRAVELLER_LIST_STEP });

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [requests, profile, documents] = await Promise.all([
      listEvidenceRequestsForApplicant(db, accountId, id, { limit: requestsShown }),
      listApplicantProfile(db, id),
      listDocumentsDetailed(db, accountId, id),
    ]);
    const requestList = requests.ok ? requests.value.items : [];
    const decisionsByRequest = new Map<string, readonly EvidenceRequestDecision[]>();
    for (const req of requestList) {
      // Only a request sent back for a fix has a reason the person still needs to read. An earlier
      // reason on one that was answered again, or accepted since, would contradict its status.
      if (req.status !== 'NEEDS_REPLACEMENT') continue;
      const decisions = await listEvidenceRequestDecisions(db, accountId, req.id);
      if (decisions.ok) decisionsByRequest.set(req.id, decisions.value);
    }
    // Visible request codes (ADR 0018), so the traveller and the agency can name the same request.
    const referenceCodes = await referenceCodesFor(
      db,
      'R',
      requestList.map((req) => req.id),
    );
    // What each checklist item says about its evidence, and the person's own questions. Read through
    // the central gate as the owner; if that fails the page simply shows neither.
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    const listedExtras = access.ok
      ? await listRequestItemExtras(access.value, referenceCodes)
      : null;
    const extras: RequestItemExtras = listedExtras?.ok
      ? listedExtras.value
      : { rules: new Map(), questions: new Map() };
    return {
      applicant,
      referenceCodes,
      requests: requestList,
      requestsRead: requests.ok,
      requestCounts: requests.ok ? requests.value.counts : { total: 0, awaiting: 0 },
      moreRequests: requests.ok && requests.value.more,
      profile,
      documents: documents.ok ? documents.value : [],
      documentsRead: documents.ok,
      decisionsByRequest,
      extras,
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
  // Counted over every request, not only the ones on this page.
  const awaitingCount = data.requestCounts.awaiting;
  // Show More adds nothing visible at Glance once every waiting request is on the page.
  const moreAtGlance =
    awaitingCount > data.requests.filter((r) => AWAITING_SUBMISSION.has(r.status)).length;
  const requestsNext = data.moreRequests
    ? nextShow(data.requests.length, { step: TRAVELLER_LIST_STEP })
    : null;
  const timeZone = data.applicant.timezone;
  const depth = await readDepth('evidence-requests');
  const items = new Map(
    sorted.map((req) => [
      req.id,
      requestItemView({
        request: req,
        document: respondingDocumentState(req, data.documents, data.documentsRead),
        rule: data.extras.rules.get(req.id),
      }),
    ]),
  );
  // Glance is what needs the person: a request waiting on a reply, and a sent file that could
  // not be used (they ask the agency about it). Everything else starts at Browse.
  const needsPerson = (req: (typeof sorted)[number]) =>
    AWAITING_SUBMISSION.has(req.status) || items.get(req.id)?.group === 'NEEDS_CORRECTION';
  // With nothing for the person to do, the list itself starts at Browse: no empty card at Glance.
  // While more requests exist than this page shows, it never claims nothing is waiting.
  const nothingWaiting =
    data.requestCounts.total > 0 &&
    awaitingCount === 0 &&
    !data.moreRequests &&
    !data.requests.some(needsPerson);

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title="Evidence Requests"
        description="An agency request is that organisation asking you for something, never an official visa requirement on its own. You decide what to submit, and can reuse anything already in your wallet."
      />

      <DepthScope family="evidence-requests" depth={depth}>
        <DepthSwitch family="evidence-requests" initial={depth} copy={depthCopyFor('evidence')} />

        {nothingWaiting ? (
          <p className="muted" data-only="glance">
            Nothing is waiting for you.
          </p>
        ) : null}

        {awaitingCount > 0 ? (
          <output className="notice notice-warn request-waiting-notice">
            {awaitingCount === 1
              ? '1 request is waiting for you.'
              : `${awaitingCount} requests are waiting for you.`}{' '}
            Reply to each one below.
          </output>
        ) : null}

        <article className="card" {...(nothingWaiting ? atLevel('browse') : {})}>
          {!data.requestsRead ? (
            // A failed read never claims there are no requests: one may be waiting.
            <p className="notice notice-warn u-m-0" role="alert">
              Your requests could not be loaded. Refresh to try again.
            </p>
          ) : data.requestCounts.total === 0 ? (
            <EmptyState
              icon="clipboard"
              title="No Evidence Requests"
              why="You reply from your saved documents in one step, and you decide what to send."
              action={{ href: `/app/applicant/${id}/documents`, label: 'Open Documents' }}
            >
              This is where an agency asks you for a document or a detail. A request appears here
              with what is needed, why, and the date it is needed by. Keeping your documents up to
              date makes replying quick.
            </EmptyState>
          ) : (
            <>
              <div className="rows">
                {sorted.map((req, index) => {
                  const item =
                    items.get(req.id) ??
                    requestItemView({
                      request: req,
                      document: respondingDocumentState(req, data.documents, data.documentsRead),
                      rule: data.extras.rules.get(req.id),
                    });
                  const awaitingReply = AWAITING_SUBMISSION.has(req.status);
                  // The file sent could not be used: its guidance and the question box are the
                  // way forward, so they show with the request.
                  const unusableFile = !awaitingReply && item.group === 'NEEDS_CORRECTION';
                  const target = requestTarget(req);
                  const itemName = `${req.kind === 'FIELD' ? 'Detail' : 'Document'}: ${target}`;
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
                  const due = req.dueDate
                    ? dueLabel(req.dueDate, req.status, data.applicant.timezone)
                    : null;
                  const code = data.referenceCodes.get(req.id);
                  const questions = data.extras.questions.get(req.id) ?? [];
                  const canAsk = Boolean(req.missionId && code && item.group !== null);
                  return (
                    <div
                      className={`case-row request-item request-item-${item.tone}`}
                      key={req.id}
                      id={`request-${req.id}`}
                      {...(needsPerson(req) ? {} : atLevel('browse'))}
                    >
                      <div className="case-row-head">
                        <span className="case-row-title" id={`evidence-row-${index + 1}`}>
                          {req.kind === 'FIELD' ? 'Detail' : 'Document'}: {target}
                        </span>
                        <span className="case-row-badges">
                          {due ? <StatusBadge tone={due.tone}>{due.label}</StatusBadge> : null}
                          <StatusBadge tone={item.tone}>{item.statusLabel}</StatusBadge>
                        </span>
                      </div>
                      <p className="case-row-meta u-m-0">
                        {req.message
                          ? `Why it is needed: \u201c${req.message}\u201d`
                          : 'The agency did not add a reason. Ask them if you are unsure.'}
                      </p>
                      {req.dueDate ? (
                        <p className="case-row-meta u-m-0" {...atLevel('browse')}>
                          Needed by {formatDateOnly(req.dueDate)}
                        </p>
                      ) : null}
                      {item.rule ? (
                        <p className="case-row-meta u-m-0" {...atLevel('browse')}>
                          {item.rule}
                        </p>
                      ) : null}
                      {code ? (
                        <div className="depth-item" {...atLevel('browse')}>
                          <ReferenceCode code={code} label="Request Reference" />
                        </div>
                      ) : null}
                      <p
                        className="case-row-meta u-m-0"
                        {...(unusableFile ? {} : atLevel('browse'))}
                      >
                        {item.guidance}
                      </p>
                      {req.respondedAt && ANSWERED_STATUSES.has(req.status) ? (
                        <p className="case-row-meta u-m-0">
                          You sent this on {formatMoment(req.respondedAt, timeZone)}.
                        </p>
                      ) : null}
                      {latestDecision?.reason ? (
                        <p className="field-msg field-msg-err u-m-0">
                          {DECISION_PREFIX[latestDecision.outcome] ?? ''}
                          {latestDecision.reason}
                        </p>
                      ) : null}
                      {item.group !== null ? (
                        <SubmitResponseForm
                          applicantId={id}
                          requestId={req.id}
                          kind={req.kind}
                          awaiting={awaitingReply}
                          timeZone={timeZone}
                          itemLabel={itemName}
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
                      {questions.length > 0 ? (
                        <div className="request-questions" {...atLevel('browse')}>
                          <p className="request-questions-title u-m-0">Your Questions</p>
                          <ul className="request-questions-list">
                            {questions.map((question) => (
                              <li key={question.askedAt.toISOString()}>
                                <span className="case-row-meta">
                                  Asked {formatMoment(question.askedAt, timeZone)}
                                </span>
                                <span className="request-question-text">{question.text}</span>
                              </li>
                            ))}
                          </ul>
                          {req.missionId ? (
                            <Link
                              href={`/app/mission/${req.missionId}#notes`}
                              className="request-questions-link"
                            >
                              Read Replies in the Case Notes
                              <span className="sr-only">: {itemName}</span>
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                      {canAsk && req.missionId ? (
                        questions.length >= REQUEST_QUESTION_LIMIT ? (
                          <p
                            className="case-row-meta u-m-0"
                            {...(unusableFile ? {} : atLevel('everything'))}
                          >
                            You have asked several questions about this item. The agency answers in
                            the case notes.
                          </p>
                        ) : (
                          <details
                            className="request-ask"
                            {...(unusableFile ? {} : atLevel('everything'))}
                          >
                            <summary className="request-ask-toggle">
                              Ask the Agency About This Item
                              <span className="sr-only">: {itemName}</span>
                            </summary>
                            <AskAboutItemForm
                              applicantId={id}
                              missionId={req.missionId}
                              requestId={req.id}
                              maxLength={REQUEST_QUESTION_MAX_LENGTH}
                              timeZone={timeZone}
                              itemLabel={itemName}
                            />
                          </details>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div {...(moreAtGlance ? {} : atLevel('browse'))}>
                <ShowMore
                  id="evidence-requests-more"
                  pathname={`/app/applicant/${id}/evidence`}
                  searchParams={search}
                  next={requestsNext === null ? null : { [SHOW_KEY]: requestsNext }}
                  shown={data.requests.length}
                  total={data.requestCounts.total}
                  noun={REQUEST_NOUN}
                  landOn={`evidence-row-${data.requests.length + 1}`}
                />
              </div>
            </>
          )}
        </article>
      </DepthScope>
    </>
  );
}
