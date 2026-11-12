'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { formatTimestamp } from '../../../../lib/format-date';
import { type ActionState, recordSubmissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const CHANNEL_LABELS: Record<string, string> = {
  EMBASSY_PORTAL: 'Embassy / consulate portal',
  EMAIL: 'Email',
  IN_PERSON: 'In Person',
  COURIER: 'Courier',
  VISA_APPLICATION_CENTER: 'Visa Application Centre',
  OTHER: 'Other',
};

export interface SubmissionView {
  readonly id: string;
  readonly channel: string;
  readonly externalReportDescription: string;
  readonly externalReference: string | null;
  readonly submittedAt: string;
}

/** TRU-04 §7 - a report that the live-acknowledged snapshot was actually submitted externally. This is the only path that ever moves a mission to SUBMITTED, so it only appears once the case has reached SUBMISSION_READY. */
export function SubmissionReportPanel({
  missionId,
  submissions,
  eligible,
}: {
  readonly missionId: string;
  readonly submissions: readonly SubmissionView[];
  readonly eligible: boolean;
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState(recordSubmissionAction, INITIAL);

  return (
    <article className="card">
      <p className="card-kicker">{t.node('appMission.appMissionIdSubmissionReportPanel.filing')}</p>
      <h2 className="card-title">
        {t.node('appMission.appMissionIdSubmissionReportPanel.submissionReport')}
      </h2>
      {submissions.length > 0 ? (
        <div className="rows u-mb-125">
          {submissions.map((s) => (
            <div
              className="row"
              key={s.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{formatTimestamp(s.submittedAt)}</span>
                <span className="badge badge-neutral">
                  {CHANNEL_LABELS[s.channel] ?? s.channel}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
                {s.externalReportDescription}
                {s.externalReference
                  ? t.node('appMission.appMissionIdSubmissionReportPanel.refExternalreference', {
                      externalReference: s.externalReference,
                    })
                  : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="card-body u-mb-125">
          {t.node('appMission.appMissionIdSubmissionReportPanel.noSubmissionReportedYet')}
        </p>
      )}
      {eligible ? (
        <form action={formAction} className="field-list">
          <input type="hidden" name="missionId" value={missionId} />
          <div className="field-row">
            <label className="field-label" htmlFor="channel">
              {t.node('appMission.appMissionIdSubmissionReportPanel.howWasItSubmitted')}
            </label>
            <select id="channel" name="channel" className="input" defaultValue="">
              <option {...t.lang('appMission.appMissionIdAttemptForms.choose')} value="" disabled>
                {t('appMission.appMissionIdAttemptForms.choose')}
              </option>
              {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="externalReportDescription">
              {t.node('appMission.appMissionIdSubmissionReportPanel.description')}
            </label>
            <textarea
              id="externalReportDescription"
              name="externalReportDescription"
              className="input"
              rows={2}
              placeholder={t(
                'appMission.appMissionIdSubmissionReportPanel.whatWasActuallyFiledAndWhere',
              )}
              required
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="externalReference">
              {t.node('appMission.appMissionIdSubmissionReportPanel.referenceNumberOptional')}
            </label>
            <input
              id="externalReference"
              name="externalReference"
              type="text"
              className="input"
              placeholder={t(
                'appMission.appMissionIdSubmissionReportPanel.eGTrackingOrReceiptNumber',
              )}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="submittedAt">
              {t.node(
                'appMission.appMissionIdSubmissionReportPanel.submittedOnOptionalDefaultsToNow',
              )}
            </label>
            <input id="submittedAt" name="submittedAt" type="datetime-local" className="input" />
          </div>
          <div>
            <SubmitButton
              pending={pending}
              idle="Report Submission"
              busy="Recording…"
              className="btn btn-secondary"
            />
            <FormMessage result={state} />
          </div>
        </form>
      ) : (
        <p className="muted u-fs-085">
          {t.node('appMission.appMissionIdSubmissionReportPanel.thisCaseMustReachSubmissionReady')}
        </p>
      )}
    </article>
  );
}
