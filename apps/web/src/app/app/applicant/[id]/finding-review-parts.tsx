'use client';

import { type ReactNode, useActionState, useEffect, useId, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, decideProposalAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * Accept one clear detail straight from its row (WAL2). It sends exactly what the card's Accept
 * sends for an unchanged value: the proposal and "approve", with no corrected value, so the value
 * as read is saved. The server checks consent and access as for every other decision.
 */
export function FindingRowAccept({
  applicantId,
  proposalId,
  label,
  locked = false,
  onResult,
}: {
  readonly applicantId: string;
  readonly proposalId: string;
  /** The detail's name, so the button says which detail it accepts. */
  readonly label: string;
  /** Another save for this document is running: the button refuses clicks until it finishes. */
  readonly locked?: boolean;
  readonly onResult?: (result: ActionState) => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await decideProposalAction(previous, formData);
      if (result.ok) onResult?.(result);
      return result;
    },
    INITIAL,
  );
  return (
    <form action={formAction} className="finding-row-accept">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <SubmitButton
        pending={pending || locked}
        idle="Accept"
        busy={pending ? 'Saving…' : 'Accept'}
        className="btn btn-primary finding-row-accept-button"
        name="proposalAction"
        value="approve"
        label={`Accept: ${label}`}
      />
      <FormMessage result={state.ok ? INITIAL : state} />
    </form>
  );
}

/**
 * Sensitive details and details that differ from the profile, one at a time (WAL2: the owner's
 * pick, 17 Nov 2026). Each needs a person to decide, so only one shows, with "1 of 3", Back and
 * Skip for Now. Skip for Now only moves on: nothing is saved or skipped on the server.
 *
 * Before the script loads, and with script off, every detail is listed in order with its own
 * buttons, so nothing is out of reach; the one-at-a-time view starts once the page is running.
 */
export function FindingSteps({
  steps,
}: {
  /** One card per detail, in order, keyed by the detail so a decided card never hands its state on. */
  readonly steps: readonly { readonly key: string; readonly node: ReactNode }[];
}) {
  const count = steps.length;
  const headingId = useId();
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => setRunning(true), []);
  const current = Math.min(index, Math.max(0, count - 1));
  const stepped = running && count > 1;
  const move = (next: number) => {
    if (next < 0 || next >= count) return;
    setIndex(next);
    // Focus follows the detail shown, so a keyboard or screen reader user lands on it.
    requestAnimationFrame(() => {
      list.current?.querySelectorAll<HTMLElement>(':scope > li')[next]?.focus();
    });
  };
  if (count === 0) return null;
  return (
    // A group, not a landmark: several documents on one page can each have one.
    <div className="finding-steps" role="group" aria-labelledby={headingId}>
      <div className="finding-steps-head">
        <h4 id={headingId}>Decide One at a Time</h4>
        {stepped ? (
          <output className="finding-steps-count" data-value="count">
            {current + 1} of {count}
          </output>
        ) : null}
      </div>
      <ol className="finding-steps-list" ref={list}>
        {steps.map((step, i) => (
          <li key={step.key} tabIndex={-1} hidden={stepped && i !== current}>
            {step.node}
          </li>
        ))}
      </ol>
      {stepped ? (
        <div className="finding-steps-nav">
          <button
            type="button"
            className="btn btn-secondary"
            aria-disabled={current === 0}
            onClick={() => move(current - 1)}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-disabled={current >= count - 1}
            onClick={() => move(current + 1)}
          >
            Skip for Now
          </button>
        </div>
      ) : null}
    </div>
  );
}
