/**
 * Renders a date-ONLY value — no meaningful time-of-day component, e.g. a
 * mission-fact "effective as of" backdate, or any Master Profile field of
 * type `'date'` (`profile-fields.ts`) — consistently regardless of the
 * viewer's local timezone (finding #25, post-programme defect register).
 *
 * A date-only value is written by parsing a plain `YYYY-MM-DD` string
 * (e.g. from an `<input type="date">`) via `new Date(str)`, which the
 * ECMAScript spec defines as **UTC midnight** for that calendar date — not
 * local midnight. Reading that instant back and formatting it with
 * `toLocaleDateString()` and no explicit `timeZone` re-interprets the UTC
 * instant in the *viewer's own* local timezone, silently shifting the
 * displayed date backward by one day for any viewer west of UTC (e.g.
 * `2020-01-15` renders as "Jan 14, 2020" in `America/Los_Angeles`,
 * confirmed directly — a viewer east of UTC is unaffected only by
 * coincidence, since a positive offset from midnight never crosses into
 * the previous day).
 *
 * Passing `timeZone: 'UTC'` explicitly closes this at its root: the
 * UTC-midnight instant is always read back as the exact calendar date it
 * was written as, independent of where the viewer physically is — the
 * write→store→read pipeline (`actions.ts`'s `new Date(raw)`, `profile.ts`'s
 * `effectiveFrom`/`.toISOString()`) already preserves that instant losslessly;
 * this is the one place a viewer-dependent reinterpretation was introduced.
 *
 * Do NOT use this for genuine timestamps (`createdAt`, `expiryAt`,
 * `invitedAt`, `updatedAt`, ...) — those carry a real time-of-day and
 * SHOULD render in the viewer's own local timezone; that is correct,
 * expected behavior, not a variant of this same bug.
 */
export function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
