import type { LifecycleMeasures } from '@visastack/services';

/** One figure against its starting target, in plain words. */
interface MeasureRow {
  readonly label: string;
  readonly value: string;
  readonly target: string;
  /** null: not enough data yet to say. */
  readonly withinTarget: boolean | null;
}

const percent = (value: number | null) => (value === null ? 'No data yet' : `${value}%`);
const per100 = (value: number | null) => (value === null ? 'No data yet' : `${value} per 100`);

/** The PROGRAMME section 9 measures, as rows the scorecard shows. */
export function lifecycleMeasureRows(measures: LifecycleMeasures): readonly MeasureRow[] {
  const { reminderToReplacement: reminders, duplicatesKept, restores } = measures;
  const rows: MeasureRow[] = [
    {
      label: 'Expiry Reminders Followed by a Replacement Within 14 Days',
      value: `${percent(reminders.percent)} (${reminders.replacedWithin14Days} of ${reminders.reminded})`,
      target: `At least ${reminders.target}%`,
      withinTarget: reminders.percent === null ? null : reminders.percent >= reminders.target,
    },
    {
      label: 'Exact Duplicates Kept',
      value: `${per100(duplicatesKept.per100)} (${duplicatesKept.duplicates} of ${duplicatesKept.documents} documents)`,
      target: `Under ${duplicatesKept.target} per 100`,
      withinTarget:
        duplicatesKept.per100 === null ? null : duplicatesKept.per100 < duplicatesKept.target,
    },
    {
      label: 'Restores After Archive or Delete, Last 30 Days',
      value: `${per100(restores.per100)} (${restores.restores} of ${restores.deletionsAndArchives})`,
      target: `Under ${restores.target} per 100`,
      withinTarget: restores.per100 === null ? null : restores.per100 < restores.target,
    },
  ];
  const removal = measures.removalDecisions;
  rows.push(
    removal
      ? {
          label: 'Removal Requests: Median Time to a Decision',
          value:
            removal.medianWorkingDays === null
              ? 'No decisions yet'
              : `${removal.medianWorkingDays} working days (${removal.decided} decided, ${removal.overThirtyDays} over ${removal.targetMaxDays} days)`,
          target: `${removal.targetMedian} working days or less, none over ${removal.targetMaxDays} days`,
          withinTarget:
            removal.overThirtyDays > 0
              ? false
              : removal.medianWorkingDays === null
                ? null
                : removal.medianWorkingDays <= removal.targetMedian,
        }
      : {
          label: 'Removal Requests: Median Time to a Decision',
          value: 'Not available until the removal tables are in place',
          target: '3 working days or less, none over 30 days',
          withinTarget: null,
        },
  );
  return rows;
}

const BADGE: Readonly<Record<'yes' | 'no' | 'unknown', { tone: string; label: string }>> = {
  yes: { tone: 'badge-success', label: 'Within Target' },
  no: { tone: 'badge-warning', label: 'Outside Target' },
  unknown: { tone: 'badge-neutral', label: 'Too Early to Say' },
};

/** Archive, replace and removal measures on the Product Scorecard (resource lifecycle, lane Z). */
export function LifecycleMeasuresCard({
  measures,
}: {
  readonly measures: LifecycleMeasures | 'restricted' | 'unavailable';
}) {
  return (
    <article className="card u-mb-150" aria-labelledby="lifecycle-measures-title">
      <p className="card-kicker">Starting Targets</p>
      <h2 className="card-title" id="lifecycle-measures-title">
        Archive, Replace and Removal
      </h2>
      {measures === 'restricted' ? (
        <p className="card-body">
          These figures are counted over people&apos;s records, so they show only to staff with the
          privacy directory role.
        </p>
      ) : measures === 'unavailable' ? (
        <p role="alert">These figures could not be read just now. No trend is inferred.</p>
      ) : (
        <>
          <p className="card-body u-mb-100">
            Counts only, never a name or a file. Targets are a starting point, to confirm after 30
            days of pilot use. Deleted items shown anywhere: none, checked on every build.
          </p>
          <dl className="rows">
            {lifecycleMeasureRows(measures).map((row) => {
              const badge =
                BADGE[row.withinTarget === null ? 'unknown' : row.withinTarget ? 'yes' : 'no'];
              return (
                <div className="row" key={row.label}>
                  <dt className="row-key">{row.label}</dt>
                  <dd className="row-end">
                    <span className="muted u-fs-085">
                      {row.value}. Target: {row.target}.
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </article>
  );
}
