import type { TripCheck, TripCheckLevel } from '@visastack/core';
import { Icon, type IconName } from '../../../../components/icons';
import { SectionCard, StatusPill } from '../../../../components/ui-lift';
import type { LiftTone } from '../../../../components/ui-lift';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { getServerT } from '../../../../lib/i18n-server';

/**
 * How the dates of a case line up with the passport and travel insurance on the profile. The
 * checks are worked out in the core package; this only shows them, one compact row each: a mark,
 * the title, the status in words and one quiet line of detail. They are common checks, never the
 * rule of a country, and the words say so.
 */

const LEVELS: Readonly<
  Record<
    TripCheckLevel,
    { readonly tone: LiftTone; readonly label: string; readonly icon: IconName }
  >
> = {
  problem: { tone: 'danger', label: 'Needs Fixing', icon: 'close' },
  check: { tone: 'warning', label: 'Take a Look', icon: 'alert' },
  unknown: { tone: 'neutral', label: 'Add a Detail', icon: 'circle' },
  ok: { tone: 'success', label: 'Looks Fine', icon: 'check' },
};

/** Worst first, so a row that stands for all the checks shows the one that most needs a look. */
const WORST_FIRST: readonly TripCheckLevel[] = ['problem', 'check', 'unknown', 'ok'];

/**
 * What a folded row says for the whole set of checks: one quiet line and the status of the worst
 * check. A set that could not be read, or is empty, has no status.
 */
export function tripChecksSummary(checks: readonly TripCheck[] | null): {
  readonly meta: string;
  readonly status: { readonly tone: LiftTone; readonly label: string } | null;
} {
  if (checks === null) return { meta: 'Could not be checked just now', status: null };
  if (checks.length === 0) return { meta: 'No date checks apply yet', status: null };
  const worst = WORST_FIRST.find((level) => checks.some((c) => c.level === level)) ?? 'ok';
  const level = LEVELS[worst];
  return {
    meta: `${checks.length} ${checks.length === 1 ? 'check' : 'checks'} on your trip dates`,
    status: { tone: level.tone, label: level.label },
  };
}

export function TripChecksPanel({ checks }: { readonly checks: readonly TripCheck[] | null }) {
  const t = getServerT(appMissionCatalog);
  return (
    <SectionCard
      kicker={t('appMission.appMissionIdTripChecksPanel.dates')}
      heading={t('appMission.appMissionIdCaseRail.tripDateChecks')}
      tone="teal"
    >
      {checks === null ? (
        <p className="muted lift-rail-line">
          {t('appMission.appMissionIdTripChecksPanel.weCouldNotCheckYourDates')}
        </p>
      ) : checks.length === 0 ? (
        <p className="muted lift-rail-line">
          {t('appMission.appMissionIdTripChecksPanel.noDateChecksApplyYet')}
        </p>
      ) : (
        <ul
          className="lift-trip-list"
          aria-label={t('appMission.appMissionIdTripChecksPanel.tripDateChecks')}
        >
          {checks.map((check) => {
            const level = LEVELS[check.level];
            return (
              <li className={`trip-check lift-trip lift-trip-${level.tone}`} key={check.key}>
                <span className="lift-mark" aria-hidden="true">
                  <Icon name={level.icon} size={14} />
                </span>
                <span className="lift-trip-title">{check.title}</span>
                <StatusPill tone={level.tone}>{level.label}</StatusPill>
                <span className="muted lift-trip-detail">{check.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      <details className="lift-help">
        <summary>{t('appMission.appMissionIdTripChecksPanel.aboutTheseChecks')}</summary>
        <div className="lift-help-body">
          <p className="muted">
            {t('appMission.appMissionIdTripChecksPanel.commonChecksOfYourTripDates')}
          </p>
        </div>
      </details>
    </SectionCard>
  );
}
