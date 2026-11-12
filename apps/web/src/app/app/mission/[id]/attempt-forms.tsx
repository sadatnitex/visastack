'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import {
  recordAttemptAction,
  recordAttemptEventAction,
  trackReportAsAttemptAction,
} from './attempt-actions';
import {
  ATTEMPT_CHANNEL_LABELS,
  ATTEMPT_DECISION_LABELS,
  ATTEMPT_EVENT_LABELS,
  AUTHORITY_SOURCE_LABELS,
} from './attempt-labels';

export interface AttemptChoice {
  readonly value: string;
  readonly label: string;
}

/** Turn one existing submission report into an attempt. */
export function TrackReportForm({
  missionId,
  missionSubmissionId,
  reportName,
}: {
  readonly missionId: string;
  readonly missionSubmissionId: string;
  /** Which report this is, so each button on the card says what it is for. */
  readonly reportName: string;
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    trackReportAsAttemptAction,
    NO_RESULT,
  );
  const messageId = `${useId()}-msg`;
  return (
    <form action={formAction} className="attempt-inline-form">
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="missionSubmissionId" value={missionSubmissionId} />
      <SubmitButton
        pending={pending}
        idle="Track as Attempt"
        busy="Saving…"
        className="btn btn-secondary btn-compact"
        label={t('appMission.appMissionIdAttemptForms.trackAsAttemptReportname', { reportName })}
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

function EvidenceSelect({
  id,
  choices,
  hint,
}: {
  readonly id: string;
  readonly choices: readonly AttemptChoice[];
  readonly hint: string;
}) {
  const t = useT(appMissionCatalog);
  if (choices.length === 0) return null;
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {t('appMission.appMissionIdAttemptForms.attachADocumentOptional')}
      </label>
      <select
        id={id}
        name="evidenceVersionId"
        className="input"
        defaultValue=""
        aria-describedby={`${id}-hint`}
      >
        <option value="">{t('appMission.appMissionIdAttemptForms.noDocument')}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="field-hint" id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}

/** Record another time this application went to an authority. */
export function RecordAttemptForm({
  missionId,
  today,
  evidenceChoices,
}: {
  readonly missionId: string;
  /** Today's date where the person lives (the latest day allowed). */
  readonly today: string;
  readonly evidenceChoices: readonly AttemptChoice[];
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    recordAttemptAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="missionId" value={missionId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-channel`}>
          {t('appMission.appMissionIdAttemptForms.howItWasSent')}
        </label>
        <select
          id={`${id}-channel`}
          name="channel"
          className="input"
          defaultValue=""
          {...fieldProblem(state, 'channel', messageId)}
        >
          <option value="" disabled>
            {t('appMission.appMissionIdAttemptForms.choose')}
          </option>
          {Object.entries(ATTEMPT_CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-date`}>
          {t('appMission.appMissionIdAttemptForms.dayItWasSent')}
        </label>
        <input
          id={`${id}-date`}
          name="submittedOn"
          type="date"
          className="input"
          max={today}
          {...fieldProblem(state, 'submittedOn', messageId)}
        />
      </div>
      <EvidenceSelect
        id={`${id}-evidence`}
        choices={evidenceChoices}
        hint={t('appMission.appMissionIdAttemptForms.aReceiptOrConfirmationFromYour')}
      />
      <div>
        <SubmitButton
          pending={pending}
          idle="Record Attempt"
          busy="Recording…"
          className="btn btn-secondary"
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/** Record what happened after one attempt: a receipt, a request for more, or a decision. */
export function AttemptEventForm({
  missionId,
  attemptId,
  attemptNo,
  today,
  evidenceChoices,
  documentKinds,
  maxKinds = 20,
}: {
  readonly missionId: string;
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly today: string;
  readonly evidenceChoices: readonly AttemptChoice[];
  /** Catalogue document kinds, for "The Embassy Asked for More". */
  readonly documentKinds: readonly AttemptChoice[];
  /** The most kinds one request may name (the service's own limit). */
  readonly maxKinds?: number;
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    recordAttemptEventAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const [kind, setKind] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [nextKind, setNextKind] = useState('');
  const kindName = new Map(documentKinds.map((k) => [k.value, k.label]));
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-kind`}>
          {t('appMission.appMissionIdAttemptForms.whatHappenedAfterAttemptAttemptno', {
            attemptNo: attemptNo,
          })}
        </label>
        <select
          id={`${id}-kind`}
          name="kind"
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          {...fieldProblem(state, 'kind', messageId)}
        >
          <option value="" disabled>
            {t('appMission.appMissionIdAttemptForms.choose')}
          </option>
          {Object.entries(ATTEMPT_EVENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {kind === 'DECISION' ? (
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-decision`}>
            {t('appMission.appMissionIdAttemptForms.decision')}
          </label>
          <select
            id={`${id}-decision`}
            name="decision"
            className="input"
            defaultValue=""
            {...fieldProblem(state, 'decision', messageId)}
          >
            <option value="" disabled>
              {t('appMission.appMissionIdAttemptForms.choose')}
            </option>
            {Object.entries(ATTEMPT_DECISION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {kind === 'AUTHORITY_REQUEST' ? (
        <>
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-source`}>
              {t('appMission.appMissionIdAttemptForms.whoAsked')}
            </label>
            <select
              id={`${id}-source`}
              name="requestSource"
              className="input"
              defaultValue=""
              {...fieldProblem(state, 'requestSource', messageId)}
            >
              <option value="" disabled>
                {t('appMission.appMissionIdAttemptForms.choose')}
              </option>
              {Object.entries(AUTHORITY_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="field-row attempt-kinds">
            <legend className="field-label">
              {t('appMission.appMissionIdAttemptForms.documentsTheyAskedFor')}
            </legend>
            {picked.map((value) => (
              <span className="attempt-kind-chip" key={value}>
                <input type="hidden" name="docType" value={value} />
                {kindName.get(value) ?? value}
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  aria-label={`Remove ${kindName.get(value) ?? value}`}
                  onClick={() => setPicked(picked.filter((p) => p !== value))}
                >
                  {t('appMission.appMissionIdAttemptForms.remove')}
                </button>
              </span>
            ))}
            <label className="sr-only" htmlFor={`${id}-next-kind`}>
              {t('appMission.appMissionIdAttemptForms.documentToAdd')}
            </label>
            <select
              id={`${id}-next-kind`}
              className="input"
              value={nextKind}
              onChange={(e) => setNextKind(e.target.value)}
            >
              <option value="">{t('appMission.appMissionIdAttemptForms.chooseADocument')}</option>
              {documentKinds
                .filter((k) => !picked.includes(k.value))
                .map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              aria-disabled={nextKind.length === 0 || picked.length >= maxKinds}
              onClick={() => {
                if (nextKind.length === 0 || picked.length >= maxKinds) return;
                setPicked([...picked, nextKind]);
                setNextKind('');
              }}
            >
              {t('appMission.appMissionIdAttemptForms.addDocument')}
            </button>
          </fieldset>
        </>
      ) : null}
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-date`}>
          {t('appMission.appMissionIdAttemptForms.dayItHappened')}
        </label>
        <input
          id={`${id}-date`}
          name="occurredOn"
          type="date"
          className="input"
          max={today}
          {...fieldProblem(state, 'occurredOn', messageId)}
        />
      </div>
      <EvidenceSelect
        id={`${id}-evidence`}
        choices={evidenceChoices}
        hint={t('appMission.appMissionIdAttemptForms.aLetterOrReceiptFromYour')}
      />
      <div>
        <SubmitButton
          pending={pending}
          idle="Save"
          busy="Saving…"
          className="btn btn-secondary"
          label={t('appMission.appMissionIdAttemptForms.saveForAttemptAttemptno', {
            attemptNo: attemptNo,
          })}
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}
