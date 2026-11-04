'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../../components/form-feedback';
import type { ReadingView } from '../../../../../../lib/reading-state';
import { type ReadingActionState, setReadingAction } from './actions';

const INITIAL: ReadingActionState = { ok: false, message: '' };

/**
 * Automatic reading, stated as it is and switchable by the person when it can run at all. The
 * words come from the same checks the reading job uses, so this line never says reading is on
 * when a file added now would not be read.
 */
export function ReadingSwitch({
  applicantId,
  view,
}: {
  readonly applicantId: string;
  readonly view: ReadingView;
}) {
  const [state, action, pending] = useActionState(setReadingAction, INITIAL);
  const fullyOn = view.status === 'on';
  return (
    <section className="add-reading" aria-labelledby={`reading-${applicantId}`}>
      <p className="add-reading-line">
        <strong id={`reading-${applicantId}`}>{view.headline}</strong>
        <span className="muted">{view.detail}</span>
      </p>
      {view.canChange ? (
        <form action={action} className="add-reading-actions">
          <input type="hidden" name="applicantId" value={applicantId} />
          {fullyOn ? null : (
            <SubmitButton
              pending={pending}
              name="choice"
              value="on"
              idle={
                view.status === 'partly_on' ? 'Turn On Both Kinds' : 'Turn On Automatic Reading'
              }
              busy="Saving"
              className="btn btn-secondary"
            />
          )}
          {view.status === 'needs_consent' ? null : (
            <SubmitButton
              pending={pending}
              name="choice"
              value="off"
              idle="Turn Off Automatic Reading"
              busy="Saving"
              className="btn btn-secondary"
            />
          )}
        </form>
      ) : null}
      {view.canChange && !fullyOn ? (
        <div className="add-reading-sent">
          <p className="muted">
            <strong>Reading text:</strong> the text of a document is sent to an AI service to
            suggest values. You approve each one.
          </p>
          <p className="muted">
            <strong>Reading scans:</strong> the picture of a scan is sent to an AI service to read
            it. This shares more than text alone.
          </p>
          <p className="muted">
            Turning it on allows both. To choose them one at a time, use{' '}
            <a href="/app/privacy">Privacy and Consent</a>.
          </p>
        </div>
      ) : null}
      <FormMessage result={state} pending={pending} pendingText="Saving" />
    </section>
  );
}
