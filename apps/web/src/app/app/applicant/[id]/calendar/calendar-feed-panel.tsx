'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { type CalendarFeedFormResult, calendarFeedAction } from './feed-actions';

/** What the page knows about the link when it loads; the link itself is never known again. */
export type CalendarFeedPanelStatus =
  | { readonly state: 'unavailable' }
  | { readonly state: 'off' }
  | { readonly state: 'on'; readonly linkMadeOn: string };

const INITIAL: CalendarFeedFormResult = NO_RESULT;

/** The link just made, with a copy button and the calendar app hand-off. Shown once. */
function NewLink({ https, webcal }: { readonly https: string; readonly webcal: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(https);
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
        Your Private Calendar Link
      </label>
      <input ref={input} id={id} className="input" value={https} readOnly />
      <div className="calendar-actions">
        <button type="button" className="btn btn-primary" onClick={copy}>
          Copy Link
        </button>
        <a className="btn btn-secondary" href={webcal}>
          Open in Calendar App
        </a>
      </div>
      <p className="muted u-m-0">
        In your calendar app, look for Add Calendar or Subscribe, choose to add one from a link, and
        paste this link. On an iPhone, iPad or Mac, Open in Calendar App does this for you. This
        link is shown only now. If you lose it, make a new link.
      </p>
      <output aria-live="polite">{message}</output>
    </div>
  );
}

/**
 * "Subscribe in Your Calendar App" (v1.2 B05 live feed): turn a private link on, copy it once, make
 * a new one, or stop it. Plain forms with one action; the server decides who may change the link.
 */
export function CalendarFeedPanel({
  applicantId,
  status,
}: {
  readonly applicantId: string;
  readonly status: CalendarFeedPanelStatus;
}) {
  const [result, act, pending] = useActionState(calendarFeedAction, INITIAL);
  // Which button sent the form, so only that one says it is working.
  const [sent, setSent] = useState<string | null>(null);
  const busyWord = (intent: string, word: string, idle: string) => (sent === intent ? word : idle);
  const messageId = useId();
  const state = result.feed ?? status.state;

  return (
    <section className="card u-mt-150" aria-labelledby="calendar-feed-heading">
      <h3 className="card-title" id="calendar-feed-heading">
        Subscribe in Your Calendar App
      </h3>
      {state === 'unavailable' ? (
        <p className="card-body">
          Subscribing in your calendar app is not available yet. You can still download a calendar
          file above.
        </p>
      ) : (
        <>
          <p className="card-body">
            Turn on a private link and add it to your calendar app once. Your dates then keep up by
            themselves: new dates appear, changed dates move, and finished dates go away. Calendar
            apps check the link on their own schedule, from every few minutes to about once a day.
          </p>
          <div className="notice notice-warn u-mb-100">
            <p className="u-m-0">
              Anyone who has this link can see these dates and their general titles, such as
              &quot;Task Due&quot;. It never shows names, case names, documents or notes. Keep it
              private. If someone else may have it, make a new link or stop sharing.
            </p>
          </div>
          {state === 'on' && !result.link ? (
            <p className="muted">
              Your calendar link is on
              {status.state === 'on' && result.feed === undefined
                ? `, made on ${status.linkMadeOn}`
                : ''}
              . For your safety the link is shown only once, when it is made. If you no longer have
              it, make a new link.
            </p>
          ) : null}
          {result.link ? <NewLink https={result.link.https} webcal={result.link.webcal} /> : null}
          <form
            action={act}
            className="calendar-actions u-mt-100"
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
                <SubmitButton
                  pending={pending}
                  name="intent"
                  value="new"
                  idle="Make a New Link"
                  busy={busyWord('new', 'Making…', 'Make a New Link')}
                  className="btn btn-secondary"
                />
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
            <p className="muted u-fs-085 u-m-0">
              Making a new link stops the old one at once: add the new link to your calendar app
              again. Stop Sharing turns the link off; your calendar app then gets no new dates.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
