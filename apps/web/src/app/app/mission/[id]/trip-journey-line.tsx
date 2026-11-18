import type { CasePackage, PackageItem, RequirementResultState } from '@visastack/services';
import Link from 'next/link';
import { ExplainTip } from '../../../../components/explain-tip';
import { Icon, type IconName } from '../../../../components/icons';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { humanizeCode } from '../../../../lib/format-code';
import { getServerT } from '../../../../lib/i18n-server';
import { documentKindLabel } from '../../../../lib/item-names';
import { fieldLabel } from '../../../../lib/master-profile';
import { REQUIREMENT_STATUS } from '../../../../lib/status-words';

/**
 * WAL3 (owner decision 17 Nov 2026, Trip Package "-A", Journey Line With Gaps): the things the
 * trip needs are stones on one line. A solid ring with a tick is ready; a dashed ring with a cross
 * is a gap (missing, out of date or two different values); a dashed quiet ring is still to
 * confirm. Ring style, icon and word all say it, never colour alone. Past five stones the line
 * scrolls inside its own card, never the page. Presentation only: the states are the ones the
 * existing readiness already worked out, and nothing here sends, shares or approves anything.
 */

/** Stones in view before the line scrolls inside its card (the stylesheet shows five). */
const STONES_IN_VIEW = 5;

export type StoneKind = 'ready' | 'gap' | 'todo';

export interface JourneyStone {
  readonly id: string;
  readonly name: string;
  readonly kind: StoneKind;
  readonly state: RequirementResultState;
  /** The state in the one chip vocabulary (On File, Missing, Out of Date, Two Values, To Confirm). */
  readonly word: string;
}

const GAP_STATES: readonly RequirementResultState[] = [
  'CRITICAL_GAP',
  'CONFLICTING',
  'EXPIRING_STALE',
];

export function itemDisplayName(item: Pick<PackageItem, 'kind' | 'key'>): string {
  return item.kind === 'FIELD'
    ? (fieldLabel(item.key) ?? humanizeCode(item.key))
    : documentKindLabel(item.key);
}

/**
 * The stones, in the order the readiness lists the items: what does not apply and what is only
 * optional is not a stone, because the line shows what the trip needs.
 */
export function journeyStones(items: readonly PackageItem[]): JourneyStone[] {
  const stones: JourneyStone[] = [];
  for (const item of items) {
    if (item.state === 'NOT_APPLICABLE' || item.state === 'ATTENTION') continue;
    const kind: StoneKind =
      item.state === 'SATISFIED' ? 'ready' : GAP_STATES.includes(item.state) ? 'gap' : 'todo';
    stones.push({
      id: item.packRequirementId,
      name: itemDisplayName(item),
      kind,
      state: item.state,
      word: REQUIREMENT_STATUS[item.state].word,
    });
  }
  return stones;
}

const STONE_ICON: Readonly<Record<StoneKind, IconName>> = {
  ready: 'check',
  gap: 'close',
  todo: 'circle',
};

/** The line of stones with its gaps under it, in one card. Renders nothing when the trip lists nothing it needs. */
export function TripJourneyLine({
  pkg,
  itemHref,
}: {
  readonly pkg: CasePackage;
  /** Where an item's own panel is on the case page; the button of each gap row goes there. */
  readonly itemHref?: ((id: string) => string) | undefined;
}) {
  const stones = journeyStones(pkg.items);
  if (stones.length === 0) return null;
  const ready = stones.filter((s) => s.kind === 'ready').length;
  const gaps = stones.filter((s) => s.kind === 'gap');
  return (
    <section className="trip-journey" aria-label="Trip Package Journey Line">
      <p className="trip-journey-count">
        {ready} of {stones.length} ready
      </p>
      {/* A scroll area a keyboard can reach, named, so a long checklist never needs the page to scroll. */}
      <ol
        className="trip-journey-list"
        aria-label="What This Trip Needs"
        tabIndex={stones.length > STONES_IN_VIEW ? 0 : undefined}
      >
        {stones.map((stone) => (
          <li
            key={stone.id}
            className={`trip-stone trip-stone-${stone.kind}`}
            data-stone={stone.kind}
          >
            <span className="trip-stone-ring" aria-hidden="true">
              <Icon name={STONE_ICON[stone.kind]} size={18} />
            </span>
            <span className="trip-stone-name">{stone.name}</span>
            <span className="trip-stone-word">{stone.word}</span>
          </li>
        ))}
      </ol>
      {gaps.length > 0 ? (
        // About three rows tall; more gaps scroll inside the card, never the page.
        <ul
          className="trip-gaps"
          aria-label="What Is Missing"
          tabIndex={gaps.length > 1 ? 0 : undefined}
        >
          {gaps.map((gap) => (
            <li key={gap.id} className="trip-gap">
              <span className="trip-gap-line">
                <strong>{gap.name}</strong> {gap.word}. {gapSentence(gap)}
              </span>
              <Link
                className="btn btn-secondary trip-gap-action"
                href={itemHref ? itemHref(gap.id) : '#readiness'}
                aria-label={`${gap.state === 'CRITICAL_GAP' ? 'Add' : 'Fix'} ${gap.name}`}
              >
                {gap.state === 'CRITICAL_GAP' ? 'Add' : 'Fix'}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function gapSentence(stone: JourneyStone): string {
  if (stone.state === 'EXPIRING_STALE') return `Upload a current ${stone.name}.`;
  if (stone.state === 'CONFLICTING') return `Pick the right value for ${stone.name}.`;
  return `Add ${stone.name}.`;
}

const OUTSIDE_TILES: Readonly<
  Record<string, { readonly name: string; readonly icon: IconName | 'pay' }>
> = {
  APPLICATION_FORM: { name: 'Form', icon: 'file' },
  APPOINTMENT: { name: 'Book', icon: 'calendar' },
  ORIGINALS: { name: 'Bring', icon: 'briefcase' },
  FEE: { name: 'Pay', icon: 'pay' },
};

function PayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/**
 * What VisaStack does not do for the person: the name and four pictures in one row. Each picture
 * keeps its full sentence in an Explain popup (name and one plain sentence on hover, focus or tap;
 * Escape closes). The general note (VisaStack does not do these for you) is in the Trip Package
 * heading's Explain popup. A step the checklist adds on top of the four stays a plain line.
 */
export function OutsideVisaStackRow({ steps }: { readonly steps: CasePackage['outsideSteps'] }) {
  const t = getServerT(appMissionCatalog);
  const tiles = steps.filter((s) => s.kind in OUTSIDE_TILES);
  const extras = steps.filter((s) => !(s.kind in OUTSIDE_TILES));
  return (
    <section aria-labelledby="package-outside-heading" className="trip-outside-row">
      <div className="trip-outside-head">
        <h3 id="package-outside-heading" className="package-subheading">
          {t.node('appMission.appMissionIdPackagePanel.outsideVisastack')}
        </h3>
      </div>
      <ul className="trip-outside" aria-label="Steps Outside VisaStack">
        {tiles.map((step) => {
          const tile = OUTSIDE_TILES[step.kind];
          if (!tile) return null;
          return (
            <li key={step.kind} className="trip-outside-tile" data-outside={step.kind}>
              <ExplainTip label={tile.name} text={step.label}>
                {tile.icon === 'pay' ? <PayIcon /> : <Icon name={tile.icon} size={22} />}
              </ExplainTip>
            </li>
          );
        })}
      </ul>
      {extras.length > 0 ? (
        <ul className="trip-outside-extra">
          {extras.map((step) => (
            <li key={step.kind}>{step.label}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
