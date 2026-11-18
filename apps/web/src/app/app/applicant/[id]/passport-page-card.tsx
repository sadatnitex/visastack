'use client';

import { type MouseEvent, type ReactNode, useId, useState } from 'react';
import {
  STATUS_MEANINGS,
  type StatusKind,
  StatusPicture,
} from '../../../../components/pictures/status-picture';
import { isProtectedDetail } from './profile-protected';

/**
 * Passport Page Card (WAL4, owner decision 17 Nov 2026, option B): a schematic passport data page
 * whose printed lines show the profile's own values for the eleven details a passport holds.
 *
 * Truthful on purpose. The drawing is flat and made up (no photo, no seal, no real document
 * image), the values come from the profile and never from reading the paper, and the card says it
 * does not verify identity. A protected value is masked until the person chooses Show, and its
 * real text is never put into the drawing, a label or a tooltip. ESS1: a protected value is not in
 * the page at all until Show asks the editor to open it (`text` is null until then). A value that is saved but could
 * not be opened here shows the words the editor already uses, never the stand-in "[protected]".
 *
 * The card holds no form and no box. Tapping a line opens that detail's own edit row, so every
 * function (save, the date it became true, where it came from, how it was checked, no longer
 * current, does not apply) stays in one place and every box keeps one id on the page.
 */

/** The eleven details, in the order a passport data page prints them. */
export const PASSPORT_PAGE_KEYS = [
  'family_name',
  'given_name',
  'nationality',
  'date_of_birth',
  'sex',
  'place_of_birth',
  'passport_number',
  'passport_issuing_country',
  'passport_issue_date',
  'passport_expiry',
  'marital_status',
] as const;

export type PassportPageKey = (typeof PASSPORT_PAGE_KEYS)[number];

/** Names for a detail this person's view does not list (its section is not shown). */
export const PASSPORT_PAGE_LABELS: Readonly<Record<PassportPageKey, string>> = {
  family_name: 'Family Name',
  given_name: 'Given Name',
  nationality: 'Nationality',
  date_of_birth: 'Date of Birth',
  sex: 'Sex',
  place_of_birth: 'Place of Birth',
  passport_number: 'Passport Number',
  passport_issuing_country: 'Issuing Country',
  passport_issue_date: 'Date of Issue',
  passport_expiry: 'Date of Expiry',
  marital_status: 'Marital Status',
};

/** Whether a detail's value is hidden until the person chooses Show (one rule: profile-protected). */
export function isMaskedDetail(key: string, sensitivity: string | undefined): boolean {
  return isProtectedDetail(key, sensitivity);
}

/** The dots drawn in place of a hidden value. Fixed length, so the mask says nothing about it. */
export const MASK_TEXT = '•• ••• ••••';

/** The words for a detail with nothing saved yet, on the card and on its row. */
export const NOT_ADDED_YET = 'Not Added Yet';

/** A protected value drawn as dots; screen readers hear "Hidden", never the value. */
export function MaskedValue() {
  return (
    <>
      <span aria-hidden="true">{MASK_TEXT}</span>
      <span className="sr-only">Hidden</span>
    </>
  );
}

/** What one printed line holds. The editor works it out; the card only draws it. */
export type PassportLineState =
  /**
   * A value to print. `masked` hides it until Show. `text` is null for a protected value not
   * opened yet: Show opens it through `onReveal` first.
   */
  | { readonly kind: 'value'; readonly text: string | null; readonly masked: boolean }
  /** Saved and protected, but not opened here, or a note such as Does Not Apply: words, never the value. */
  | { readonly kind: 'note'; readonly text: ReactNode }
  /** Nothing saved yet. */
  | { readonly kind: 'empty' };

export interface PassportLine {
  readonly key: string;
  readonly label: string;
  readonly state: PassportLineState;
  /** The status picture for the saved value, or null. */
  readonly status: StatusKind | null;
  /**
   * Where the detail's edit box is, so the line works before any script loads; null when this
   * view has no edit row for it (its section is not shown).
   */
  readonly href: string | null;
  /**
   * The saved version the line prints (fact and save time). Show holds for this version only: a
   * new save starts masked again, never "Hide" over dots.
   */
  readonly version?: string;
}

export interface PassportPageCardProps {
  readonly lines: readonly PassportLine[];
  /** Opens the edit row of a detail and puts the focus in it. */
  readonly onEdit: (key: string) => void;
  /** Opens a protected value that is not in the page; resolves true once it can be printed. */
  readonly onReveal?: ((key: string) => Promise<boolean | 'slow'>) | undefined;
}

/** The id of a detail's edit row in the full list of sections. */
export function valueRowId(key: string): string {
  return `profile-row-${key}`;
}

function PageArt() {
  // Decorative and schematic: a band, an emblem ring and a blank portrait outline (never a photo).
  return (
    <svg
      className="passport-page-art"
      viewBox="0 0 96 120"
      width="96"
      height="120"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="passport-page-art-paper" x="1" y="1" width="94" height="118" rx="8" />
      <rect className="passport-page-art-band" x="1" y="1" width="94" height="18" rx="8" />
      <rect className="passport-page-art-band" x="1" y="11" width="94" height="8" />
      <circle className="passport-page-art-line" cx="14" cy="10" r="4.5" />
      <rect className="passport-page-art-ink" x="24" y="8" width="44" height="4" rx="2" />
      <rect className="passport-page-art-frame" x="14" y="30" width="68" height="78" rx="6" />
      <circle className="passport-page-art-ink" cx="48" cy="58" r="13" />
      <path className="passport-page-art-ink" d="M24 106c0-15 11-24 24-24s24 9 24 24z" />
    </svg>
  );
}

function MachineZone() {
  // Two rows of chevrons in the place a machine-readable zone sits. Pattern only: no value is in it.
  const row = (y: number) => (
    <path
      key={y}
      className="passport-page-zone-mark"
      d={Array.from({ length: 30 }, (_, i) => `M${4 + i * 8} ${y}l3 3-3 3`).join('')}
    />
  );
  return (
    <svg
      className="passport-page-zone"
      viewBox="0 0 248 26"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {row(3)}
      {row(15)}
    </svg>
  );
}

function LineContent({
  line,
  shown,
  onEdit,
}: {
  readonly line: PassportLine;
  readonly shown: boolean;
  readonly onEdit: (key: string) => void;
}) {
  const { state, label, key, href } = line;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window keeps the link's own way.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onEdit(key);
  };
  if (state.kind === 'empty') {
    return (
      <>
        <span className="passport-page-empty">{NOT_ADDED_YET}</span>
        {href ? (
          <a className="btn btn-secondary passport-page-add" href={href} onClick={follow}>
            Add<span className="sr-only"> {label}</span>
          </a>
        ) : null}
      </>
    );
  }
  const hidden = state.kind === 'value' && (state.text === null || (state.masked && !shown));
  const printed = state.kind === 'note' ? state.text : hidden ? <MaskedValue /> : state.text;
  if (!href) {
    return (
      <span className="passport-page-value" data-masked={hidden ? 'true' : undefined}>
        {printed}
      </span>
    );
  }
  return (
    <a
      className="passport-page-value"
      href={href}
      onClick={follow}
      data-masked={hidden ? 'true' : undefined}
    >
      {printed}
      <span className="sr-only">. Edit {label}</span>
    </a>
  );
}

export function PassportPageCard({ lines, onEdit, onReveal }: PassportPageCardProps) {
  const headingId = useId();
  const problemId = useId();
  // Detail key to the version it was shown for.
  const [shown, setShown] = useState<ReadonlyMap<string, string>>(() => new Map());
  const isShown = (line: PassportLine) => shown.get(line.key) === (line.version ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  // The line Show failed for, and whether it was too many this hour.
  const [problem, setProblem] = useState<{ key: string; slow: boolean } | null>(null);
  const toggle = (line: PassportLine) =>
    setShown((current) => {
      const next = new Map(current);
      if (current.get(line.key) === (line.version ?? '')) next.delete(line.key);
      else next.set(line.key, line.version ?? '');
      return next;
    });
  async function showOrHide(line: PassportLine) {
    setProblem(null);
    const closed = line.state.kind === 'value' && line.state.text === null;
    if (!isShown(line) && closed) {
      // Not in the page yet: the editor opens it for the owner, then it prints.
      setBusy(line.key);
      const ok = onReveal ? await onReveal(line.key) : false;
      setBusy(null);
      if (ok !== true) {
        setProblem({ key: line.key, slow: ok === 'slow' });
        return;
      }
    }
    toggle(line);
  }
  return (
    <section className="passport-page-card" aria-labelledby={headingId}>
      <div className="passport-page-head">
        <h3 id={headingId}>Passport Page</h3>
        <p className="muted">
          Drawn from the details in your profile, not read from the passport itself. This does not
          verify identity.
        </p>
      </div>
      <div className="passport-page-sheet">
        <PageArt />
        <dl className="passport-page-lines">
          {lines.map((line) => {
            const masked = line.state.kind === 'value' && line.state.masked;
            const lineShown = isShown(line);
            return (
              <div
                key={line.key}
                className="passport-page-line"
                data-detail={line.key}
                data-state={line.state.kind}
              >
                <dt className="passport-page-label">{line.label}</dt>
                <dd className="passport-page-cell">
                  <LineContent line={line} shown={lineShown} onEdit={onEdit} />
                  {masked ? (
                    // The name says what a press does (Show or Hide), so no pressed state is added.
                    <button
                      type="button"
                      className="btn btn-secondary passport-page-show"
                      aria-busy={busy === line.key || undefined}
                      aria-describedby={problem?.key === line.key ? problemId : undefined}
                      onClick={() => showOrHide(line)}
                    >
                      {lineShown ? 'Hide' : 'Show'}
                      <span className="sr-only"> {line.label}</span>
                    </button>
                  ) : null}
                  {line.status ? (
                    <StatusPicture
                      kind={line.status}
                      label={`${line.label}: ${STATUS_MEANINGS[line.status].name}`}
                      className="passport-page-status"
                    />
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
        <MachineZone />
      </div>
      {/* Always in the page, so a screen reader announces the words when they arrive. */}
      <output id={problemId} className="muted passport-page-problem">
        {problem
          ? problem.slow
            ? 'Try again in a little while.'
            : 'This detail could not be shown just now. Try again.'
          : null}
      </output>
    </section>
  );
}
