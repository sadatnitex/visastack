'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { Icon } from '../../../../components/icons';
import { useCloseOnOutsidePress } from '../../../../lib/use-popover';
import { type ActionState, deleteCancelledCaseAction, transitionMissionAction } from './actions';
import { SnapshotButton } from './mission-buttons';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * The case page's More menu (owner list item 3): the actions a person rarely needs, kept away
 * from the stage buttons so cancelling is never one slip away from moving a case on.
 *
 * Cancel Case does not act at once. It turns the menu into a question on the page that says what
 * cancelling means, with Yes and Keep buttons; focus moves to that question, Escape or Keep the
 * Case goes back without changing anything, and only Yes sends the request (which the server
 * refuses unless it carries the confirmation). No browser pop-up is used.
 *
 * WP-SB2: on a phone the page header keeps only this menu, so the header's other actions (Add
 * Evidence, Start a New Case from This One and Snapshot) are offered here as well when the page
 * passes `headerActions`; those items show on narrow screens only, where the header hides its own.
 */
export function CaseMoreMenu({
  missionId,
  applicantId,
  canCancel,
  canDelete = false,
  headerActions,
}: {
  readonly missionId: string;
  readonly applicantId: string;
  /** Whether the case's current stage allows cancelling. */
  readonly canCancel: boolean;
  /** Whether the case is cancelled, the only stage a case can be deleted from. */
  readonly canDelete?: boolean;
  /** The header's own actions, repeated here for phones (WP-SB2). */
  readonly headerActions?: {
    readonly addEvidenceHref: string;
    readonly newCaseHref: string;
    /** False on a finished case, which takes no new snapshot. */
    readonly snapshot?: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(transitionMissionAction, INITIAL);
  const [deleteState, deleteAction, deleting] = useActionState(deleteCancelledCaseAction, INITIAL);
  const [confirming, setConfirming] = useState<'cancel' | 'delete' | null>(null);
  // The refusal under the delete question belongs to the attempt that just failed, not to the next time the question is opened.
  const [deleteAttempted, setDeleteAttempted] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const question = useRef<HTMLHeadingElement>(null);
  const cancelItem = useRef<HTMLButtonElement>(null);
  const deleteItem = useRef<HTMLButtonElement>(null);
  // Set by Keep the Case: once the list is back, focus returns to the item that opened the question.
  const backTo = useRef<'cancel' | 'delete' | null>(null);
  const panelId = useId();
  const questionId = useId();
  const consequencesId = useId();
  useCloseOnOutsidePress(menu);

  const close = () => {
    if (menu.current) menu.current.open = false;
    setConfirming(null);
    menu.current?.querySelector('summary')?.focus();
  };

  // The question takes focus as soon as it is shown, so a keyboard or screen reader user hears it.
  useEffect(() => {
    if (confirming) question.current?.focus();
    else if (backTo.current) {
      (backTo.current === 'delete' ? deleteItem : cancelItem).current?.focus();
      backTo.current = null;
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
          if (!menu.current?.open) setConfirming(null);
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
          {confirming === 'delete' ? (
            <section
              className="case-cancel-confirm"
              aria-labelledby={questionId}
              aria-describedby={consequencesId}
            >
              <h2 className="case-cancel-question" id={questionId} ref={question} tabIndex={-1}>
                Delete this case?
              </h2>
              <ul className="case-cancel-consequences" id={consequencesId}>
                <li>
                  The case is removed for good, with its checklist, notes, tasks and what was sent
                  for it.
                </li>
                <li>Your profile and documents are not touched.</li>
                <li>This cannot be undone.</li>
              </ul>
              <form
                action={deleteAction}
                className="case-cancel-actions"
                onSubmit={() => setDeleteAttempted(true)}
              >
                <input type="hidden" name="missionId" value={missionId} />
                <input type="hidden" name="applicantId" value={applicantId} />
                <input type="hidden" name="confirmDelete" value="yes" />
                <SubmitButton
                  pending={deleting}
                  idle="Yes, Delete This Case"
                  busy="Deleting…"
                  className="btn btn-danger"
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    backTo.current = 'delete';
                    setDeleteAttempted(false);
                    setConfirming(null);
                  }}
                >
                  Keep the Case
                </button>
              </form>
              {deleteAttempted ? <FormMessage result={deleteState} /> : null}
            </section>
          ) : confirming === 'cancel' ? (
            <section
              className="case-cancel-confirm"
              aria-labelledby={questionId}
              aria-describedby={consequencesId}
            >
              <h2 className="case-cancel-question" id={questionId} ref={question} tabIndex={-1}>
                Cancel this case?
              </h2>
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
                    backTo.current = 'cancel';
                    setConfirming(null);
                  }}
                >
                  Keep the Case
                </button>
              </form>
            </section>
          ) : (
            <ul className="case-more-list">
              {headerActions ? (
                <>
                  <li className="case-more-phone">
                    <a
                      className="case-more-item"
                      href={headerActions.addEvidenceHref}
                      onClick={() => close()}
                    >
                      Add Evidence
                    </a>
                  </li>
                  <li className="case-more-phone">
                    <Link className="case-more-item" href={headerActions.newCaseHref}>
                      Start a New Case from This One
                    </Link>
                  </li>
                  {headerActions.snapshot === false ? null : (
                    <li className="case-more-phone case-more-snapshot">
                      <SnapshotButton missionId={missionId} align="start" />
                    </li>
                  )}
                </>
              ) : null}
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
                    onClick={() => setConfirming('cancel')}
                  >
                    Cancel Case
                  </button>
                </li>
              ) : null}
              {canDelete ? (
                <li>
                  <button
                    ref={deleteItem}
                    type="button"
                    className="case-more-item case-more-danger"
                    onClick={() => setConfirming('delete')}
                  >
                    Delete Case
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
