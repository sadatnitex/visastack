'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
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
        Your Private Calendar Link
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      <div className="calendar-actions">
        <button type="button" className="btn btn-primary" onClick={copy}>
          Copy Link
        </button>
      </div>
      <output aria-live="polite">{message}</output>
      <p className="muted u-m-0">Then add it to your calendar app:</p>
      <ul className="muted u-m-0">
        <li>
          Google Calendar on a computer: next to Other calendars, choose the plus sign, then From
          URL, and paste the link.
        </li>
        <li>
          iPhone or iPad: open Settings, then Calendar, Accounts, Add Account, Other, Add Subscribed
          Calendar, and paste the link.
        </li>
        <li>Calendar on a Mac: choose File, then New Calendar Subscription, and paste the link.</li>
        <li>Outlook: choose Add Calendar, then Subscribe from web, and paste the link.</li>
      </ul>
      <p className="muted u-m-0">This link is shown only now. If you lose it, make a new link.</p>
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
              Anyone who has this link can see these dates, their general titles such as &quot;Task
              Due&quot;, and the traveller&apos;s first name, which names the calendar. It never
              shows full names, case names, documents or notes. Keep it private. If someone else may
              have it, make a new link or stop sharing.
            </p>
          </div>
          {state === 'unknown' ? (
            <p className="muted">
              We could not check your calendar link just now. Refresh to try again. If you want to
              be sure nobody can use a link you made, stop sharing.
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
