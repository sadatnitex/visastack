import { useT } from '../../components/i18n-provider';
import { collectCatalog } from '../../i18n/collect';
/**
 * How long, after the request closes, the agency may keep the guest's files (UMPE P8, owner 2 Nov).
 * One of the offered periods, with nothing preselected: the guest chooses. A legal hold overrides
 * the choice, and the words say so. A plain fieldset with no state of its own, so the submission
 * form that comes with uploads (P9) can reuse it as it is.
 */

export function RetentionChoice({
  agencyName,
  value,
  periods,
  name = 'retentionDays',
  idPrefix = 'retention',
  describedBy,
  invalid = false,
}: {
  /** The reviewed agency's name, or null for an unnamed agency. */
  readonly agencyName: string | null;
  /** The saved choice, or null when none has been made (nothing is preselected). */
  readonly value: number | null;
  /** The offered periods in days, from the service (`GUEST_RETENTION_DAYS`), so they never drift. */
  readonly periods: readonly number[];
  readonly name?: string;
  readonly idPrefix?: string;
  /** The id of a message that explains a problem with the choice. */
  readonly describedBy?: string;
  readonly invalid?: boolean;
}) {
  const t = useT(collectCatalog);
  const who = agencyName ?? 'The agency';
  const hintId = `${idPrefix}-hint`;
  return (
    <fieldset
      className="form-section collect-retention"
      aria-describedby={describedBy ? `${hintId} ${describedBy}` : hintId}
      aria-invalid={invalid || undefined}
    >
      <legend>{t('collect.collectRetentionChoice.howLongWhoMayKeepYour', { who })}</legend>
      <p id={hintId} className="muted u-fs-085">
        {t('collect.collectRetentionChoice.chooseHowManyDaysAfterThis', { who })}
      </p>
      <div className="collect-retention-options">
        {periods.map((days) => (
          <label key={days} className="collect-retention-option" htmlFor={`${idPrefix}-${days}`}>
            <input
              id={`${idPrefix}-${days}`}
              type="radio"
              name={name}
              value={days}
              required
              defaultChecked={value === days}
            />
            <span className="collect-retention-days">
              <span className="collect-retention-number">{days}</span>{' '}
              <span className="collect-retention-unit">
                {t('collect.collectRetentionChoice.days')}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
