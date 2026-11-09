'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  COMMON_TIME_ZONES,
  type TimeZoneGroups,
  describeTimeZone,
  deviceTimeZone,
  groupTimeZones,
  listTimeZones,
  modernZoneId,
} from '../lib/time-zones';

/**
 * The full grouped list is about 420 zones, each formatted once. It is built at most once per page
 * and shared by every select on it (a case page holds two), and only when a select is about to be
 * seen, so a page whose selects are folded away or far down pays nothing for them.
 */
let shared: { readonly device: string | null; readonly groups: TimeZoneGroups } | null = null;
function fullTimeZones(): TimeZoneGroups {
  const reported = deviceTimeZone();
  const device = reported ? modernZoneId(reported) : null;
  if (!shared || shared.device !== device) {
    shared = { device, groups: groupTimeZones(listTimeZones(new Date()), device) };
  }
  return shared.groups;
}

/** How far before the screen a select starts building its list, so it is ready before it is touched. */
const BUILD_MARGIN = '200px';

/**
 * A time zone chosen from a list instead of typed. The form still receives the IANA name
 * ("Asia/Dhaka") under `name`, so the actions behind it do not change.
 *
 * It first renders a short, fixed list (the usual places) so the server and the browser agree and
 * the form works at once, and picks this device's zone unless the person already chose one (a zone
 * outside the usual places gets its own single option). Every zone, grouped by region and labelled
 * with its offset, is swapped in once the select is near the screen. Without a way to watch the
 * screen it is built the moment the person reaches for the list.
 */
export function TimeZoneSelect({
  id: givenId,
  name,
  label = 'Time Zone',
  defaultValue,
  required = true,
  className,
}: {
  /** Set when a visible `<label htmlFor>` names the control; `label` is then not used. */
  id?: string;
  name: string;
  /** The accessible name of the control when no visible label points at it. */
  label?: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  const ownId = useId();
  const id = givenId ?? ownId;
  const select = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(defaultValue ?? '');
  const [full, setFull] = useState<TimeZoneGroups | null>(null);

  useEffect(() => {
    const device = deviceTimeZone();
    if (!defaultValue && device) setValue((current) => current || modernZoneId(device));
  }, [defaultValue]);

  // Build the full list when the select comes near the screen. An observer never reports content
  // that is not drawn (display:none, a closed fold), so those selects build nothing.
  useEffect(() => {
    const el = select.current;
    if (!el || full) return;
    const build = () => setFull(fullTimeZones());
    if (typeof IntersectionObserver === 'undefined') {
      el.addEventListener('focus', build, { once: true });
      el.addEventListener('pointerdown', build, { once: true });
      return () => {
        el.removeEventListener('focus', build);
        el.removeEventListener('pointerdown', build);
      };
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watcher.disconnect();
          build();
        }
      },
      { rootMargin: BUILD_MARGIN },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [full]);

  // React resets a form after its action runs, which puts the list back on its first option while
  // the chosen zone stays in state; show the starting zone again so screen and state agree.
  useEffect(() => {
    const form = select.current?.form;
    if (!form) return;
    const restore = () =>
      window.setTimeout(() => {
        const device = deviceTimeZone();
        const start = defaultValue || (device ? modernZoneId(device) : '');
        setValue(start);
        if (select.current) select.current.value = start;
      });
    form.addEventListener('reset', restore);
    return () => form.removeEventListener('reset', restore);
  }, [defaultValue]);

  // The starting zone is not one of the usual places: it gets one option of its own until the full
  // list is built, so the select shows it at once.
  const extra =
    value && !full && !COMMON_TIME_ZONES.includes(value)
      ? describeTimeZone(value, new Date())
      : null;

  return (
    <select
      ref={select}
      id={id}
      name={name}
      aria-label={givenId ? undefined : label}
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
        <>
          {extra ? (
            <option key={extra.id} value={extra.id}>
              {extra.label}
            </option>
          ) : null}
          <optgroup label="Common">
            {COMMON_TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone === 'UTC' ? 'UTC' : (zone.split('/').pop() ?? zone).replaceAll('_', ' ')}
              </option>
            ))}
          </optgroup>
        </>
      )}
    </select>
  );
}
