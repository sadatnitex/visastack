import type { TripCheck, TripCheckLevel } from '@visastack/core';
import { StatusBadge, type Tone } from '../../../../components/ui';

/**
 * How the dates of a case line up with the passport and travel insurance on the profile. The
 * checks are worked out in the core package; this only shows them. They are common checks, never
 * the rule of a country, and the words say so.
 */

const LEVELS: Readonly<Record<TripCheckLevel, { readonly tone: Tone; readonly label: string }>> = {
  problem: { tone: 'danger', label: 'Needs Fixing' },
  check: { tone: 'warning', label: 'Take a Look' },
  unknown: { tone: 'neutral', label: 'Add a Detail' },
  ok: { tone: 'success', label: 'Looks Fine' },
};

export function TripChecksPanel({ checks }: { readonly checks: readonly TripCheck[] | null }) {
  return (
    <>
      <p className="card-kicker">Dates</p>
      <h2 className="card-title">Trip Date Checks</h2>
      <p className="muted u-fs-085">
        Common checks of your trip dates against your passport and travel insurance. They are not a
        country's rules, so read the rules for your destination too.
      </p>
      {checks === null ? (
        <p className="muted">
          We could not check your dates just now. Reload the page to try again.
        </p>
      ) : (
        <ul className="rows" aria-label="Trip date checks">
          {checks.map((check) => {
            const level = LEVELS[check.level];
            return (
              <li className="row trip-check" key={check.key}>
                <span className="trip-check-head">
                  <span className="row-key">{check.title}</span>
                  <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
                </span>
                <span className="muted u-fs-085">{check.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
