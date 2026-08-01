import { mbLabel } from '@visastack/services';

/**
 * A small usage bar for evidence-storage quotas — visible before a limit is
 * hit, not just after. `warnBytes` lets a caller supply an explicit,
 * independently-configured warning threshold (e.g. platform storage, where
 * the warning and hard-stop are two separately set figures); it defaults to
 * 85% of `limitBytes` for the common case of a single cap with no distinct
 * warning figure of its own.
 */
export function UsageMeter({
  label,
  usedBytes,
  limitBytes,
  warnBytes,
}: {
  readonly label: string;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly warnBytes?: number;
}) {
  const fraction = limitBytes > 0 ? Math.min(1, usedBytes / limitBytes) : 0;
  const warnThreshold = warnBytes ?? limitBytes * 0.85;
  const tone =
    usedBytes >= limitBytes ? 'meter-full' : usedBytes >= warnThreshold ? 'meter-warn' : '';
  return (
    <div>
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {mbLabel(usedBytes)} of {mbLabel(limitBytes)} used
        </span>
      </div>
      <div className="meter">
        <div
          className={`meter-fill ${tone}`.trim()}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
