import Link from 'next/link';
import type { ReactNode } from 'react';
import { caseRowProgressWords, progressRingPercent } from '../lib/readiness-words';
import { caseStatus } from '../lib/status-words';
import { CountryFlag } from './country-flag';
import { Icon } from './icons';
import { NO_REQUIRED_LABEL, PROGRESS_IN_CASE_LINE } from './progress-ring';

/**
 * How far a case's checklist is, as the row draws it. `counted` is the same count the progress
 * ring shows (required items ready of required items); the other three say honestly why there is
 * no count: the checklist has nothing required, the count was not worked out on this page, or no
 * checklist is attached yet.
 */
export type CaseRowProgress =
  | { readonly kind: 'counted'; readonly done: number; readonly total: number }
  | { readonly kind: 'none-required' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'no-checklist' };

export interface CaseListRowProps {
  readonly id: string;
  readonly title: string;
  /** The case's stored stage; the chip word and colour come from `lib/status-words.ts`. */
  readonly state: string;
  /** The destination exactly as saved (a country name, or text that names none). */
  readonly destination: string | null;
  /** The two-letter code the destination names, or null when it names no country we hold. */
  readonly iso2: string | null;
  readonly purpose: string | null;
  readonly progress: CaseRowProgress;
  /** The first required item still missing, as a short step ("Add Passport"), or null. */
  readonly nextStep: string | null;
  /** A closed or cancelled case: no advice about what to do next. */
  readonly past?: boolean;
  /** Where the whole card leads. */
  readonly href: string;
  /** A slot for the purpose icon, drawn in front of the purpose; the visual-language lane fills it. */
  readonly purposeIcon?: ReactNode;
}

/** The six Harbor tones (globals.css WP-PLAIN-TONE) a stage colour comes from; grey has none. */
const HARBOR_TONE: Readonly<Record<string, string>> = {
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'blue',
};

/** The link's one accessible name: the case, its stage, its count, and the next step when there is one. */
export function caseRowName(
  title: string,
  state: string,
  progress: CaseRowProgress,
  step: string | null = null,
): string {
  const parts = [title, caseStatus(state).word];
  if (progress.kind === 'counted') parts.push(caseRowProgressWords(progress.done, progress.total));
  if (step) parts.push(`Next: ${step}`);
  return parts.join(', ');
}

function Progress({ progress }: { readonly progress: CaseRowProgress }) {
  if (progress.kind === 'counted') {
    const percent = progressRingPercent(progress.done, progress.total);
    return (
      <span className="trip-card-progress" data-progress="counted">
        <span className="case-bar" data-empty={percent === 0 ? 'true' : 'false'} aria-hidden="true">
          <progress className="case-bar-track" max={100} value={percent} />
        </span>
        <span className="trip-card-count" data-value="count">
          {caseRowProgressWords(progress.done, progress.total)}
        </span>
      </span>
    );
  }
  if (progress.kind === 'none-required') {
    return (
      <span className="trip-card-progress" data-progress="none-required">
        <span className="trip-card-count" data-value="count">
          {NO_REQUIRED_LABEL}
        </span>
      </span>
    );
  }
  if (progress.kind === 'unread') {
    return (
      <span className="trip-card-progress" data-progress="unread">
        <span className="trip-card-count" data-value="count">
          {PROGRESS_IN_CASE_LINE}
        </span>
      </span>
    );
  }
  return null;
}

/**
 * One case on the Trips list. Every row has the same shape whatever the length of its name: a
 * round flag, the name on one line, the country and purpose, the stage chip on its own line, the
 * count with a bar, one next step, and a chevron. The whole card is one link.
 */
export function CaseListRow({
  id,
  title,
  state,
  destination,
  iso2,
  purpose,
  progress,
  nextStep,
  past = false,
  href,
  purposeIcon,
}: CaseListRowProps) {
  const status = caseStatus(state);
  const country = destination?.trim() ? destination : null;
  const purposeText = purpose?.trim() ? purpose : null;
  const tone = HARBOR_TONE[status.tone];
  const step = past ? null : progress.kind === 'no-checklist' ? 'Pick a Checklist' : nextStep;
  return (
    <li className="case-list-item">
      <Link
        className="trip-card plain-link"
        href={href}
        aria-label={caseRowName(title, state, progress, step)}
        data-pattern="trip-card"
        data-case-id={id}
      >
        <span className="trip-card-flag">
          <CountryFlag iso2={iso2} name={destination} size="lg" decorative />
        </span>
        <span className="trip-card-body">
          <span className="trip-card-title" data-value="name">
            {title}
          </span>
          {country || purposeText ? (
            <span className="trip-card-sub" data-value="meta">
              {country}
              {country && purposeText ? ' \u00b7 ' : null}
              {purposeText ? (
                <>
                  {purposeIcon ? <span className="trip-card-purpose">{purposeIcon}</span> : null}
                  {purposeText}
                </>
              ) : null}
            </span>
          ) : null}
          <span className="trip-card-chipline">
            <span
              className="case-chip"
              data-case-tone={status.tone}
              {...(tone ? { 'data-tone': tone } : {})}
            >
              <span className="case-chip-dot" aria-hidden="true" />
              {status.word}
            </span>
          </span>
          <Progress progress={progress} />
          {step ? (
            <span className="trip-card-next" data-value="next">
              Next: {step}
            </span>
          ) : null}
        </span>
        <span className="trip-card-chevron" aria-hidden="true">
          <Icon name="chevron" size={20} />
        </span>
      </Link>
    </li>
  );
}
