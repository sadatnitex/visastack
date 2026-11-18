import type { ReactNode } from 'react';
import { StatusPill } from '../../../../components/ui-lift';
import { ExpandableSection } from '../../../../components/ui-lift/expandable-section';
import type { LiftHeadingLevel, LiftTone } from '../../../../components/ui-lift/types';
import { initialsOf } from '../../../../lib/agency-brand';
import './u8.css';

/**
 * The shared pieces of the agency screens on the Wallet foundation (U8): a person's initials as a
 * picture, one compact row (picture, name, one status chip, a short line, details in the body)
 * built on the Expandable Section, and the ring that means something for a limit. Presentation
 * only: every word, action and permission stays with the page that draws the row.
 */

/** A person or client as initials in a flat disc. Decorative: the name is always written beside it. */
export function InitialsPicture({ name }: { readonly name: string }) {
  return (
    <span className="u8-initials" aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export interface AgencyRowProps {
  /** The name on the row, in the words the page already used. */
  readonly title: ReactNode;
  /** The picture at the start of the row. */
  readonly picture: ReactNode;
  /** One status chip: its words and tone. */
  readonly chip?: { readonly label: ReactNode; readonly tone: LiftTone } | undefined;
  /** One short line after the chip (a date, an address, a code). */
  readonly meta?: ReactNode;
  readonly id?: string | undefined;
  readonly defaultOpen?: boolean | undefined;
  /** Keep the row as the person left it across a page refresh (for a row with a form). */
  readonly remember?: boolean | undefined;
  readonly headingLevel?: LiftHeadingLevel | undefined;
  /** The details: shown when the row is open. */
  readonly children: ReactNode;
}

/** One compact row for a person, a client, a request or a case. */
export function AgencyRow({
  title,
  picture,
  chip,
  meta,
  id,
  defaultOpen,
  remember,
  headingLevel = 3,
  children,
}: AgencyRowProps) {
  const summary =
    chip || meta ? (
      <span className="u8-line">
        {chip ? <StatusPill tone={chip.tone}>{chip.label}</StatusPill> : null}
        {meta ? <span className="u8-meta">{meta}</span> : null}
      </span>
    ) : undefined;
  return (
    <ExpandableSection
      className="u8-row"
      title={title}
      picture={picture}
      headingLevel={headingLevel}
      {...(summary ? { summary } : {})}
      {...(id ? { id } : {})}
      {...(defaultOpen ? { defaultOpen } : {})}
      {...(remember ? { remember } : {})}
    >
      {children}
    </ExpandableSection>
  );
}

/** The rows of one list, spaced the same way on every agency screen. */
export function AgencyRows({
  children,
  id,
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly id?: string;
  readonly ariaLabel?: string;
}) {
  return (
    <div
      className="u8-rows"
      {...(id ? { id } : {})}
      {...(ariaLabel ? { role: 'group', 'aria-label': ariaLabel } : {})}
    >
      {children}
    </div>
  );
}

const RING_RADIUS = 15.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * How much of a limit is used, as a ring: the share drawn clockwise from the top, thicker when
 * the limit is full. It has no number of its own: the words beside it say the count, so it is
 * decorative. A limit with no ceiling gets no ring (see UnlimitedPicture).
 */
export function LimitRing({
  used,
  allowed,
  tone,
}: {
  readonly used: number;
  readonly allowed: number;
  readonly tone: '' | 'meter-warn' | 'meter-full';
}) {
  // A limit of none that is used (or any full limit) draws the whole ring.
  const share = allowed > 0 ? Math.min(1, Math.max(0, used / allowed)) : used > 0 ? 1 : 0;
  return (
    <svg
      className={`u8-ring${tone ? ` u8-ring-${tone === 'meter-full' ? 'full' : 'warn'}` : ''}`}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="u8-ring-track" cx="20" cy="20" r={RING_RADIUS} />
      {share > 0 ? (
        <circle
          className="u8-ring-arc"
          cx="20"
          cy="20"
          r={RING_RADIUS}
          strokeDasharray={`${(share * RING_LENGTH).toFixed(2)} ${RING_LENGTH.toFixed(2)}`}
          transform="rotate(-90 20 20)"
        />
      ) : null}
    </svg>
  );
}

/** The picture of a limit with no ceiling: a flat disc and a sideways eight, never an empty bar. */
export function UnlimitedPicture() {
  return (
    <svg
      className="u8-ring"
      viewBox="0 0 40 40"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="u8-ring-disc" cx="20" cy="20" r="16" />
      <path
        className="u8-ring-mark"
        d="M11.5 20c0-2.6 1.8-4.5 4-4.5 3.8 0 4.7 9 8.5 9 2.2 0 4-1.9 4-4.5s-1.8-4.5-4-4.5c-3.8 0-4.7 9-8.5 9-2.2 0-4-1.9-4-4.5z"
      />
    </svg>
  );
}
