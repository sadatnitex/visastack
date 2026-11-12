'use client';

import type { CatalogKey } from '@visastack/i18n';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useId, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../../components/form-feedback';
import { useT } from '../../../../../../components/i18n-provider';
import { Icon } from '../../../../../../components/icons';
import { AboutDisclosure } from '../../../../../../components/ui-lift';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import type { PartsTranslator } from '../../../../../../lib/language-parts';
import { SAVING_TEXT, saveResult } from '../../../../../../lib/save-status';
import { type AnswerActionState, confirmAnswersAction } from './actions';
import type { AnswerCopyView, AnswerItemView, AnswerReviewView } from './answer-view';

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

/**
 * The review step for one agency: everything it waits for that can be answered from saved records,
 * grouped by how sure the plan is, and one button that sends exactly what is ticked.
 *
 * Anticipate, never decide: a copy that fits and has nothing uncertain about it is ticked at first;
 * a choice between several copies starts on "Do Not Send Now"; a copy whose date cannot be worked
 * out starts unticked. Nothing leaves without the one button. The agency is named on the button
 * itself, and the exact versions the person saw are the ones posted.
 *
 * The confirmation key is made on the server and kept for the life of this form, so pressing Send
 * twice answers with the first send instead of making a second. A page whose plan changed
 * is given a new `key` by its parent, which starts this form afresh with a new confirmation key.
 */
export function AnswerSetForm({
  applicantId,
  organizationId,
  agencyName,
  confirmationKey,
  review,
  timeZone = null,
}: {
  readonly applicantId: string;
  readonly organizationId: string;
  readonly agencyName: string;
  /** Made on the server for this render (24 random characters); never made in the browser. */
  readonly confirmationKey: string;
  readonly review: AnswerReviewView;
  /** The traveller's own time zone, for the "Saved at" time. */
  readonly timeZone?: string | null;
}) {
  const t = useT(evidenceAnswerCatalog);
  const router = useRouter();
  const [key] = useState(confirmationKey);
  const [state, formAction, pending] = useActionState(
    async (previous: AnswerActionState, formData: FormData): Promise<AnswerActionState> => {
      const next = await confirmAnswersAction(previous, formData);
      if (next.ok && next.sent > 0) {
        // Best effort: the answers are already sent, so a failure to move the address must never
        // turn that into an error on screen. The page then reads the receipt for this key.
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('agency', organizationId);
          url.searchParams.set('done', key);
          router.replace(`${url.pathname}${url.search}`, { scroll: false });
        } catch {
          // The page still refreshes and shows what is left.
        }
      }
      return next;
    },
    INITIAL,
  );

  // Ticks for the copies that are the only fit (ready, or date to check); a pick per request where
  // several copies fit. The ready ones start ticked; nothing else starts chosen.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(review.ready.map((item) => item.requestId)),
  );
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const baseId = useId();

  const answers: { readonly requestId: string; readonly value: string }[] = [];
  for (const item of [...review.ready, ...review.choose]) {
    const only = item.copies[0];
    if (item.readiness === 'CHOOSE') {
      const copy = item.copies.find((candidate) => candidate.versionId === picked[item.requestId]);
      if (copy) {
        answers.push({
          requestId: item.requestId,
          value: `${item.requestId}|${copy.documentId}|${copy.versionId}`,
        });
      }
    } else if (only && ticked.has(item.requestId)) {
      answers.push({
        requestId: item.requestId,
        value: `${item.requestId}|${only.documentId}|${only.versionId}`,
      });
    }
  }
  const count = answers.length;
  const result = saveResult(state, timeZone);
  // A success here can only be about the send that just happened: it is shown once, with its time.
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
    `/app/applicant/${applicantId}/evidence?item=${requestId}#request-${requestId}`;
  const otherKinds = [...new Set(review.other.map((item) => item.readiness))];

  return (
    <form action={formAction} className="request-response answer-set-form">
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
              const nameId = `${baseId}-n-${item.requestId}`;
              const detailId = `${baseId}-d-${item.requestId}`;
              return (
                <label key={item.requestId} className="request-choice evidence-pick lc-choice">
                  <input
                    type="checkbox"
                    checked={ticked.has(item.requestId)}
                    onChange={(event) => toggle(item.requestId, event.target.checked)}
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
              const nameId = `${baseId}-n-${item.requestId}`;
              const detailId = `${baseId}-d-${item.requestId}`;
              return (
                <div key={item.requestId} className="request-choices">
                  <label className="request-choice evidence-pick lc-choice">
                    <input
                      type="checkbox"
                      checked={ticked.has(item.requestId)}
                      onChange={(event) => toggle(item.requestId, event.target.checked)}
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
                  const detailId = `${baseId}-d-${copy.versionId}`;
                  return (
                    <label key={copy.versionId} className="request-choice evidence-pick lc-choice">
                      <input
                        type="radio"
                        name={group}
                        checked={chosen === copy.versionId}
                        onChange={() =>
                          setPicked((current) => ({ ...current, [item.requestId]: copy.versionId }))
                        }
                        aria-describedby={detailId}
                      />
                      <span className="lc-pick-icon" aria-hidden="true">
                        <Icon name="file" size={20} />
                      </span>
                      <span className="evidence-pick-text">
                        <span className="evidence-pick-name">{copy.name}</span>
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
              const [short] = OTHER_WORDS[otherReadiness(item)];
              return (
                <div key={item.requestId} className="row">
                  <div className="answer-other-text">
                    <span className="row-key">{item.name}</span>
                    <p className="muted u-fs-085 u-m-0">{t.node(short)}</p>
                  </div>
                  <div className="request-response-actions">
                    {item.readiness === 'MISSING' ? (
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
          unavailable={count === 0}
          idle={state.ok ? sendLabel : t('evidenceAnswer.form.tryAgain')}
          busy={t('evidenceAnswer.form.sending')}
          className="btn btn-primary"
        />
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

/** A request outside this step is one of the six kinds the plan can name for it. */
function kindOf(readiness: AnswerItemView['readiness']): keyof typeof OTHER_WORDS {
  return readiness in OTHER_WORDS ? (readiness as keyof typeof OTHER_WORDS) : 'OWN_STEP';
}

function otherReadiness(item: AnswerItemView): keyof typeof OTHER_WORDS {
  return kindOf(item.readiness);
}
