'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Select All" for one group of dates (WP-SB4): ticks or clears every date box in the same group,
 * and shows a part-ticked state when only some are ticked. It has no name, so it is never sent
 * with the form. Without scripts it is not shown at all (each date can still be ticked on its
 * own), so it never offers something that would not work.
 */
export function CalendarSelectAll({
  id,
  groupLabel,
}: {
  /** Unique on the page. */
  readonly id: string;
  /** The group's name, read with the box, for example "Appointments". */
  readonly groupLabel: string;
}) {
  const box = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState(false);

  /** The date boxes in this control's group (the closest collapsible group around it). */
  const dateBoxes = useCallback((): HTMLInputElement[] => {
    const group = box.current?.closest('.calendar-group');
    if (!group) return [];
    return Array.from(group.querySelectorAll<HTMLInputElement>('input[data-calendar-date]'));
  }, []);

  /** Mirrors the group: ticked when every date is, part-ticked when some are. */
  const sync = useCallback(() => {
    const boxes = dateBoxes();
    const ticked = boxes.filter((item) => item.checked).length;
    setChecked(boxes.length > 0 && ticked === boxes.length);
    if (box.current) box.current.indeterminate = ticked > 0 && ticked < boxes.length;
  }, [dateBoxes]);

  useEffect(() => {
    setRunning(true);
  }, []);

  useEffect(() => {
    if (!running) return;
    sync();
    const group = box.current?.closest('.calendar-group');
    const form = box.current?.form;
    if (!group) return;
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches('[data-calendar-date]'))
        sync();
    };
    // A form reset puts the boxes back after this event, so read them on the next turn.
    const onReset = () => window.setTimeout(sync, 0);
    group.addEventListener('change', onChange);
    form?.addEventListener('reset', onReset);
    return () => {
      group.removeEventListener('change', onChange);
      form?.removeEventListener('reset', onReset);
    };
  }, [running, sync]);

  if (!running) return null;
  return (
    <label className="check calendar-select-all" htmlFor={id}>
      <input
        ref={box}
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          for (const item of dateBoxes()) item.checked = next;
          sync();
        }}
      />
      <span>
        Select All<span className="sr-only"> {groupLabel}</span>
      </span>
    </label>
  );
}
