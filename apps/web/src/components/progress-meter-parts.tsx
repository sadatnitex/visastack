'use client';

import { componentsUiLiftCatalog } from '../i18n/components-ui-lift';
import { useT } from './i18n-provider';

/**
 * The two pieces of ProgressMeter that say words. They live outside the ui-lift folder because
 * that folder holds no client modules, and the meter must work in both server and client screens.
 * The numbers go to the message as raw numbers: the runtime formats them in the language the
 * message is written in.
 */
export function ProgressMeterFigure({
  value,
  max,
  label,
  size,
  percent,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly size: number;
  readonly percent: number;
}) {
  const t = useT(componentsUiLiftCatalog);
  return (
    <svg
      className="lift-meter-svg"
      role="img"
      aria-label={t('componentsUiLift.progressMeter.meterName', { value, max, label })}
      {...t.lang('componentsUiLift.progressMeter.meterName')}
      width="100%"
      height={size}
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
    >
      <rect className="lift-meter-track" x="0" y="0" width="100" height="10" />
      <rect className="lift-meter-fill" x="0" y="0" width={percent} height="10" />
    </svg>
  );
}

/** The default words beside the bar, for example "6 of 12". */
export function ProgressMeterWords({
  value,
  max,
}: {
  readonly value: number;
  readonly max: number;
}) {
  const t = useT(componentsUiLiftCatalog);
  return <>{t.node('componentsUiLift.progressMeter.meterWords', { value, max })}</>;
}
