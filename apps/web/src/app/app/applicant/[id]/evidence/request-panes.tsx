import { randomBytes } from 'node:crypto';
import type { Locale } from '@visastack/i18n';
import {
  type DocumentSummary,
  type EvidenceRequest,
  REQUEST_QUESTION_LIMIT,
  REQUEST_QUESTION_MAX_LENGTH,
  type RequestItemExtras,
} from '@visastack/services';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { atLevel } from '../../../../../components/depth';
import type { PaneEntry } from '../../../../../components/list-pattern';
import { ReferenceCode } from '../../../../../components/reference-code';
import { RequestThread } from '../../../../../components/request-thread/request-thread';
import { buildThread } from '../../../../../components/request-thread/thread-model';
import { StatusPill } from '../../../../../components/ui-lift';
import { applicantEvidenceCatalog } from '../../../../../i18n/applicant-evidence';
import { type ChangeImpactKey, changeImpactCatalog } from '../../../../../i18n/change-impact';
import { evidenceAnswerCatalog } from '../../../../../i18n/evidence-answer';
import { formatDateOnly } from '../../../../../lib/format-date';
import { getServerT } from '../../../../../lib/i18n-server';
import { formatMoment } from '../../../../../lib/save-status';
import { changeImpactHref } from '../change-impact/impact-words';
import { AnswerReceipt } from './answer-receipt';
import { AskAboutItemForm } from './ask-about-item-form';
import type { ChoiceBasis } from './choice-basis';
import { ClearerCopyPanel } from './clearer-copy-panel';
import { AWAITING_SUBMISSION, dueLabel } from './due-label';
import type { RequestItemView } from './request-item';
import { ANSWERED_STATUSES, requestChip, requestName } from './request-model';
import type { RequestHistory } from './request-thread-data';
import { buildDocumentChoices, clearerCopyTarget, isCurrentCopy } from './response-choices';
import type { SentBackRead } from './sent-back-copy';
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
  /**
   * The name of each agency that asks, by organization id, so a request can say who asked. Left out
   * when the names are not known: the panel then shows no such line.
   */
  readonly askingAgencies?: ReadonlyMap<string, string>;
  /** The page's language, for dates in the copy notes; English when left out. */
  readonly locale?: Locale;
}

/** How long after an answer its receipt may be drawn: it is for the visit that sent it, not for a bookmark. */
const RECEIPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * The receipt after an answer (F2), or null: only when the address names this request, it holds an
 * answer saved a few minutes ago, and it is in a state that says it was received. The honest line
 * follows the state, so it never says "not yet reviewed" once the agency has started or finished.
 */
export function answerReceiptFor(
  req: Pick<EvidenceRequest, 'id' | 'status' | 'respondedAt'>,
  answeredId: string | undefined,
  now: number = Date.now(),
): { readonly respondedAt: string; readonly honestLine: string | null } | null {
  if (answeredId !== req.id || !req.respondedAt) return null;
  const at = new Date(req.respondedAt).getTime();
  if (Number.isNaN(at) || now - at > RECEIPT_WINDOW_MS || at - now > RECEIPT_WINDOW_MS) return null;
  const honestLine =
    req.status === 'RECEIVED'
      ? 'Received, not yet reviewed.'
      : req.status === 'UNDER_REVIEW'
        ? 'Received. The agency has started reviewing it.'
        : req.status === 'ACCEPTED'
          ? null
          : undefined;
  if (honestLine === undefined) return null;
  return { respondedAt: new Date(at).toISOString(), honestLine };
}

/**
 * What the traveller sent in answer to a detail request, round by round, newest first: the exact
 * saved value and version, where it stands, and whether the detail has changed since. An answer
 * sent before the exact value was kept says so in words; it is never filled in with the detail as
 * it is now. A protected detail is named by version only.
 */
function FieldAnswerSent({
  read,
  answerT,
  timeZone,
  impactHref,
  impactT,
}: {
  /** The review of this detail's latest change, when the request names the detail it answers with. */
  readonly impactHref: string | null;
  readonly impactT: ReturnType<typeof getServerT<ChangeImpactKey>>;
  readonly read: RequestHistory['fieldAnswer'];
  readonly answerT: ReturnType<
    typeof getServerT<keyof (typeof evidenceAnswerCatalog)['en'] & string>
  >;
  readonly timeZone: string;
}) {
  if (read.state === 'none') return null;
  if (read.state === 'unread') {
    return (
      <p className="case-row-meta" data-testid="field-answer-sent">
        {answerT.node('evidenceAnswer.fieldAnswer.unread')}
      </p>
    );
  }
  const rounds = [...read.value.rounds].reverse().slice(0, 3);
  if (rounds.length === 0) return null;
  // One link is enough: it goes on the newest answer whose detail has changed since.
  const changedRound = rounds.find((round) => round.version && !round.version.stillCurrent);
  const stateWord = (state: (typeof rounds)[number]['state']) =>
    state === 'ACCEPTED'
      ? answerT.node('evidenceAnswer.fieldAnswer.accepted')
      : state === 'AWAITING_DECISION'
        ? answerT.node('evidenceAnswer.fieldAnswer.waiting')
        : state === 'WITHDRAWN'
          ? answerT.node('evidenceAnswer.fieldAnswer.withdrawn')
          : answerT.node('evidenceAnswer.fieldAnswer.sentBack');
  return (
    <div className="request-questions lc-questions" data-testid="field-answer-sent">
      <p className="request-questions-title u-m-0">
        {answerT.node('evidenceAnswer.fieldAnswer.title')}
      </p>
      <ul className="request-questions-list">
        {rounds.map((round) => (
          <li
            key={round.submissionId ?? `legacy-${round.state}-${round.decidedAt?.getTime() ?? 0}`}
          >
            <span className="case-row-meta">{stateWord(round.state)}</span>{' '}
            {round.version ? (
              <span>
                {round.version.protected
                  ? answerT.node('evidenceAnswer.fieldAnswer.protected', {
                      version: round.version.number,
                      savedAt: formatMoment(round.version.savedAt.toISOString(), timeZone),
                    })
                  : answerT.node('evidenceAnswer.fieldAnswer.pinned', {
                      version: round.version.number,
                      savedAt: formatMoment(round.version.savedAt.toISOString(), timeZone),
                      value: round.version.value ?? '',
                    })}
                {round.version.stillCurrent ? null : (
                  <> {answerT.node('evidenceAnswer.fieldAnswer.changedSince')}</>
                )}
                {impactHref && round === changedRound ? (
                  <>
                    {' '}
                    <Link className="ci-step" href={impactHref}>
                      {impactT.node('changeImpact.review.title')}
                    </Link>
                  </>
                ) : null}
              </span>
            ) : (
              <span>{answerT.node('evidenceAnswer.fieldAnswer.legacy')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one plain line naming the copy sent back and why, or the plain admission that it is not known. */
function sentBackNoteFor(
  read: SentBackRead,
  answerT: ReturnType<typeof getServerT<keyof (typeof evidenceAnswerCatalog)['en'] & string>>,
  documents: readonly DocumentSummary[],
  timeZone: string,
): ReactNode {
  if (read.state === 'none') return null;
  if (read.state === 'unknown') return answerT.node('evidenceAnswer.sentBack.unknown');
  const { copy } = read;
  const named = documents.find((doc) => doc.id.toLowerCase() === copy.documentId.toLowerCase());
  const name =
    copy.title ??
    named?.approvedName ??
    named?.originalName ??
    answerT('evidenceAnswer.sentBack.thisDocument');
  const line =
    copy.precision === 'exact' && copy.versionNumber !== null && copy.sentAt
      ? answerT.node('evidenceAnswer.sentBack.exact', {
          name,
          version: copy.versionNumber,
          date: formatMoment(copy.sentAt.toISOString(), timeZone),
        })
      : answerT.node('evidenceAnswer.sentBack.document', { name });
  return line;
}

function RequestPane({ entry, ...data }: { readonly entry: RequestEntry } & RequestPanesProps) {
  const t = getServerT(applicantEvidenceCatalog);
  const answerT = getServerT(evidenceAnswerCatalog);
  const { req, item } = entry;
  const { applicantId: id, timeZone, choiceBasis } = data;
  const awaitingReply = AWAITING_SUBMISSION.has(req.status);
  // The file sent could not be used: its guidance and the question box are the way forward.
  const unusableFile = !awaitingReply && item.group === 'NEEDS_CORRECTION';
  const itemName = requestName(req);
  const history = data.histories.get(req.id);
  // Which copy was sent back comes from the decision history: the request's own answer pointer is
  // cleared by a send-back. If the history is missing, the page says it does not know.
  const sentBackRead: SentBackRead =
    history?.sentBack ??
    (req.status === 'NEEDS_REPLACEMENT' ? { state: 'unknown' } : { state: 'none' });
  const sentBackInfo = sentBackRead.state === 'copy' ? sentBackRead.copy : null;
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
          sentBackDocumentId: sentBackInfo?.documentId ?? null,
          sentBackVersionId: sentBackInfo?.versionId ?? null,
          locale: data.locale ?? 'en',
          words: {
            expires: (date) => answerT('evidenceAnswer.choices.expires', { date }),
            expired: (date) => answerT('evidenceAnswer.choices.expired', { date }),
            uncertain: answerT('evidenceAnswer.choices.uncertain'),
          },
        })
      : [];
  const sentBackCopy =
    req.status === 'NEEDS_REPLACEMENT' ? clearerCopyTarget(documentChoices) : null;
  // A copy the person can rely on: sendable, not sent back, not out of date, date not in doubt.
  const otherCopyUsable = documentChoices.some(isCurrentCopy);
  // Copies exist and can be sent, but every one is out of date or of an uncertain date.
  const onlyOutdatedCopies =
    !otherCopyUsable && documentChoices.some((choice) => choice.usable && !choice.sentBack);
  const sentBackNote = sentBackNoteFor(sentBackRead, answerT, data.documents, timeZone);
  const due = req.dueDate ? dueLabel(req.dueDate, req.status, timeZone) : null;
  const code = data.referenceCodes.get(req.id);
  const askedBy = data.askingAgencies?.get(req.organizationId);
  const receipt = answerReceiptFor(req, data.answeredId);
  const questions = data.extras.questions.get(req.id) ?? [];
  const canAsk = Boolean(req.missionId && code && item.group !== null);
  const chip = requestChip(item);
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
      {askedBy ? (
        <p className="case-row-meta">
          {answerT.node('evidenceAnswer.panes.askedBy', { agency: askedBy })}
        </p>
      ) : null}
      <p className="lp-pane-line">
        {due ? <StatusPill tone={due.tone}>{due.label}</StatusPill> : null}
        <StatusPill tone={chip.tone}>{chip.word}</StatusPill>
      </p>
      {req.dueDate ? (
        <p className="case-row-meta">
          {t.node('applicantEvidence.appApplicantIdEvidenceRequestPanes.neededByFormatdateonly', {
            formatDateOnly: formatDateOnly(req.dueDate),
          })}
        </p>
      ) : null}
      {item.rule ? <p className="case-row-meta">{item.rule}</p> : null}
      {receipt ? (
        <AnswerReceipt
          applicantId={id}
          itemName={itemName}
          respondedAt={receipt.respondedAt}
          timeZone={timeZone}
          {...(receipt.honestLine ? { honestLine: receipt.honestLine } : {})}
          {...(code ? { referenceCode: code } : {})}
        />
      ) : code ? (
        <ReferenceCode
          code={code}
          label={t('applicantEvidence.appApplicantIdEvidenceRequestPanes.requestReference')}
        />
      ) : null}
      <p className="case-row-meta">{item.guidance}</p>
      {req.respondedAt && ANSWERED_STATUSES.has(req.status) ? (
        <p className="case-row-meta">
          {t.node(
            'applicantEvidence.appApplicantIdEvidenceRequestPanes.youSentThisOnFormatmoment',
            {
              formatMoment: formatMoment(req.respondedAt, timeZone),
            },
          )}
        </p>
      ) : null}
      <RequestThread thread={thread} viewer="traveller" timeZone={timeZone} />
      {req.kind === 'FIELD' && history ? (
        <FieldAnswerSent
          read={history.fieldAnswer}
          answerT={answerT}
          timeZone={timeZone}
          impactT={getServerT(changeImpactCatalog)}
          impactHref={
            req.respondingFactId
              ? changeImpactHref(id, { kind: 'DETAIL', id: req.respondingFactId })
              : null
          }
        />
      ) : null}
      {awaitingReply && req.kind === 'DOCUMENT' && sentBackNote ? (
        <p className="case-row-meta" data-testid="sent-back-note">
          {sentBackNote}
        </p>
      ) : null}
      {awaitingReply && req.kind === 'DOCUMENT' && !sentBackNote && onlyOutdatedCopies ? (
        <p className="case-row-meta" data-testid="no-current-copy-note">
          {answerT.node('evidenceAnswer.choices.noCurrent')}
        </p>
      ) : null}
      {item.group !== null ? (
        <SubmitResponseForm
          // A new round (the status or the answer changed) or a changed list of copies starts
          // the form afresh, with its own retry key.
          key={`${req.id}:${req.status}:${req.respondedAt ? new Date(req.respondedAt).getTime() : 0}:${sentBackRead.state}:${sentBackInfo?.versionId ?? ''}:${documentChoices.map((choice) => `${choice.documentId}/${choice.versionId}`).join(',')}`}
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
          preselect={sentBackRead.state !== 'unknown'}
        />
      ) : null}
      {awaitingReply && req.kind === 'DOCUMENT' ? (
        sentBackCopy ? (
          <ClearerCopyPanel
            applicantId={id}
            requestId={req.id}
            documentId={sentBackCopy.documentId}
            documentName={sentBackCopy.name}
            primary={!otherCopyUsable}
          />
        ) : !otherCopyUsable &&
          data.documentsRead &&
          choiceBasis.read &&
          (req.status === 'NEEDS_REPLACEMENT' || documentChoices.length > 0) ? (
          <Link
            className="btn btn-primary evidence-add-link"
            href={`/app/applicant/${id}/documents/add`}
          >
            {t.node('applicantEvidence.appApplicantIdEvidenceRequestPanes.addDocuments')}
            <span className="sr-only">: {itemName}</span>
          </Link>
        ) : null
      ) : null}
      {questions.length > 0 ? (
        <div className="request-questions lc-questions">
          <p className="request-questions-title lc-questions-title u-m-0">
            {t.node('applicantEvidence.appApplicantIdEvidenceRequestPanes.yourQuestions')}
          </p>
          <ul className="request-questions-list">
            {questions.map((question) => (
              <li key={question.askedAt.toISOString()}>
                <span className="case-row-meta">
                  {t.node(
                    'applicantEvidence.appApplicantIdEvidenceRequestPanes.askedFormatmoment',
                    {
                      formatMoment: formatMoment(question.askedAt, timeZone),
                    },
                  )}
                </span>
                <span className="request-question-text">{question.text}</span>
              </li>
            ))}
          </ul>
          {req.missionId ? (
            <Link href={`/app/mission/${req.missionId}#notes`} className="request-questions-link">
              {t.node(
                'applicantEvidence.appApplicantIdEvidenceRequestPanes.readRepliesInTheCaseNotes',
              )}
              <span className="sr-only">: {itemName}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
      {canAsk && req.missionId ? (
        questions.length >= REQUEST_QUESTION_LIMIT ? (
          <p className="case-row-meta" {...(unusableFile ? {} : atLevel('everything'))}>
            {t.node(
              'applicantEvidence.appApplicantIdEvidenceRequestPanes.youHaveAskedSeveralQuestionsAbout',
            )}
          </p>
        ) : (
          <details className="request-ask lc-ask" {...(unusableFile ? {} : atLevel('everything'))}>
            <summary className="request-ask-toggle">
              {t.node(
                'applicantEvidence.appApplicantIdEvidenceRequestPanes.askTheAgencyAboutThisItem',
              )}
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
