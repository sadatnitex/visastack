'use client';

import { useEffect, useId, useState } from 'react';
import {
  COMMON_TIME_ZONES,
  type TimeZoneGroups,
  deviceTimeZone,
  groupTimeZones,
  listTimeZones,
} from '../lib/time-zones';

/**
 * A time zone chosen from a list instead of typed. The form still receives the IANA name
 * ("Asia/Dhaka") under `name`, so the actions behind it do not change.
 *
 * It first renders a short, fixed list (the usual places) so the server and the browser agree and
 * the form works at once; once mounted it swaps in every zone, grouped by region and labelled with
 * its offset, and picks this device's zone unless the person already chose one.
 */
export function TimeZoneSelect({
  name,
  label = 'Time Zone',
  defaultValue,
  required = true,
  className,
}: {
  name: string;
  /** The accessible name of the control. */
  label?: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? '');
  const [full, setFull] = useState<TimeZoneGroups | null>(null);

  useEffect(() => {
    const device = deviceTimeZone();
    setFull(groupTimeZones(listTimeZones(new Date()), device));
    if (!defaultValue && device) setValue((current) => current || device);
  }, [defaultValue]);

  return (
    <select
      id={id}
      name={name}
      aria-label={label}
      className={`input tz-select${className ? ` ${className}` : ''}`}
      required={required}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    >
      <option value="">Choose a Time Zone</option>
      {full ? (
        <>
          <optgroup label="Common">
            {full.common.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
          {full.groups.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </>
      ) : (
        <optgroup label="Common">
          {COMMON_TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone === 'UTC' ? 'UTC' : (zone.split('/').pop() ?? zone).replaceAll('_', ' ')}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
