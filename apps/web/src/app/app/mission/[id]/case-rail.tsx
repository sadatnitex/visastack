import type { MissionState, TripCheck } from '@visastack/core';
import type { Mission } from '@visastack/services';
import Link from 'next/link';
import { atLevel } from '../../../../components/depth';
import { Icon } from '../../../../components/icons';
import { SectionCard, StatusPill } from '../../../../components/ui-lift';
import { memoryHref } from '../../../../lib/application-memory-labels';
import { CASE_STATE_LABELS } from '../../../../lib/case-stages';
import { officialPageForDestination } from '../../../../lib/country-start';
import { formatDateOnly } from '../../../../lib/format-date';
import { AttachPackForm, type PackOption } from './attach-pack-form';
import type { CaseSourceRow } from './case-model';
import { CaseDetailsForm, ItineraryForm, TransitionButtons } from './mission-buttons';
import { OpenFoldOnLink } from './open-fold-on-link';
import { RailFold } from './rail-fold';
import { isPacketSnapshot } from './snapshot-packet';
import { TripChecksPanel, tripChecksSummary } from './trip-checks-panel';

/**
 * The right-hand rail of the case page: Case Details, Trip Date Checks, the Requirement Pack with
 * the sources it cites, Advance the Case, Snapshots and Itinerary Reference. Server components
 * with plain props; the page decides what to pass. Each card is a SectionCard inside a slot that
 * carries the id and depth level the page's links and the depth switch rely on.
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

/** The hint that stands in for the date checks while the case has no travel dates. */
const ADD_DATES_HINT =
  'Add your travel dates under Edit Case Details to see passport and insurance date checks.';

/** The Trip Date Checks card (`#trip-checks`), or the hint to add travel dates. */
export function CaseTripChecks({ view, checks }: CaseTripChecksProps) {
  if (view === 'checks') {
    const summary = tripChecksSummary(checks);
    return (
      <RailFold
        id="trip-checks"
        level="browse"
        icon="calendar"
        title="Trip Date Checks"
        meta={summary.meta}
        // A check that needs a look is the point of the card, so a phone shows it already open.
        open={summary.status?.tone === 'danger' || summary.status?.tone === 'warning'}
        pill={
          summary.status ? (
            <StatusPill tone={summary.status.tone}>{summary.status.label}</StatusPill>
          ) : undefined
        }
      >
        <TripChecksPanel checks={checks} />
      </RailFold>
    );
  }
  if (view === 'add-dates') {
    return (
      <p className="muted u-fs-085" {...atLevel('browse')}>
        {ADD_DATES_HINT}
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
  /**
   * The date checks, shown under Case Details. Without it the rail leaves them to the page, which
   * then shows the card itself (`CaseTripChecks`).
   */
  readonly tripChecks?: CaseTripChecksProps | undefined;
  /** The official pages the checklist cites; shown under the Requirement Pack. */
  readonly sources?: readonly CaseSourceRow[] | undefined;
}

/** The pages the checklist cites, with when each was last read. */
function RailSources({ sources }: { readonly sources: readonly CaseSourceRow[] }) {
  return (
    <section className="case-sources lift-rail-sources" aria-labelledby="case-sources-heading">
      <h3 id="case-sources-heading" className="lift-rail-subhead">
        Sources for This Checklist
      </h3>
      <ul className="case-sources-list lift-source-list">
        {sources.map((source) => (
          <li key={source.href}>
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.name}
            </a>
            <span className="muted lift-source-dates">
              Checked: {source.checkedAt ? formatDateOnly(source.checkedAt) : 'Not Checked Yet'}
              {' · '}In Effect Since:{' '}
              {source.inEffectSince ? formatDateOnly(source.inEffectSince) : 'Not Stated'}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted lift-rail-note">
        Checked is when VisaStack last read the page. Always confirm the final requirements with the
        official authority or your agency.
      </p>
    </section>
  );
}

/** The travel dates in one line, or the plain words that none are set. */
function datesLine(mission: Mission): string {
  return `${mission.travelStartDate ? formatDateOnly(mission.travelStartDate) : 'Travel dates not set'}${
    mission.travelEndDate ? ` to ${formatDateOnly(mission.travelEndDate)}` : ''
  }`;
}

function CaseDetailsCard({
  mission,
  showAddDatesHint,
}: {
  readonly mission: Mission;
  readonly showAddDatesHint: boolean;
}) {
  return (
    <RailFold level="browse" icon="briefcase" title="Case Details" meta={datesLine(mission)}>
      <SectionCard kicker="Case" heading="Case Details" tone="blue">
        <p className={`lift-fact${mission.jurisdiction ? ' lift-fact-lead' : ''}`}>
          <span className="lift-fact-icon">
            <Icon name="briefcase" size={18} />
          </span>
          <span>
            {mission.jurisdiction || 'Embassy or visa centre not set'}
            {mission.serviceCategory ? ` · ${mission.serviceCategory}` : ''}
          </span>
        </p>
        <p className="lift-fact">
          <span className="lift-fact-icon">
            <Icon name="calendar" size={18} />
          </span>
          <span>{datesLine(mission)}</span>
        </p>
        {mission.targetDeadline ? (
          <p className="lift-fact">
            <span className="lift-fact-icon">
              <Icon name="clock" size={18} />
            </span>
            <span>Target deadline: {formatDateOnly(mission.targetDeadline)}</span>
          </p>
        ) : null}
        {showAddDatesHint ? <p className="muted lift-rail-note">{ADD_DATES_HINT}</p> : null}
        <details className="case-details-edit lift-rail-edit">
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
      </SectionCard>
    </RailFold>
  );
}

function PackCard({
  mission,
  packInfo,
  packOptions,
  noChecklistLines,
  primaryAttach,
  sources,
}: Pick<
  CaseRailProps,
  'mission' | 'packInfo' | 'packOptions' | 'noChecklistLines' | 'primaryAttach'
> & { readonly sources: readonly CaseSourceRow[] }) {
  // The official page for the place the case travels to: a stand-in where no checklist exists.
  const officialPage = officialPageForDestination(mission.destination);
  return (
    <RailFold
      id="pack"
      level="browse"
      icon="shield"
      title="Requirement Pack"
      meta={
        mission.packVersionId && packInfo
          ? packInfo.name
          : packOptions.length > 0
            ? 'No checklist yet. Pick one.'
            : 'No checklist yet'
      }
      pill={
        mission.packVersionId && packInfo?.reviewed ? (
          <StatusPill tone="success">Reviewed</StatusPill>
        ) : undefined
      }
      open={!mission.packVersionId}
    >
      <SectionCard kicker="Requirements" heading="Requirement Pack" tone="violet">
        {mission.packVersionId && packInfo ? (
          <>
            <div className="lift-pack-head">
              <span className="lift-pack-name">{packInfo.name}</span>
              <StatusPill tone={packInfo.reviewed ? 'success' : 'neutral'}>
                {packInfo.badge}
              </StatusPill>
            </div>
            {packInfo.coverage ? <p className="muted lift-rail-line">{packInfo.coverage}</p> : null}
            {packInfo.notice ? <p className="muted lift-rail-line">{packInfo.notice}</p> : null}
            {packInfo.effectiveDate ? (
              <p className="muted lift-rail-note">
                In effect since {formatDateOnly(packInfo.effectiveDate)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {packOptions.length === 0 ? (
              // VS-006: no reviewed checklist to pick. Say so and why, and promise nothing.
              <>
                {noChecklistLines.map((line) => (
                  <p className="lift-rail-line" key={line}>
                    {line}
                  </p>
                ))}
                {officialPage ? (
                  <p className="lift-rail-line case-official-page">
                    <a
                      href={officialPage}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Official page for ${mission.destination}, opens in a new tab`}
                    >
                      Official Page
                    </a>
                    . VisaStack has not checked it.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="lift-rail-line">
                Pick a checklist: attach a published requirement pack to see how many items are
                ready.
              </p>
            )}
            <AttachPackForm missionId={mission.id} options={packOptions} primary={primaryAttach} />
          </>
        )}
        {sources.length > 0 ? <RailSources sources={sources} /> : null}
      </SectionCard>
    </RailFold>
  );
}

function SnapshotsCard({
  mission,
  applicantId,
  snapshots,
  moreSnapshots,
}: Pick<CaseRailProps, 'mission' | 'applicantId' | 'snapshots' | 'moreSnapshots'>) {
  return (
    <RailFold
      id="snapshots"
      level="everything"
      icon="file"
      title="Snapshots"
      meta={
        snapshots.length === 0 ? 'None yet' : `${snapshots.length}${moreSnapshots ? '+' : ''} saved`
      }
    >
      <SectionCard kicker="History" heading="Snapshots" tone="teal">
        <p className="lift-rail-line case-memory-link">
          Each snapshot keeps exactly what it held.{' '}
          <Link href={memoryHref(applicantId)}>Open Case History</Link> to see every case for this
          person and compare what you confirmed with today.
        </p>
        {snapshots.length === 0 ? (
          <p className="lift-rail-line">
            No snapshots yet. Capture one to freeze this case's evidence and checksum.
          </p>
        ) : (
          <div className="lift-snap-list">
            {snapshots.map((snap) => {
              const isPacket = isPacketSnapshot(snap.content);
              return (
                <Link
                  href={`/app/mission/${mission.id}/snapshots/${snap.id}`}
                  className="row lift-snap"
                  key={snap.id}
                >
                  <span className="lift-snap-icon">
                    <Icon name="file" size={18} />
                  </span>
                  <span className="lift-snap-text">
                    <span className="row-key lift-snap-name">
                      Version {snap.version}
                      {isPacket ? (
                        <span className="badge badge-success lift-ml-050">Application Packet</span>
                      ) : null}
                    </span>
                    <span className="lift-snap-sum" title={snap.checksum}>
                      {snap.checksum.slice(0, 12)}…
                    </span>
                  </span>
                  <span className="lift-snap-chevron">
                    <Icon name="chevron" size={18} />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        {moreSnapshots ? (
          <p className="lift-rail-line">
            <Link href={`/app/mission/${mission.id}/snapshots`}>See All Snapshots</Link>
          </p>
        ) : null}
      </SectionCard>
    </RailFold>
  );
}

function ItineraryCard({
  mission,
  linkedMissions,
}: Pick<CaseRailProps, 'mission' | 'linkedMissions'>) {
  return (
    <RailFold
      level="everything"
      icon="users"
      title="Itinerary Reference"
      meta={mission.itineraryRef ? `Linked: ${mission.itineraryRef}` : 'Not linked'}
    >
      <SectionCard kicker="Family Trip" heading="Itinerary Reference" tone="violet">
        <p className="lift-rail-line">
          An optional label linking this case to another family member's, purely for display. Access
          and permissions stay entirely separate per case.
        </p>
        <details className="lift-help lift-rail-edit" open={Boolean(mission.itineraryRef)}>
          <summary>Link to a Family Trip</summary>
          <div className="lift-help-body">
            <ItineraryForm missionId={mission.id} itineraryRef={mission.itineraryRef} />
          </div>
        </details>
        {linkedMissions.length > 0 ? (
          <div className="lift-snap-list">
            {linkedMissions.map((m) => (
              <Link className="row row-link lift-snap" key={m.id} href={`/app/mission/${m.id}`}>
                <span className="lift-snap-icon">
                  <Icon name="users" size={18} />
                </span>
                <span className="lift-snap-text">
                  <span className="row-key lift-snap-name">{m.applicantName}</span>
                  <span className="muted lift-snap-sum">{m.title}</span>
                </span>
                <span className="lift-snap-chevron">
                  <Icon name="chevron" size={18} />
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </SectionCard>
    </RailFold>
  );
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
  tripChecks,
  sources,
}: CaseRailProps) {
  return (
    <aside className="split-rail lift-rail" aria-label="About this case" {...atLevel('browse')}>
      <OpenFoldOnLink />
      <CaseDetailsCard mission={mission} showAddDatesHint={tripChecks?.view === 'add-dates'} />
      {tripChecks?.view === 'checks' ? <CaseTripChecks {...tripChecks} /> : null}
      <PackCard
        mission={mission}
        packInfo={packInfo}
        packOptions={packOptions}
        noChecklistLines={noChecklistLines}
        primaryAttach={primaryAttach}
        sources={sources ?? []}
      />
      <RailFold
        level="browse"
        icon="arrow"
        title="Advance the Case"
        meta={
          stageStates[0]
            ? `Next: ${CASE_STATE_LABELS[stageStates[0]]}`
            : 'No further stage from here'
        }
      >
        <SectionCard kicker="Workflow" heading="Advance the Case" tone="blue">
          {stageStates.length === 0 ? (
            <p className="lift-rail-line">
              {nextStates.length === 0
                ? 'This case is in a terminal state.'
                : 'There is no further stage from here. To stop the case, use More at the top of the page.'}
            </p>
          ) : (
            <TransitionButtons missionId={mission.id} nextStates={stageStates} />
          )}
        </SectionCard>
      </RailFold>
      <SnapshotsCard
        mission={mission}
        applicantId={applicantId}
        snapshots={snapshots}
        moreSnapshots={moreSnapshots}
      />
      <ItineraryCard mission={mission} linkedMissions={linkedMissions} />
    </aside>
  );
}
