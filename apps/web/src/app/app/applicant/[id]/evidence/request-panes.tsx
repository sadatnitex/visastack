import { randomBytes } from 'node:crypto';
import {
  type DocumentSummary,
  type EvidenceRequest,
  REQUEST_QUESTION_LIMIT,
  REQUEST_QUESTION_MAX_LENGTH,
  type RequestItemExtras,
} from '@visastack/services';
import Link from 'next/link';
import { atLevel } from '../../../../../components/depth';
import type { PaneEntry } from '../../../../../components/list-pattern';
import { ReferenceCode } from '../../../../../components/reference-code';
import { RequestThread } from '../../../../../components/request-thread/request-thread';
import { buildThread } from '../../../../../components/request-thread/thread-model';
import { StatusPill } from '../../../../../components/ui-lift';
import { formatDateOnly } from '../../../../../lib/format-date';
import { formatMoment } from '../../../../../lib/save-status';
import { AnswerReceipt } from './answer-receipt';
import { AskAboutItemForm } from './ask-about-item-form';
import type { ChoiceBasis } from './choice-basis';
import { ClearerCopyPanel } from './clearer-copy-panel';
import { AWAITING_SUBMISSION, dueLabel } from './due-label';
import type { RequestItemView } from './request-item';
import { ANSWERED_STATUSES, requestChip, requestName } from './request-model';
import type { RequestHistory } from './request-thread-data';
import { buildDocumentChoices, clearerCopyTarget } from './response-choices';
import { SubmitResponseForm } from './submit-response-form';

/** One request as the panes need it. */
export interface RequestEntry {
  readonly req: EvidenceRequest;
  readonly item: RequestItemView;
}

/** What the panes read beyond the requests themselves (the rows read none of it). */
export interface RequestPanesProps {
  readonly applicantId: string;
  readonly timeZone: string;
  readonly entries: readonly RequestEntry[];
  readonly referenceCodes: ReadonlyMap<string, string>;
  readonly profile: readonly {
    readonly factId: string;
    readonly fieldKey: string;
    readonly value: string | null;
  }[];
  readonly documents: readonly DocumentSummary[];
  readonly documentsRead: boolean;
  readonly extras: RequestItemExtras;
  readonly choiceBasis: ChoiceBasis;
  readonly histories: ReadonlyMap<string, RequestHistory>;
  /** The request just answered, named by the address (`done=answered`); its panel shows the receipt. */
  readonly answeredId?: string;
}

function RequestPane({ entry, ...data }: { readonly entry: RequestEntry } & RequestPanesProps) {
  const { req, item } = entry;
  const { applicantId: id, timeZone, choiceBasis } = data;
  const awaitingReply = AWAITING_SUBMISSION.has(req.status);
  // The file sent could not be used: its guidance and the question box are the way forward.
  const unusableFile = !awaitingReply && item.group === 'NEEDS_CORRECTION';
  const itemName = requestName(req);
  const candidateFacts =
    req.kind === 'FIELD'
      ? data.profile.filter((fact) => fact.fieldKey === req.fieldKey && fact.value !== null)
      : [];
  // Only a request still waiting on the person offers copies to send.
  const documentChoices =
    req.kind === 'DOCUMENT' && awaitingReply
      ? buildDocumentChoices({
          documents: data.documents,
          docType: req.docType ?? null,
          everyday: choiceBasis.everyday,
          scan: choiceBasis.scan,
          timeZone,
          sentBackDocumentId: req.status === 'NEEDS_REPLACEMENT' ? req.respondingDocumentId : null,
        })
      : [];
  const sentBackCopy =
    req.status === 'NEEDS_REPLACEMENT' ? clearerCopyTarget(documentChoices) : null;
  const otherCopyUsable = documentChoices.some((choice) => choice.usable && !choice.sentBack);
  const due = req.dueDate ? dueLabel(req.dueDate, req.status, timeZone) : null;
  const code = data.referenceCodes.get(req.id);
  const questions = data.extras.questions.get(req.id) ?? [];
  const canAsk = Boolean(req.missionId && code && item.group !== null);
  const chip = requestChip(item);
  const history = data.histories.get(req.id);
  const thread = buildThread({
    viewer: 'traveller',
    request: {
      kind: req.kind,
      status: req.status,
      message: req.message,
      createdAt: req.createdAt,
      respondedAt: req.respondedAt,
    },
    group: item.group,
    decisions: history?.decisions ?? { state: 'none' },
    sends: history?.sends ?? { state: 'none' },
  });
  return (
    <div className="lp-pane-content rt-pane">
      <h3 className="lp-pane-title">{itemName}</h3>
      <p className="lp-pane-line">
        {due ? <StatusPill tone={due.tone}>{due.label}</StatusPill> : null}
        <StatusPill tone={chip.tone}>{chip.word}</StatusPill>
      </p>
      {req.dueDate ? (
        <p className="case-row-meta">Needed by {formatDateOnly(req.dueDate)}</p>
      ) : null}
      {item.rule ? <p className="case-row-meta">{item.rule}</p> : null}
      {data.answeredId === req.id && req.respondedAt && req.status === 'RECEIVED' ? (
        <AnswerReceipt
          applicantId={id}
          itemName={itemName}
          respondedAt={new Date(req.respondedAt).toISOString()}
          timeZone={timeZone}
          {...(code ? { referenceCode: code } : {})}
        />
      ) : null}
      {code ? <ReferenceCode code={code} label="Request Reference" /> : null}
      <p className="case-row-meta">{item.guidance}</p>
      {req.respondedAt && ANSWERED_STATUSES.has(req.status) ? (
        <p className="case-row-meta">You sent this on {formatMoment(req.respondedAt, timeZone)}.</p>
      ) : null}
      <RequestThread thread={thread} viewer="traveller" timeZone={timeZone} />
      {item.group !== null ? (
        <SubmitResponseForm
          // A new round (the status or the answer changed) or a changed list of copies starts
          // the form afresh, with its own retry key.
          key={`${req.id}:${req.status}:${req.respondedAt ? new Date(req.respondedAt).getTime() : 0}:${documentChoices.map((choice) => choice.documentId).join(',')}`}
          applicantId={id}
          requestId={req.id}
          kind={req.kind}
          awaiting={awaitingReply}
          timeZone={timeZone}
          itemLabel={itemName}
          idempotencyKey={randomBytes(18).toString('base64url')}
          exactCopies={choiceBasis.exactCopies}
          documentsRead={data.documentsRead && choiceBasis.read}
          candidateFacts={candidateFacts.map((f) => ({ factId: f.factId, value: f.value ?? '' }))}
          documentChoices={documentChoices}
        />
      ) : null}
      {awaitingReply && req.kind === 'DOCUMENT' && req.status === 'NEEDS_REPLACEMENT' ? (
        sentBackCopy ? (
          <ClearerCopyPanel
            applicantId={id}
            requestId={req.id}
            documentId={sentBackCopy.documentId}
            documentName={sentBackCopy.name}
            primary={!otherCopyUsable}
          />
        ) : !otherCopyUsable && data.documentsRead && choiceBasis.read ? (
          <Link
            className="btn btn-primary evidence-add-link"
            href={`/app/applicant/${id}/documents/add`}
          >
            Add Documents
            <span className="sr-only">: {itemName}</span>
          </Link>
        ) : null
      ) : null}
      {questions.length > 0 ? (
        <div className="request-questions lc-questions">
          <p className="request-questions-title lc-questions-title u-m-0">Your Questions</p>
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
            <Link href={`/app/mission/${req.missionId}#notes`} className="request-questions-link">
              Read Replies in the Case Notes
              <span className="sr-only">: {itemName}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
      {canAsk && req.missionId ? (
        questions.length >= REQUEST_QUESTION_LIMIT ? (
          <p className="case-row-meta" {...(unusableFile ? {} : atLevel('everything'))}>
            You have asked several questions about this item. The agency answers in the case notes.
          </p>
        ) : (
          <details className="request-ask lc-ask" {...(unusableFile ? {} : atLevel('everything'))}>
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
}

/** One panel per request, in list order, for the list to open (`ListWithPane`). */
export function requestPanes(props: RequestPanesProps): PaneEntry[] {
  return props.entries.map((entry) => ({
    id: entry.req.id,
    title: requestName(entry.req),
    content: <RequestPane entry={entry} {...props} />,
  }));
}
