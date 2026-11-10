import type { ReactNode } from 'react';

export interface StepBarStep {
  /** The stage's name, exactly as it is shown. The number comes from the stylesheet, not the text. */
  readonly label: string;
  /** The stage the case is in now. */
  readonly current?: boolean | undefined;
}

export interface StepBarProps {
  /** The region's name for screen readers. */
  readonly ariaLabel: string;
  /** The stages along the path, in order. */
  readonly steps: readonly StepBarStep[];
  /** Stages off the path (a cancelled case), shown apart at the end with a dashed edge. */
  readonly apart?: readonly StepBarStep[] | undefined;
  /** Where the case is, as words: "Stage 2 of 7". */
  readonly position?: string | undefined;
  /** An explanation folded under its own name ("About Stages"). */
  readonly help?: { readonly summary: string; readonly children: ReactNode } | undefined;
}

/**
 * The stages of a case as numbered steps joined by a line, the way an order tracker shows where a
 * parcel is. A "Now:" headline names the stage the case is in, with the position words and a strip
 * of segments under it. Opening "About Stages" shows every step: in a row on a wide screen, down a
 * line on a phone, with the current step marked. Only the current stage is marked: no earlier stage
 * is ticked, because the page does not keep a history of finished stages, and it never predicts a
 * date or an outcome.
 */
export function StepBar({ ariaLabel, steps, apart = [], position, help }: StepBarProps) {
  const now = [...steps, ...apart].find((step) => step.current)?.label;
  return (
    <section className="lift-steps" aria-label={ariaLabel}>
      {now ? <p className="lift-steps-now">Now: {now}</p> : null}
      {position ? <p className="lift-steps-position">{position}</p> : null}
      <ol className="lift-steps-list">
        {steps.map((step) => (
          <li
            key={step.label}
            className={`lift-step${step.current ? ' lift-step-current' : ''}`}
            aria-current={step.current ? 'step' : undefined}
          >
            <span>{step.label}</span>
          </li>
        ))}
        {apart.map((step) => (
          <li
            key={step.label}
            className={`lift-step lift-step-apart${step.current ? ' lift-step-current' : ''}`}
            aria-current={step.current ? 'step' : undefined}
          >
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="lift-steps-strip" aria-hidden="true">
        {steps.map((step) => (
          <span
            key={step.label}
            className={`lift-strip-part${step.current ? ' lift-strip-part-current' : ''}`}
          />
        ))}
      </div>
      {help ? (
        <details className="lift-help">
          <summary>{help.summary}</summary>
          <div className="lift-help-body">{help.children}</div>
        </details>
      ) : null}
    </section>
  );
}
