import type { MissionState, TripCheck } from '@visastack/core';
import type { Mission } from '@visastack/services';
import Link from 'next/link';
import { atLevel } from '../../../../components/depth';
import { memoryHref } from '../../../../lib/application-memory-labels';
import { formatDateOnly } from '../../../../lib/format-date';
import { AttachPackForm, type PackOption } from './attach-pack-form';
import { CaseDetailsForm, ItineraryForm, TransitionButtons } from './mission-buttons';
import { isPacketSnapshot } from './snapshot-packet';
import { TripChecksPanel } from './trip-checks-panel';

/**
 * The right-hand rail of the case page, and the Trip Date Checks card. Server components with
 * plain props; the page decides what to pass.
 */

/** The checklist the case is on, as the Requirement Pack card shows it. */
export interface CasePackInfo {
  readonly name: string;
  readonly badge: string;
  readonly reviewed: boolean;
  readonly coverage: string | null;
  readonly notice: string | null;
  /** ISO date; null when the version states none. */
  readonly effectiveDate: string | null;
}

/** One snapshot as the Snapshots card lists it. */
export interface CaseSnapshotRow {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
  /** Read only to tell whether the snapshot is an application packet. */
  readonly content: unknown;
}

/** One case linked to this one by the family-trip label. */
export interface CaseLinkedRow {
  readonly id: string;
  readonly title: string;
  readonly applicantName: string;
}

export interface CaseTripChecksProps {
  /**
   * `checks`: the case has travel dates and its stage still shows date checks.
   * `add-dates`: the stage shows them but no travel date is set, so a hint stands in.
   * `none`: the stage shows no date checks.
   */
  readonly view: 'checks' | 'add-dates' | 'none';
  /** The checks; null when they could not be read. */
  readonly checks: readonly TripCheck[] | null;
}

/** The Trip Date Checks card (`#trip-checks`), or the hint to add travel dates. */
export function CaseTripChecks({ view, checks }: CaseTripChecksProps) {
  if (view === 'checks') {
    return (
      <article className="card" id="trip-checks" {...atLevel('browse')}>
        <TripChecksPanel checks={checks} />
      </article>
    );
  }
  if (view === 'add-dates') {
    return (
      <p className="muted u-fs-085" {...atLevel('browse')}>
        Add your travel dates under Edit Case Details to see passport and insurance date checks.
      </p>
    );
  }
  return null;
}

export interface CaseRailProps {
  readonly mission: Mission;
  readonly applicantId: string;
  /** The linked checklist; null when none is linked or its name could not be read. */
  readonly packInfo: CasePackInfo | null;
  /** The reviewed checklists the person may pick from; empty when none can be picked. */
  readonly packOptions: readonly PackOption[];
  /** Why no checklist can be picked, one plain line each; used when `packOptions` is empty. */
  readonly noChecklistLines: readonly string[];
  /** The attach button is the page's one primary button (no next step, alert or welcome note). */
  readonly primaryAttach: boolean;
  /** Every stage the case may move to, cancelling included. */
  readonly nextStates: readonly MissionState[];
  /** The stages offered as buttons (cancelling is not one of them). */
  readonly stageStates: readonly MissionState[];
  /** The newest snapshots shown on the page. */
  readonly snapshots: readonly CaseSnapshotRow[];
  /** More snapshots exist than are listed. */
  readonly moreSnapshots: boolean;
  /** The other cases that share this case's family-trip label. */
  readonly linkedMissions: readonly CaseLinkedRow[];
}

export function CaseRail({
  mission,
  applicantId,
  packInfo,
  packOptions,
  noChecklistLines,
  primaryAttach,
  nextStates,
  stageStates,
  snapshots,
  moreSnapshots,
  linkedMissions,
}: CaseRailProps) {
  return (
    <aside className="split-rail" aria-label="About this case" {...atLevel('browse')}>
      <article className="card" {...atLevel('browse')}>
        <p className="card-kicker">Case</p>
        <h2 className="card-title">Case Details</h2>
        <p className="card-body">
          {mission.jurisdiction || 'Embassy or visa centre not set'}
          {mission.serviceCategory ? ` · ${mission.serviceCategory}` : ''}
        </p>
        <p className="muted">
          {mission.travelStartDate
            ? formatDateOnly(mission.travelStartDate)
            : 'Travel dates not set'}
          {mission.travelEndDate ? ` to ${formatDateOnly(mission.travelEndDate)}` : ''}
        </p>
        <details className="case-details-edit">
          <summary>Edit Case Details</summary>
          <CaseDetailsForm
            missionId={mission.id}
            jurisdiction={mission.jurisdiction}
            serviceCategory={mission.serviceCategory}
            travelStartDate={mission.travelStartDate}
            travelEndDate={mission.travelEndDate}
            targetDeadline={mission.targetDeadline}
            manualMode={mission.manualMode}
          />
        </details>
      </article>
      <article className="card" id="pack" {...atLevel('browse')}>
        <p className="card-kicker">Requirements</p>
        <h2 className="card-title">Requirement Pack</h2>
        {mission.packVersionId && packInfo ? (
          <>
            <div className="lift-line-between lift-mb-050">
              <span className="card-body u-m-0">{packInfo.name}</span>
              <span className={`badge ${packInfo.reviewed ? 'badge-success' : 'badge-neutral'}`}>
                {packInfo.badge}
              </span>
            </div>
            {packInfo.coverage ? <p className="muted lift-small-m0">{packInfo.coverage}</p> : null}
            {packInfo.notice ? <p className="muted u-fs-085 u-mt-050">{packInfo.notice}</p> : null}
            {packInfo.effectiveDate ? (
              <p className="muted lift-small-mt-035">
                In effect since {formatDateOnly(packInfo.effectiveDate)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {packOptions.length === 0 ? (
              // VS-006: no reviewed checklist to pick. Say so and why, and promise nothing.
              noChecklistLines.map((line) => (
                <p className="card-body u-mb-100" key={line}>
                  {line}
                </p>
              ))
            ) : (
              <p className="card-body u-mb-100">
                Pick a checklist: attach a published requirement pack to see how many items are
                ready.
              </p>
            )}
            <AttachPackForm missionId={mission.id} options={packOptions} primary={primaryAttach} />
          </>
        )}
      </article>
      <article className="card" {...atLevel('browse')}>
        <p className="card-kicker">Workflow</p>
        <h2 className="card-title">Advance the Case</h2>
        {stageStates.length === 0 ? (
          <p className="card-body">
            {nextStates.length === 0
              ? 'This case is in a terminal state.'
              : 'There is no further stage from here. To stop the case, use More at the top of the page.'}
          </p>
        ) : (
          <div className="u-mt-050">
            <TransitionButtons missionId={mission.id} nextStates={stageStates} />
          </div>
        )}
      </article>
      <article className="card" id="snapshots" {...atLevel('everything')}>
        <p className="card-kicker">History</p>
        <h2 className="card-title">Snapshots</h2>
        <p className="card-body case-memory-link">
          Each snapshot keeps exactly what it held.{' '}
          <Link href={memoryHref(applicantId)}>Open Case History</Link> to see every case for this
          person and compare what you confirmed with today.
        </p>
        {snapshots.length === 0 ? (
          <p className="card-body">
            No snapshots yet. Capture one to freeze this case's evidence and checksum.
          </p>
        ) : (
          <div className="rows u-mt-050">
            {snapshots.map((snap) => {
              const isPacket = isPacketSnapshot(snap.content);
              return (
                <Link
                  href={`/app/mission/${mission.id}/snapshots/${snap.id}`}
                  className="row lift-link-plain"
                  key={snap.id}
                >
                  <span className="row-key">
                    Version {snap.version}
                    {isPacket ? (
                      <span className="badge badge-success lift-ml-050">Application Packet</span>
                    ) : null}
                  </span>
                  <span className="row-val u-fs-075" title={snap.checksum}>
                    {snap.checksum.slice(0, 12)}…
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        {moreSnapshots ? (
          <p className="card-body u-mt-050">
            <Link href={`/app/mission/${mission.id}/snapshots`}>See All Snapshots</Link>
          </p>
        ) : null}
      </article>
      <article className="card" {...atLevel('everything')}>
        <p className="card-kicker">Family Trip</p>
        <h2 className="card-title">Itinerary Reference</h2>
        <p className="card-body u-mb-100">
          An optional label linking this case to another family member's, purely for display. Access
          and permissions stay entirely separate per case.
        </p>
        <ItineraryForm missionId={mission.id} itineraryRef={mission.itineraryRef} />
        {linkedMissions.length > 0 ? (
          <div className="rows u-mt-100">
            {linkedMissions.map((m) => (
              <Link className="row row-link" key={m.id} href={`/app/mission/${m.id}`}>
                <span className="row-key">{m.applicantName}</span>
                <span className="muted">{m.title}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </article>
    </aside>
  );
}
