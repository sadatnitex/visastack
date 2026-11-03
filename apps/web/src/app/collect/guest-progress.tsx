import type { GuestChecklistItem, GuestFileView } from '@visastack/services';
import { Icon } from '../../components/icons';
import { type MandatoryUnit, mandatoryUnits } from './checklist';

/**
 * Where the guest stands against the Mandatory items, in words and a meter (UMPE P13). Only
 * Mandatory items are counted, an any-one-of group counts once, and nothing else is promised: the
 * other items never hold up a submission and the guest can always send again. The numbers come
 * from the same ready-file rule the service uses (`stillMissing`), so this never says more than
 * what a submission would freeze.
 */

/** The most segments the meter draws; a longer list scales to this many. */
export const METER_SEGMENTS = 12;

export interface MandatoryStanding {
  readonly total: number;
  readonly done: number;
  /** The first Mandatory unit still open, as a short phrase, or null when none is open. */
  readonly next: string | null;
  /** Whether the list has items marked Mandatory If It Applies, which are never counted here. */
  readonly hasConditional: boolean;
}

/**
 * A unit is covered when one of its items has a file the guest confirmed. A file placed only from
 * its name is a suggestion, so it does not count here until the guest confirms it: Suggested is
 * never read as Placed.
 */
function unitCovered(
  unit: MandatoryUnit,
  stillMissing: readonly string[],
  suggestedOnly: readonly string[],
): boolean {
  return unit.items.some(
    (item) => !stillMissing.includes(item.id) && !suggestedOnly.includes(item.id),
  );
}

export function mandatoryStanding(
  items: readonly GuestChecklistItem[],
  stillMissing: readonly string[],
  /** Items whose only file is a suggestion from its name (`suggestedOnlyIds`). */
  suggestedOnly: readonly string[] = [],
): MandatoryStanding {
  const units = mandatoryUnits(items);
  const open = units.filter((unit) => !unitCovered(unit, stillMissing, suggestedOnly));
  const first = open[0];
  const label = first
    ? first.items.length > 1
      ? `One of ${first.items.map((item) => item.label).join(' or ')}`
      : (first.items[0]?.label ?? null)
    : null;
  const awaitingCheck = first?.items.some((item) => suggestedOnly.includes(item.id)) ?? false;
  return {
    total: units.length,
    done: units.length - open.length,
    next: label === null ? null : awaitingCheck ? `Check the file suggested for ${label}` : label,
    hasConditional: items.some((item) => item.necessity === 'CONDITIONAL'),
  };
}

/** Files the guest has placed under an item, and ready files that still need a look. */
export function fileTally(files: readonly GuestFileView[]): {
  readonly placed: number;
  /** Files with no item, placed only from their name, stalled or refused: each needs the guest. */
  readonly needsLook: number;
} {
  const ready = files.filter((file) => file.status === 'ready');
  return {
    placed: ready.filter((file) => file.itemId !== null && file.mapping === 'chosen').length,
    // A file that stalled or was refused needs the guest too (remove it, or add it again).
    needsLook:
      ready.filter((file) => file.itemId === null || file.mapping === 'proposed').length +
      files.filter((file) => file.status === 'stalled' || file.status === 'refused').length,
  };
}

function segmentsOf(standing: MandatoryStanding): { id: string; on: boolean }[] {
  const count = Math.min(standing.total, METER_SEGMENTS);
  const filled =
    standing.total <= METER_SEGMENTS
      ? standing.done
      : Math.floor((standing.done / standing.total) * METER_SEGMENTS);
  return Array.from({ length: count }, (_, n) => ({ id: `segment-${n}`, on: n < filled }));
}

/** What stands between a guest with every Mandatory item placed and the Submit button. */
export type SubmitBlocker = 'checking' | 'retention' | null;

export function GuestProgress({
  standing,
  agencyName,
  blocker,
}: {
  readonly standing: MandatoryStanding;
  readonly agencyName: string | null;
  readonly blocker: SubmitBlocker;
}) {
  const none = standing.total === 0;
  const complete = !none && standing.done === standing.total;
  const headline = none
    ? 'Add What You Have'
    : complete
      ? 'All Mandatory Items Placed'
      : `${standing.done} of ${standing.total} Mandatory Items Placed`;
  const who = agencyName ?? 'the agency';
  return (
    <section
      className={`collect-progress${complete ? ' collect-progress-complete' : ''}`}
      aria-labelledby="collect-progress-title"
    >
      <div className="collect-progress-head">
        {complete ? <Icon name="check" size={20} /> : null}
        <h2 id="collect-progress-title" className="collect-progress-title">
          {headline}
        </h2>
      </div>
      {none ? null : (
        <div
          className="collect-meter"
          role="img"
          aria-label={`${standing.done} of ${standing.total} mandatory items placed`}
        >
          {segmentsOf(standing).map((segment) => (
            <span
              key={segment.id}
              className={segment.on ? 'collect-meter-on' : 'collect-meter-off'}
            />
          ))}
        </div>
      )}
      <p className="collect-progress-line">
        {none
          ? `Nothing on this list is marked Mandatory. Add what you have, then send it to ${who} when you are ready.`
          : complete
            ? blocker === 'checking'
              ? 'Your files are still being checked. You can send them when that finishes.'
              : blocker === 'retention'
                ? `Choose how long ${who} may keep your files, then you can send.`
                : `You can send now, or add more first. ${who === 'the agency' ? 'The agency' : who} receives only what you choose to send.`
            : `Next: ${standing.next ?? ''}.`}
      </p>
      {standing.hasConditional ? (
        <p className="muted u-fs-085">
          Items marked Mandatory If It Applies are yours to check, and are not counted here.
        </p>
      ) : null}
    </section>
  );
}

/** The phone's pinned summary: what is placed, what is left, and one way down to Submit. */
export function GuestBar({
  placed,
  left,
  total,
  needsLook,
}: {
  readonly placed: number;
  /** Files with no item, or placed only from their name, which come first in what the bar says. */
  readonly needsLook: number;
  /** How many Mandatory items are still open, and how many there are at all. */
  readonly left: number;
  readonly total: number;
}) {
  return (
    <section className="collect-bar" aria-label="Your submission">
      <p className="collect-bar-text">
        <strong>
          {placed} {placed === 1 ? 'File' : 'Files'} Placed
        </strong>
        <span>
          {needsLook > 0
            ? `${needsLook} ${needsLook === 1 ? 'file needs' : 'files need'} a look`
            : total === 0
              ? 'Nothing mandatory'
              : left === 0
                ? 'All mandatory placed'
                : `${left} mandatory open`}
        </span>
      </p>
      <a className="btn btn-primary" href="#guest-submit">
        Review and Submit
      </a>
    </section>
  );
}
