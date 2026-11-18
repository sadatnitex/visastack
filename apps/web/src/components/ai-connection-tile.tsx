import type { ReactNode } from 'react';
import { componentsCatalog } from '../i18n/components';
import type { AiTimeLeft } from '../lib/ai-connection-time-left';
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

export interface AiConnectionTileProps {
  /** For the tile's heading id; unique on the page. */
  readonly id: string;
  readonly appName: string;
  /** The app's site (claude.ai), or null when unknown. */
  readonly appHost: string | null;
  /** The term above the pictures ("Can Read"). */
  readonly readsTerm: ReactNode;
  readonly reads: readonly AiTileRead[];
  /** A line shown above the pictures when the app can read nothing from the record itself. */
  readonly readsEmpty?: ReactNode;
  /** Facts beside the clock, in order (Connected, Ends, Last Used, and any the screen adds). */
  readonly facts: readonly AiTileFact[];
  readonly timeLeft: AiTimeLeft;
  /** The connection's actions, unchanged (Change Access, Turn Off). */
  readonly actions?: ReactNode;
}

/** The ring's share drawn, in hundredths (pathLength 100). */
function ringPercent(timeLeft: AiTimeLeft): number {
  if (timeLeft.state === 'open') return 100;
  if (timeLeft.state === 'ended') return 0;
  // Never draw an empty ring while time is left: at least a sliver shows.
  return Math.max(2, Math.round(timeLeft.fraction * 100));
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
function TimeLeftWords({ timeLeft }: { readonly timeLeft: AiTimeLeft }) {
  const t = getServerT(componentsCatalog);
  if (timeLeft.state === 'open') return null;
  if (timeLeft.state === 'ended') {
    return <span className="ai-tile-left">{t.node('components.aiConnectionTile.ended')}</span>;
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
        <span className="ai-tile-soon">{t.node('components.aiConnectionTile.endingSoon')}</span>
      ) : null}
    </span>
  );
}

export function AiConnectionTile({
  id,
  appName,
  appHost,
  readsTerm,
  reads,
  readsEmpty,
  facts,
  timeLeft,
  actions,
}: AiConnectionTileProps) {
  const titleId = `ai-tile-${id}`;
  return (
    <section className="ai-tile" aria-labelledby={titleId} data-ai-tile="">
      <div className="ai-tile-head">
        <span className="ai-tile-mark" aria-hidden="true">
          <Icon name="key" size={22} />
        </span>
        <h3 className="ai-tile-name" id={titleId}>
          {appName} {appHost ? <span className="ai-consent-host">{appHost}</span> : null}
        </h3>
      </div>
      <div className="ai-tile-reads">
        <p className="ai-tile-term">{readsTerm}</p>
        {readsEmpty ? <p className="ai-tile-read-none">{readsEmpty}</p> : null}
        {reads.length > 0 ? (
          <ul className="ai-tile-read-list">
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
        ) : null}
      </div>
      <div className="ai-tile-clock" data-state={timeLeft.state}>
        <ClockRing timeLeft={timeLeft} />
        <div className="ai-tile-when">
          <TimeLeftWords timeLeft={timeLeft} />
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
    </section>
  );
}
