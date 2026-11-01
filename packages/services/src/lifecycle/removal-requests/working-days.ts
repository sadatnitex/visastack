/** How long support has to decide a removal request before staff are alerted (lanes/D.md item 6). */
export const REMOVAL_ALERT_WORKING_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * `from` moved forward by `days` working days (Monday to Friday, UTC). A request made on a
 * weekend starts counting on the next Monday.
 */
export function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let left = Math.max(0, Math.trunc(days));
  while (left > 0) {
    result.setTime(result.getTime() + DAY_MS);
    if (!isWeekend(result)) left -= 1;
  }
  return result;
}

/** Whole working days (Monday to Friday, UTC) between `from` and `to`; 0 when `to` is earlier. */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let count = 0;
  const cursor = new Date(from.getTime());
  for (;;) {
    cursor.setTime(cursor.getTime() + DAY_MS);
    if (cursor.getTime() > to.getTime()) return count;
    if (!isWeekend(cursor)) count += 1;
  }
}
