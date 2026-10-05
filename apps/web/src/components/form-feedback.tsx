'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared pieces that make a form say what happened to everyone, not only to people
 * who can see the screen (WCAG 1.3.1, 3.3.1, 4.1.3).
 *
 * What a server action returns. `field`, when the action knows which input the
 * problem is about, lets the form mark that input invalid and put focus on it
 * (WCAG 3.3.1: the item in error is identified, not just described).
 */
export interface FormResult {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

export const NO_RESULT: FormResult = { ok: true, message: '' };

/** Whether `result` is a failure to report (an empty message is "nothing yet", not an error). */
export function isFailure(result: FormResult): boolean {
  return !result.ok && result.message !== '';
}

/**
 * The attributes that tie an input to the form's message when the problem is about
 * that input. Spread onto the input: `<input {...fieldProblem(state, 'name', messageId)} />`.
 * For an input the problem is not about it returns nothing, so a message about one
 * field is never read out as an error on another.
 */
export function fieldProblem(
  result: FormResult,
  field: string,
  messageId: string,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  if (!isFailure(result) || result.field !== field) return {};
  return { 'aria-invalid': true, 'aria-describedby': messageId };
}

/**
 * Where a form says what happened. Both regions are always in the page, empty until
 * there is something to say, because a screen reader announces a change inside a region
 * that already exists and often says nothing for one that appears with its text already
 * in it. A failure goes to the region that interrupts (`role="alert"`), progress and
 * success to the polite one (`role="status"`).
 *
 * `pending` and `pendingText` let a long action (an upload, an AI run) say it is
 * working, in words, to people who cannot see a spinner.
 *
 * It adds no wrapper, so it sits in a form's flex row or column exactly as the old
 * conditional paragraph did; while empty both regions are taken out of the layout
 * (see `.field-msg:empty`) but stay in the page for assistive technology. `id` goes on
 * the failure text, the thing an invalid input should point to.
 */
export function FormMessage({
  id,
  result,
  pending = false,
  pendingText,
  style,
}: {
  readonly id?: string;
  readonly result: FormResult;
  readonly pending?: boolean;
  readonly pendingText?: string;
  readonly style?: CSSProperties;
}) {
  const failed = isFailure(result);
  const working = pending && pendingText !== undefined;
  const status = working ? pendingText : failed ? '' : result.message;
  const tone = result.ok ? 'field-msg-ok' : 'field-msg-err';
  return (
    <>
      <output className={`field-msg ${working ? '' : tone}`.trim()} style={style}>
        {status}
      </output>
      <p id={id} role="alert" className="field-msg field-msg-err" style={style}>
        {failed && !working ? result.message : ''}
      </p>
    </>
  );
}

/**
 * A submit button that stays focusable while its action runs. A button that becomes
 * `disabled` drops keyboard focus to the top of the page, so someone using the
 * keyboard or a screen reader loses their place; `aria-disabled` keeps focus where
 * it was, and the click is refused while an action is already running (which also
 * stops a double click and the Enter key from sending the same request twice).
 */
export function SubmitButton({
  pending,
  idle,
  busy,
  className = 'btn btn-primary',
  style,
  name,
  value,
  label,
  title,
  unavailable = false,
}: {
  readonly pending: boolean;
  readonly idle: ReactNode;
  readonly busy: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly name?: string;
  readonly value?: string;
  /** An accessible name that says what the button is for, when the visible text alone does not (a row of identical "Grant" buttons). It must start with the visible text, and is dropped while the visible text changes to the busy wording. */
  readonly label?: string;
  readonly title?: string;
  /** The action cannot be taken yet for a reason other than one already running (nothing selected, a precondition unmet): a real `disabled` button, which is right for something nobody can act on. */
  readonly unavailable?: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-label={pending ? undefined : label}
      title={title}
      className={className}
      style={style}
      disabled={unavailable || undefined}
      aria-disabled={pending ? true : undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      {pending ? busy : idle}
    </button>
  );
}
