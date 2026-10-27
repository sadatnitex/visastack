import { NO_REQUIRED_LABEL, NO_REQUIRED_LINE, ProgressRing } from './progress-ring';

/** The counts the ring needs; `computeReadiness` (and the agency view of it) carries both. */
export interface ReadinessCounts {
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
}

/**
 * The progress ring for one case, from its computed readiness only. With a readiness result the
 * ring shows its count; without one (no checklist attached yet, or it could not be worked out) the
 * ring is empty and teaches the next step, and no number is made up. Pass `pickHref` where the
 * viewer can attach a checklist; leave it out inside a link, where a second link would nest.
 */
export function CaseReadinessRing({
  readiness,
  pickHref,
  size = 'md',
  emptyLine,
}: {
  readonly readiness: ReadinessCounts | null;
  readonly pickHref?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly emptyLine?: string;
}) {
  if (readiness && readiness.requiredCount > 0) {
    return (
      <ProgressRing
        size={size}
        done={readiness.satisfiedRequired}
        total={readiness.requiredCount}
      />
    );
  }
  if (readiness) {
    return (
      <ProgressRing
        size={size}
        done={0}
        total={0}
        emptyLabel={NO_REQUIRED_LABEL}
        emptyLine={NO_REQUIRED_LINE}
      />
    );
  }
  return (
    <ProgressRing
      size={size}
      done={0}
      total={0}
      {...(emptyLine ? { emptyLine } : {})}
      {...(pickHref ? { emptyAction: { href: pickHref, label: 'Pick a Checklist' } } : {})}
    />
  );
}
