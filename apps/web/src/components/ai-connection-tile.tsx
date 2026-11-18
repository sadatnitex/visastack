import { aiAppHost, aiAppName } from '@visastack/core/ai-features';
import type { ReactNode } from 'react';
import { applicantSharingCatalog } from '../i18n/applicant-sharing';
import { componentsCatalog } from '../i18n/components';
import { type AiTimeLeft, formatDayIn, formatMomentIn } from '../lib/ai-connection-time-left';
import { getServerT } from '../lib/i18n-server';
import { ExplainTip } from './explain-tip';
import { Icon, type IconName } from './icons';

/**
 * WAL5 (owner decision 17 Nov 2026, Wallet board Pattern 4 option A): one tile per AI connection.
 * Who it is, when it was connected, what it can read as small pictures that explain themselves,
 * a clock ring for the time left with the end date, when it was last used, and the connection's
 * own actions. The same tile serves traveller and agency AI connections.
 *
 * Presentation only. It draws what the caller already read from the services and decides
 * nothing: access, ending and Turn Off stay in the services and the caller's existing actions,
 * passed in untouched through `actions`. Flat: tokens only, no shadow, no gradient. The ring is
 * drawn at its final state; nothing moves, so reduced motion has nothing to switch off.
 */

/** One thing the app can read, in the consent screen's own words. */
export interface AiTileRead {
  readonly key: string;
  readonly icon: IconName;
  /** The consent label, verbatim (Title Case). */
  readonly label: ReactNode;
  /** One plain sentence: what that means. Shown on hover, focus or tap. */
  readonly note: ReactNode;
  /** A short value beside the label, for example Yes or No. */
  readonly value?: ReactNode;
}

/** A labelled fact in the tile's list (Connected, Ends, Last Used...), already in the page language. */
export interface AiTileFact {
  readonly key: string;
  readonly term: ReactNode;
  readonly value: ReactNode;
}

/** One group of pictures, under its own term (or none, when each picture names itself). */
export interface AiTileGroup {
  readonly key: string;
  readonly term?: ReactNode;
  readonly reads: readonly AiTileRead[];
  /** A line of its own, shown when the group has nothing to draw ("Nothing from this record"). */
  readonly empty?: ReactNode;
}

export interface AiConnectionTileProps {
  /** For the tile's heading id; unique on the page. */
  readonly id: string;
  readonly appName: string;
  /** The app's site (claude.ai), or null when unknown. Both are cleaned here, as stored by the app. */
  readonly appHost: string | null;
  /** What the app can read and do, group by group, in order. */
  readonly groups: readonly AiTileGroup[];
  /** Facts beside the clock, in order (from `aiConnectionFacts`). */
  readonly facts: readonly AiTileFact[];
  readonly timeLeft: AiTimeLeft;
  /** When an ended connection ended, already written in the person's zone, when it is known. */
  readonly endedOn?: string | undefined;
  /** The connection's actions, unchanged (Change Access, Turn Off). */
  readonly actions?: ReactNode;
}

/**
 * Connected, (Connected By,) Ends and Last Used: one builder for every tile, in the traveller
 * Sharing page's own words (one translation for both views). An ended connection has no Ends
 * fact; the clock says when it ended.
 */
export function aiConnectionFacts({
  connectedAt,
  end,
  lastUsedAt,
  timeLeft,
  timeZone,
  connectedBy,
}: {
  readonly connectedAt: Date;
  readonly end: Date | null;
  readonly lastUsedAt: Date | null;
  readonly timeLeft: AiTimeLeft;
  /** The person's zone; `undefined` keeps the shared formatters (staff have no stored zone). */
  readonly timeZone: string | null | undefined;
  readonly connectedBy?: AiTileFact | undefined;
}): AiTileFact[] {
  const t = getServerT(applicantSharingCatalog);
  return [
    {
      key: 'connected',
      term: t.node('applicantSharing.appApplicantIdSharingAiConnections.connected'),
      value: formatDayIn(connectedAt, timeZone),
    },
    ...(connectedBy ? [connectedBy] : []),
    ...(timeLeft.state === 'ended'
      ? []
      : [
          {
            key: 'ends',
            term: t.node('applicantSharing.appApplicantIdSharingAiConnections.ends'),
            value: end
              ? formatMomentIn(end, timeZone)
              : t.node('applicantSharing.appApplicantIdSharingAiConnections.untilYouTurnItOff'),
          },
        ]),
    {
      key: 'last_used',
      term: t.node('applicantSharing.appApplicantIdSharingAiConnections.lastUsed'),
      value: lastUsedAt
        ? formatMomentIn(lastUsedAt, timeZone)
        : t.node('applicantSharing.appApplicantIdSharingAiConnections.notUsedYet'),
    },
  ];
}

/** When an ended connection ended, if its end has passed (an early Turn Off has no date here). */
export function aiConnectionEndedOn(
  end: Date | null,
  now: Date,
  timeZone: string | null | undefined,
): string | undefined {
  return end && end.getTime() <= now.getTime() ? formatMomentIn(end, timeZone) : undefined;
}

/** The ring's share drawn, in hundredths (pathLength 100). */
function ringPercent(timeLeft: AiTimeLeft): number {
  if (timeLeft.state === 'open') return 100;
  if (timeLeft.state === 'ended') return 0;
  // Never draw an empty ring while time is left, and never a full one (that is the open
  // connection's ring), so the shape alone tells them apart without colour.
  return Math.min(98, Math.max(2, Math.round(timeLeft.fraction * 100)));
}

function ClockRing({ timeLeft }: { readonly timeLeft: AiTimeLeft }) {
  const percent = ringPercent(timeLeft);
  return (
    <span className="ai-tile-ring" data-state={timeLeft.state} aria-hidden="true">
      <svg viewBox="0 0 44 44" width="44" height="44" focusable="false" aria-hidden="true">
        <circle className="ai-tile-ring-track" cx="22" cy="22" r="19" fill="none" />
        {percent > 0 ? (
          <circle
            className="ai-tile-ring-fill"
            cx="22"
            cy="22"
            r="19"
            fill="none"
            pathLength={100}
            strokeDasharray={`${percent} ${100 - percent}`}
            transform="rotate(-90 22 22)"
          />
        ) : null}
      </svg>
      <Icon name="clock" size={18} />
    </span>
  );
}

/** The time left in words, the same words beside the ring for everyone. */
function TimeLeftWords({
  timeLeft,
  endedOn,
}: {
  readonly timeLeft: AiTimeLeft;
  readonly endedOn: string | undefined;
}) {
  const t = getServerT(componentsCatalog);
  if (timeLeft.state === 'open') return null;
  if (timeLeft.state === 'ended') {
    return (
      <span className="ai-tile-left">
        {endedOn
          ? t.node('components.aiConnectionTile.endedOn', { date: endedOn })
          : t.node('components.aiConnectionTile.ended')}
      </span>
    );
  }
  const left =
    timeLeft.hoursLeft === null
      ? t.node('components.aiConnectionTile.daysLeft', { count: timeLeft.daysLeft ?? 0 })
      : timeLeft.hoursLeft < 1
        ? t.node('components.aiConnectionTile.lessThanOneHourLeft')
        : t.node('components.aiConnectionTile.hoursLeft', { count: timeLeft.hoursLeft });
  return (
    <span className="ai-tile-left">
      {left}
      {timeLeft.state === 'ending_soon' ? (
        <>
          {/* A pause for screen readers between the time left and the warning. */}
          <span className="sr-only">, </span>
          <span className="ai-tile-soon">{t.node('components.aiConnectionTile.endingSoon')}</span>
        </>
      ) : null}
    </span>
  );
}

function ReadList({ reads }: { readonly reads: readonly AiTileRead[] }) {
  return (
    <ul className="status-picture-key ai-tile-read-list">
      {reads.map((read) => (
        <li className="ai-tile-read" key={read.key}>
          <ExplainTip
            label={
              read.value === undefined ? (
                read.label
              ) : (
                <>
                  {read.label}: {read.value}
                </>
              )
            }
            text={read.note}
          >
            <Icon name={read.icon} size={20} />
          </ExplainTip>
          {/* The button above already carries the name; the visible words are for the eye. */}
          <span className="ai-tile-read-word" aria-hidden="true">
            {read.label}
            {read.value === undefined ? null : (
              <>
                {' '}
                <span className="ai-tile-read-value">{read.value}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AiConnectionTile({
  id,
  appName,
  appHost,
  groups,
  facts,
  timeLeft,
  endedOn,
  actions,
}: AiConnectionTileProps) {
  const titleId = `ai-tile-${id}`;
  // The app chose its own name and address: hidden and direction-changing characters are
  // removed and the length is capped, the same cleaning every other AI app label gets.
  const name = aiAppName(appName);
  const host = aiAppHost(appHost);
  return (
    // A plain group, not a landmark: the card around the tiles is the page section, and each
    // tile is found by its heading.
    <div className="ai-tile" data-ai-tile="">
      <div className="ai-tile-head">
        <span className="ai-tile-mark" aria-hidden="true">
          <Icon name="key" size={22} />
        </span>
        <h3 className="ai-tile-name" id={titleId}>
          {name} {host ? <span className="ai-consent-host">{host}</span> : null}
        </h3>
      </div>
      {groups.map((group) =>
        group.reads.length > 0 || group.empty ? (
          <div className="ai-tile-reads" key={group.key} data-group={group.key}>
            {group.term ? <p className="ai-tile-term">{group.term}</p> : null}
            {group.reads.length > 0 ? (
              <ReadList reads={group.reads} />
            ) : (
              <p className="ai-tile-read-none">{group.empty}</p>
            )}
          </div>
        ) : null,
      )}
      <div className="ai-tile-clock" data-state={timeLeft.state}>
        <ClockRing timeLeft={timeLeft} />
        <div className="ai-tile-when">
          <TimeLeftWords timeLeft={timeLeft} endedOn={endedOn} />
          <dl className="ai-tile-facts">
            {facts.map((fact) => (
              <div key={fact.key}>
                <dt>{fact.term}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {actions ? <div className="ai-tile-actions">{actions}</div> : null}
    </div>
  );
}
