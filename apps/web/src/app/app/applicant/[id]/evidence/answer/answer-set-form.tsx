'use client';

import type { CatalogKey } from '@visastack/i18n';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../../components/form-feedback';
import { useT } from '../../../../../../components/i18n-provider';
import { Icon } from '../../../../../../components/icons';
import { AboutDisclosure } from '../../../../../../components/ui-lift';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import type { PartsTranslator } from '../../../../../../lib/language-parts';
import { TRAVELLER_LIST_STEP } from '../../../../../../lib/paging';
import { SAVING_TEXT, saveResult } from '../../../../../../lib/save-status';
import { type AnswerActionState, confirmAnswersAction } from './actions';
import {
  ANSWER_LIMIT,
  type AnswerCopyView,
  type AnswerItemView,
  type AnswerReviewView,
} from './answer-view';

const INITIAL: AnswerActionState = { ok: true, message: '', sent: 0, changed: 0 };

type Translate = PartsTranslator<CatalogKey<typeof evidenceAnswerCatalog>>;

/** The short line and the fuller words for each kind of request that is not part of this step. */
const OTHER_WORDS = {
  OUTDATED: ['evidenceAnswer.form.otherOutdatedShort', 'evidenceAnswer.form.otherOutdatedLong'],
  NEEDS_NEW_COPY: [
    'evidenceAnswer.form.otherNeedsNewCopyShort',
    'evidenceAnswer.form.otherNeedsNewCopyLong',
  ],
  NOT_CHECKED: [
    'evidenceAnswer.form.otherNotCheckedShort',
    'evidenceAnswer.form.otherNotCheckedLong',
  ],
  MISSING: ['evidenceAnswer.form.otherMissingShort', 'evidenceAnswer.form.otherMissingLong'],
  OWN_STEP: ['evidenceAnswer.form.otherOwnStepShort', 'evidenceAnswer.form.otherOwnStepLong'],
  NO_ACCESS: ['evidenceAnswer.form.otherNoAccessShort', 'evidenceAnswer.form.otherNoAccessLong'],
} as const;

/** The kinds of request the person can fix by adding a document, so they get the link. */
const ADD_DOCUMENTS_KINDS: ReadonlySet<AnswerItemView['readiness']> = new Set([
  'MISSING',
  'NEEDS_NEW_COPY',
  'NOT_CHECKED',
]);

/**
 * The Requests page lists waiting requests first, ten at a time. `show` asks for enough to include
 * every waiting request, so the one opened from here is on the page; ten or fewer need no `show`.
 */
function showPart(waitingTotal: number): string {
  if (waitingTotal <= TRAVELLER_LIST_STEP) return '';
  const shown = Math.ceil(waitingTotal / TRAVELLER_LIST_STEP) * TRAVELLER_LIST_STEP;
  return `show=${shown}&`;
}

/** What one copy says about itself: its facts, then anything the person should weigh. */
function CopyDetails({
  copy,
  id,
  t,
  withName,
}: {
  readonly copy: AnswerCopyView;
  readonly id: string;
  readonly t: Translate;
  /** The file name, when the copy's own name is not already the label above it. */
  readonly withName: boolean;
}) {
  return (
    <span className="evidence-pick-text" id={id}>
      {withName ? <span className="evidence-pick-meta">{copy.name}</span> : null}
      <span className="evidence-pick-meta">
        {t.node('evidenceAnswer.form.version', { number: copy.versionNumber })}
        {' · '}
        {t.node('evidenceAnswer.form.added', { when: copy.addedLabel })}
        {' · '}
        {copy.expiresLabel
          ? t.node('evidenceAnswer.form.expires', { date: copy.expiresLabel })
          : t.node('evidenceAnswer.form.noExpiry')}
        {copy.documentDateLabel ? (
          <>
            {' · '}
            {t.node('evidenceAnswer.form.documentDate', { date: copy.documentDateLabel })}
          </>
        ) : null}
      </span>
      {copy.uncertainty ? (
        <span className="evidence-pick-meta">
          {copy.uncertainty.kind === 'age'
            ? t.node('evidenceAnswer.form.uncertainAge', { days: copy.uncertainty.days })
            : t.node('evidenceAnswer.form.uncertainDisagree')}
        </span>
      ) : null}
      {copy.acceptedBefore ? (
        <span className="evidence-pick-meta">
          {copy.acceptedBefore.byAgency
            ? t.node('evidenceAnswer.form.acceptedBefore', { agency: copy.acceptedBefore.byAgency })
            : t.node('evidenceAnswer.form.acceptedBeforeUnknown')}
        </span>
      ) : null}
    </span>
  );
}

/** The request's own reference code and whether the checklist calls it optional. */
function ItemMeta({ item, t }: { readonly item: AnswerItemView; readonly t: Translate }) {
  if (!item.referenceCode && !item.optional) return null;
  return (
    <span className="evidence-pick-meta">
      {item.referenceCode
        ? t.node('evidenceAnswer.form.reference', { code: item.referenceCode })
        : null}
      {item.referenceCode && item.optional ? ' · ' : null}
      {item.optional ? t.node('evidenceAnswer.form.optional') : null}
    </span>
  );
}

/** One request with one copy that fits: a tick box over the request's name and the copy's facts. */
function SingleCopyChoice({
  item,
  copy,
  baseId,
  checked,
  onToggle,
  t,
}: {
  readonly item: AnswerItemView;
  readonly copy: AnswerCopyView;
  readonly baseId: string;
  readonly checked: boolean;
  readonly onToggle: (requestId: string, on: boolean) => void;
  readonly t: Translate;
}) {
  const nameId = `${baseId}-n-${item.requestId}`;
  const detailId = `${baseId}-d-${item.requestId}`;
  return (
    <label className="request-choice evidence-pick lc-choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(item.requestId, event.target.checked)}
        aria-labelledby={nameId}
        aria-describedby={detailId}
      />
      <span className="lc-pick-icon" aria-hidden="true">
        <Icon name="file" size={20} />
      </span>
      <span className="evidence-pick-text">
        <span className="evidence-pick-name" id={nameId}>
          {item.name}
        </span>
        <CopyDetails copy={copy} id={detailId} t={t} withName />
        <ItemMeta item={item} t={t} />
      </span>
    </label>
  );
}

/**
 * The review step for one agency: everything it waits for that can be answered from saved records,
 * grouped by how sure the plan is, and one button that sends exactly what is ticked.
 *
 * Anticipate, never decide: a copy that fits and has nothing uncertain about it is ticked at first;
 * a choice between several copies starts on "Do Not Send Now"; a copy whose date cannot be worked
 * out starts unticked. Nothing leaves without the one button. The agency is named on the button
 * itself, and the exact versions the person saw are the ones posted.
 *
 * This outer part owns the result of a send, so a message ("Nothing was sent...") survives the
 * list being rebuilt. The choices below it are keyed by `planKey`: a changed plan starts them
 * afresh (ticks, picks and a new confirmation key), while the message stays. The confirmation key
 * is kept for the life of one set of choices, so pressing Send twice answers with the first send
 * instead of making a second.
 */
export function AnswerSetForm({
  applicantId,
  organizationId,
  agencyName,
  confirmationKey,
  planKey,
  review,
  waitingTotal,
  timeZone = null,
}: {
  readonly applicantId: string;
  readonly organizationId: string;
  readonly agencyName: string;
  /** Made on the server for this render (24 random characters); never made in the browser. */
  readonly confirmationKey: string;
  /** Changes whenever the plan changes (see `answerPlanKey`); the choices start afresh with it. */
  readonly planKey: string;
  readonly review: AnswerReviewView;
  /** Every request waiting in the whole plan, so "Open This Request" lands on the Requests page with it listed. */
  readonly waitingTotal: number;
  /** The traveller's own time zone, for the "Saved at" time. */
  readonly timeZone?: string | null;
}) {
  const t = useT(evidenceAnswerCatalog);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (previous: AnswerActionState, formData: FormData): Promise<AnswerActionState> => {
      const next = await confirmAnswersAction(previous, formData);
      if (next.ok && next.sent > 0) {
        // Best effort: the answers are already sent, so a failure to move the address must never
        // turn that into an error on screen. The page then reads the receipt for this key.
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('agency', String(formData.get('organizationId') ?? organizationId));
          url.searchParams.set('done', String(formData.get('confirmationKey') ?? ''));
          router.replace(`${url.pathname}${url.search}`, { scroll: false });
        } catch {
          // The page still refreshes and shows what is left.
        }
      }
      return next;
    },
    INITIAL,
  );
  // A success here can only be about the send that just happened: it is shown once, with its time.
  const result = saveResult(state, timeZone);
  // After an answer comes back the list below may be rebuilt, which removes the button that was
  // pressed and would drop keyboard focus to the top of the page. Focus goes to the result
  // instead, so a keyboard or screen reader user stays where the outcome is said.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== INITIAL) resultRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="request-response answer-set-form">
      <AnswerChoices
        key={planKey}
        applicantId={applicantId}
        organizationId={organizationId}
        agencyName={agencyName}
        confirmationKey={confirmationKey}
        review={review}
        waitingTotal={waitingTotal}
        pending={pending}
      />
      <div ref={resultRef} tabIndex={-1} className="answer-result">
        <FormMessage
          result={state.ok && !state.savedAt ? NO_RESULT : result}
          pending={pending}
          pendingText={SAVING_TEXT}
        />
      </div>
      <p className="muted u-fs-085 u-m-0">
        {t.node('evidenceAnswer.form.consentShort', { agency: agencyName })}
      </p>
      <AboutDisclosure summary={t('evidenceAnswer.form.aboutSending')}>
        <p className="muted u-fs-085 u-m-0">{t.node('evidenceAnswer.form.aboutSendingBody')}</p>
      </AboutDisclosure>
    </form>
  );
}

/** What starts afresh whenever the plan changes: the kept key, the ticks and picks, and the groups. */
function AnswerChoices({
  applicantId,
  organizationId,
  agencyName,
  confirmationKey,
  review,
  waitingTotal,
  pending,
}: {
  readonly applicantId: string;
  readonly organizationId: string;
  readonly agencyName: string;
  readonly confirmationKey: string;
  readonly review: AnswerReviewView;
  readonly waitingTotal: number;
  readonly pending: boolean;
}) {
  const t = useT(evidenceAnswerCatalog);
  const [key] = useState(confirmationKey);
  // Ticks for the copies that are the only fit (ready, or date to check); a pick per request where
  // several copies fit. The ready ones start ticked; nothing else starts chosen.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(review.ready.map((item) => item.requestId)),
  );
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const baseId = useId();

  const answers: { readonly requestId: string; readonly value: string }[] = [];
  for (const item of [...review.ready, ...review.choose]) {
    const copy =
      item.readiness === 'CHOOSE'
        ? item.copies.find((candidate) => candidate.versionId === picked[item.requestId])
        : ticked.has(item.requestId)
          ? item.copies[0]
          : undefined;
    if (copy) {
      answers.push({
        requestId: item.requestId,
        value: `${item.requestId}|${copy.documentId}|${copy.versionId}`,
      });
    }
  }
  const count = answers.length;
  const overLimit = count > ANSWER_LIMIT;
  const sendLabel =
    count === 0
      ? t('evidenceAnswer.form.sendNone', { agency: agencyName })
      : t('evidenceAnswer.form.send', { count, agency: agencyName });
  const toggle = (requestId: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(requestId);
      else next.delete(requestId);
      return next;
    });
  const requestHref = (requestId: string) =>
    `/app/applicant/${applicantId}/evidence?${showPart(waitingTotal)}item=${requestId}#request-${requestId}`;
  const otherKinds = [...new Set(review.other.map((item) => item.readiness))];

  return (
    <>
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="confirmationKey" value={key} />
      {answers.map((answer) => (
        <input key={answer.requestId} type="hidden" name="answer" value={answer.value} />
      ))}

      {review.ready.length > 0 ? (
        <section className="answer-group" aria-labelledby={`${baseId}-ready`}>
          <h3 className="answer-group-title" id={`${baseId}-ready`}>
            {t.node('evidenceAnswer.form.groupReady')}
          </h3>
          <div className="request-choices">
            {review.ready.map((item) => {
              const copy = item.copies[0];
              if (!copy) return null;
              return (
                <SingleCopyChoice
                  key={item.requestId}
                  item={item}
                  copy={copy}
                  baseId={baseId}
                  checked={ticked.has(item.requestId)}
                  onToggle={toggle}
                  t={t}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {review.choose.length > 0 ? (
        <section className="answer-group" aria-labelledby={`${baseId}-choose`}>
          <h3 className="answer-group-title" id={`${baseId}-choose`}>
            {t.node('evidenceAnswer.form.groupChoose')}
          </h3>
          {review.choose.map((item) => {
            if (item.readiness === 'CHECK_DATE') {
              const copy = item.copies[0];
              if (!copy) return null;
              return (
                <div key={item.requestId} className="request-choices">
                  <SingleCopyChoice
                    item={item}
                    copy={copy}
                    baseId={baseId}
                    checked={ticked.has(item.requestId)}
                    onToggle={toggle}
                    t={t}
                  />
                </div>
              );
            }
            const group = `${baseId}-g-${item.requestId}`;
            const chosen = picked[item.requestId] ?? '';
            return (
              <fieldset key={item.requestId} className="request-choices answer-choose">
                <legend className="evidence-pick-legend lc-pick-legend">{item.name}</legend>
                <ItemMeta item={item} t={t} />
                <label className="request-choice evidence-pick lc-choice">
                  <input
                    type="radio"
                    name={group}
                    checked={chosen === ''}
                    onChange={() => setPicked((current) => ({ ...current, [item.requestId]: '' }))}
                  />
                  <span className="evidence-pick-text">
                    <span className="evidence-pick-name">
                      {t.node('evidenceAnswer.form.doNotSend')}
                    </span>
                  </span>
                </label>
                {item.copies.map((copy) => {
                  const detailId = `${baseId}-d-${item.requestId}-${copy.versionId}`;
                  const copyNameId = `${baseId}-c-${item.requestId}-${copy.versionId}`;
                  return (
                    <label key={copy.versionId} className="request-choice evidence-pick lc-choice">
                      <input
                        type="radio"
                        name={group}
                        checked={chosen === copy.versionId}
                        onChange={() =>
                          setPicked((current) => ({ ...current, [item.requestId]: copy.versionId }))
                        }
                        // The file name is the name; its facts are the description, said once.
                        aria-labelledby={copyNameId}
                        aria-describedby={detailId}
                      />
                      <span className="lc-pick-icon" aria-hidden="true">
                        <Icon name="file" size={20} />
                      </span>
                      <span className="evidence-pick-text">
                        <span className="evidence-pick-name" id={copyNameId}>
                          {copy.name}
                        </span>
                        <CopyDetails copy={copy} id={detailId} t={t} withName={false} />
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
        </section>
      ) : null}

      {review.other.length > 0 ? (
        <section className="answer-group" aria-labelledby={`${baseId}-other`}>
          <h3 className="answer-group-title" id={`${baseId}-other`}>
            {t.node('evidenceAnswer.form.groupOther')}
          </h3>
          <div className="rows">
            {review.other.map((item) => {
              const [short] = OTHER_WORDS[kindOf(item.readiness)];
              return (
                <div key={item.requestId} className="row">
                  <div className="answer-other-text">
                    <span className="row-key">{item.name}</span>
                    <p className="muted u-fs-085 u-m-0">{t.node(short)}</p>
                  </div>
                  <div className="request-response-actions">
                    {ADD_DOCUMENTS_KINDS.has(item.readiness) ? (
                      <Link
                        className="btn btn-secondary"
                        href={`/app/applicant/${applicantId}/documents/add`}
                      >
                        {t.node('evidenceAnswer.form.addDocuments')}
                        <span className="sr-only">: {item.name}</span>
                      </Link>
                    ) : null}
                    <Link className="btn btn-secondary" href={requestHref(item.requestId)}>
                      {t.node('evidenceAnswer.form.openRequest')}
                      <span className="sr-only">: {item.name}</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <AboutDisclosure summary={t('evidenceAnswer.form.aboutOther')}>
            {otherKinds.map((kind) => {
              const [, long] = OTHER_WORDS[kindOf(kind)];
              return (
                <p key={kind} className="muted u-fs-085">
                  {t.node(long)}
                </p>
              );
            })}
          </AboutDisclosure>
        </section>
      ) : null}

      <div className="request-response-actions answer-send">
        <SubmitButton
          pending={pending}
          unavailable={count === 0 || overLimit}
          idle={sendLabel}
          busy={t('evidenceAnswer.form.sending')}
          className="btn btn-primary"
        />
      </div>
      {overLimit ? (
        <output className="muted u-fs-085 u-m-0">
          {t.node('evidenceAnswer.form.overLimit', { limit: ANSWER_LIMIT })}
        </output>
      ) : count === 0 ? (
        // Why the button is not available yet, in words and not only by its look.
        <output className="muted u-fs-085 u-m-0">
          {t.node('evidenceAnswer.form.sendNoneHint')}
        </output>
      ) : null}
    </>
  );
}

/** A request outside this step is one of the six kinds the plan can name for it. */
function kindOf(readiness: AnswerItemView['readiness']): keyof typeof OTHER_WORDS {
  return readiness in OTHER_WORDS ? (readiness as keyof typeof OTHER_WORDS) : 'OWN_STEP';
}
