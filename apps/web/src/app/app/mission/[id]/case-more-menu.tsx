'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { Icon } from '../../../../components/icons';
import { useCloseOnOutsidePress } from '../../../../lib/use-popover';
import { type ActionState, transitionMissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * The case page's More menu (owner list item 3): the actions a person rarely needs, kept away
 * from the stage buttons so cancelling is never one slip away from moving a case on.
 *
 * Cancel Case does not act at once. It turns the menu into a question on the page that says what
 * cancelling means, with Yes and Keep buttons; focus moves to that question, Escape or Keep the
 * Case goes back without changing anything, and only Yes sends the request (which the server
 * refuses unless it carries the confirmation). No browser pop-up is used.
 */
export function CaseMoreMenu({
  missionId,
  applicantId,
  canCancel,
}: {
  readonly missionId: string;
  readonly applicantId: string;
  /** Whether the case's current stage allows cancelling. */
  readonly canCancel: boolean;
}) {
  const [state, formAction, pending] = useActionState(transitionMissionAction, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const question = useRef<HTMLHeadingElement>(null);
  const cancelItem = useRef<HTMLButtonElement>(null);
  // Set by Keep the Case: once the list is back, focus returns to the item that opened the question.
  const backToCancel = useRef(false);
  const panelId = useId();
  const questionId = useId();
  const consequencesId = useId();
  useCloseOnOutsidePress(menu);

  const close = () => {
    if (menu.current) menu.current.open = false;
    setConfirming(false);
    menu.current?.querySelector('summary')?.focus();
  };

  // The question takes focus as soon as it is shown, so a keyboard or screen reader user hears it.
  useEffect(() => {
    if (confirming) question.current?.focus();
    else if (backToCancel.current) {
      backToCancel.current = false;
      cancelItem.current?.focus();
    }
  }, [confirming]);

  // Once the case is cancelled the menu closes; the message beside it says what happened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per result
  useEffect(() => {
    if (state.ok && state.message !== '') close();
  }, [state]);

  return (
    <div className="case-more">
      <details
        ref={menu}
        className="case-more-menu"
        onToggle={() => {
          if (!menu.current?.open) setConfirming(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menu.current?.open) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <summary className="btn btn-secondary" aria-controls={panelId}>
          More
          <Icon name="chevronDown" size={14} />
        </summary>
        <div className="case-more-panel" id={panelId}>
          {confirming ? (
            <section
              className="case-cancel-confirm"
              aria-labelledby={questionId}
              aria-describedby={consequencesId}
            >
              <h3 className="case-cancel-question" id={questionId} ref={question} tabIndex={-1}>
                Cancel this case?
              </h3>
              <ul className="case-cancel-consequences" id={consequencesId}>
                <li>The case stops for good. It cannot be reopened or moved to another stage.</li>
                <li>
                  Nothing is deleted now. Its snapshots stay, and your profile and documents are not
                  touched.
                </li>
                <li>
                  To apply again later, open the case and choose Start a New Case from This One.
                </li>
              </ul>
              <form action={formAction} className="case-cancel-actions">
                <input type="hidden" name="missionId" value={missionId} />
                <input type="hidden" name="to" value="CANCELLED" />
                <input type="hidden" name="confirmCancel" value="yes" />
                <SubmitButton
                  pending={pending}
                  idle="Yes, Cancel This Case"
                  busy="Cancelling…"
                  className="btn btn-danger"
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    backToCancel.current = true;
                    setConfirming(false);
                  }}
                >
                  Keep the Case
                </button>
              </form>
            </section>
          ) : (
            <ul className="case-more-list">
              <li>
                <Link className="case-more-item" href={`/app/applicant/${applicantId}/memory`}>
                  Open Case History
                </Link>
              </li>
              {canCancel ? (
                <li>
                  <button
                    ref={cancelItem}
                    type="button"
                    className="case-more-item case-more-danger"
                    onClick={() => setConfirming(true)}
                  >
                    Cancel Case
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </details>
      <FormMessage result={state} />
    </div>
  );
}
