'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { applicantCalendarCatalog } from '../../../../../i18n/applicant-calendar';
import { type CalendarFeedFormResult, calendarFeedAction } from './feed-actions';

/** What the page knows about the link when it loads; the link itself is never known again. */
export type CalendarFeedPanelStatus =
  | { readonly state: 'unavailable' }
  | { readonly state: 'off' }
  | { readonly state: 'on'; readonly linkMadeOn: string }
  /** The state could not be read; stopping still works. */
  | { readonly state: 'unknown' };

type KnownState = CalendarFeedPanelStatus['state'];

/** The last answer, plus the link's state as last known from the server (never lost on a failure). */
export interface PanelResult extends CalendarFeedFormResult {
  readonly known?: KnownState;
}

/**
 * The panel's next result from the last one and the server's answer. The state shown is the last
 * one the server reported, never the page's first one: a failed change that could not read the
 * state keeps the last known state. A link just shown stays shown while the link is still on.
 */
export const nextPanelResult = (
  previous: PanelResult,
  next: CalendarFeedFormResult,
): PanelResult => {
  const known = next.feed ?? previous.known;
  const link = next.link ?? (!next.ok && known === 'on' ? previous.link : undefined);
  return { ...next, ...(known ? { known } : {}), ...(link ? { link } : {}) };
};

/** The link just made, with a copy button and short steps for common calendar apps. Shown once. */
function NewLink({ url }: { readonly url: string }) {
  const t = useT(applicantCalendarCatalog);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied. Paste it into your calendar app.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('Select and copy the link above, then paste it into your calendar app.');
    }
  }
  return (
    <div className="field-list u-mt-100">
      <label htmlFor={id} className="field-label">
        {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.yourPrivateCalendarLink')}
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      <div className="calendar-actions">
        <button type="button" className="btn btn-primary" onClick={copy}>
          {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.copyLink')}
        </button>
      </div>
      <output className="field-msg" aria-live="polite">
        {message}
      </output>
      <p className="muted u-m-0">
        {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.thenAddItToYourCalendar')}
      </p>
      <ul className="muted u-m-0">
        <li>
          {t(
            'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.googleCalendarOnAComputerNext',
          )}
        </li>
        <li>
          {t(
            'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.iphoneOrIpadOpenSettingsThen',
          )}
        </li>
        <li>
          {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.calendarOnAMacChooseFile')}
        </li>
        <li>
          {t(
            'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.outlookChooseAddCalendarThenSubscribe',
          )}
        </li>
      </ul>
      <p className="muted u-m-0">
        {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.thisLinkIsShownOnlyNow')}
      </p>
    </div>
  );
}

/**
 * "Subscribe in Your Calendar App" (v1.2 B05 live feed): turn a private link on, copy it once, make
 * a new one, or stop it. One form with one action; the server decides who may change the link. The
 * state shown is the last one the server reported, so a failed change never shows a stale state.
 */
export function CalendarFeedPanel({
  applicantId,
  status,
}: {
  readonly applicantId: string;
  readonly status: CalendarFeedPanelStatus;
}) {
  const t = useT(applicantCalendarCatalog);
  const [result, act, pending] = useActionState(
    async (previous: PanelResult, formData: FormData): Promise<PanelResult> =>
      nextPanelResult(previous, await calendarFeedAction(NO_RESULT, formData)),
    { ...NO_RESULT, known: status.state },
  );
  // Which button sent the form, so only that one says it is working.
  const [sent, setSent] = useState<string | null>(null);
  const busyWord = (intent: string, word: string, idle: string) => (sent === intent ? word : idle);
  const messageId = useId();
  const state: KnownState = result.known ?? status.state;
  const unchanged = result.known === status.state && result.message === '';

  return (
    <section className="card u-mt-150" aria-labelledby="calendar-feed-heading">
      <h3 className="card-title" id="calendar-feed-heading">
        {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.subscribeInYourCalendarApp')}
      </h3>
      {state === 'unavailable' ? (
        <p className="card-body">
          {t(
            'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.subscribingInYourCalendarAppIs',
          )}
        </p>
      ) : (
        <>
          <p className="card-body">
            {t('applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.turnOnAPrivateLinkAnd')}
          </p>
          <div className="notice notice-warn u-mb-100">
            <p className="u-m-0">
              {t(
                'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.anyoneWhoHasThisLinkCan',
              )}
            </p>
          </div>
          {state === 'unknown' ? (
            <p className="muted">
              {t(
                'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.weCouldNotCheckYourCalendar',
              )}
            </p>
          ) : null}
          {state === 'on' && !result.link ? (
            <p className="muted">
              Your calendar link is on
              {status.state === 'on' && unchanged ? `, made on ${status.linkMadeOn}` : ''}. For your
              safety the link is shown only once, when it is made. If you no longer have it, make a
              new link.
            </p>
          ) : null}
          {result.link ? <NewLink key={result.link} url={result.link} /> : null}
          <form
            action={act}
            className="calendar-actions calendar-feed-actions u-mt-100"
            onSubmit={(event) => {
              const submitter = (event.nativeEvent as SubmitEvent).submitter;
              setSent(submitter?.getAttribute('value') ?? null);
            }}
          >
            <input type="hidden" name="applicantId" value={applicantId} />
            {state === 'off' ? (
              <SubmitButton
                pending={pending}
                name="intent"
                value="on"
                idle="Turn On Calendar Link"
                busy="Turning On…"
              />
            ) : (
              <>
                {state === 'on' ? (
                  <SubmitButton
                    pending={pending}
                    name="intent"
                    value="new"
                    idle="Make a New Link"
                    busy={busyWord('new', 'Making…', 'Make a New Link')}
                    className="btn btn-secondary"
                  />
                ) : null}
                <SubmitButton
                  pending={pending}
                  name="intent"
                  value="off"
                  idle="Stop Sharing"
                  busy={busyWord('off', 'Stopping…', 'Stop Sharing')}
                  className="btn btn-secondary"
                />
              </>
            )}
            <FormMessage id={messageId} result={result} />
          </form>
          {state === 'on' ? (
            <p className="muted u-fs-085 calendar-feed-note">
              {t(
                'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.makingANewLinkStopsThe',
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
