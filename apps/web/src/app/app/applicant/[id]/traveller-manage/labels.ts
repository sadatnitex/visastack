/*
 * Traveller action words that browser code may import (LC-E). No import from the services
 * package here: a value import from it would pull server-only code into the browser bundle.
 */

export const TRAVELLER_ACTION_LABELS = {
  ARCHIVE: 'Archive Traveller',
  RESTORE: 'Restore Traveller',
  REMOVE_EMPTY: 'Remove Empty Record',
  RESTORE_DELETED: 'Restore Traveller',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Removed in N Days" for a record in Recently Deleted, counted the same way as the Removal
 * Record list (components/lifecycle/removal-record-list.tsx), so both always show the same number.
 */
export function removedInDays(purgeAfter: Date, now: Date = new Date()): string {
  const days = Math.max(0, Math.ceil((purgeAfter.getTime() - now.getTime()) / DAY_MS));
  return days === 1 ? 'Removed in 1 Day' : `Removed in ${days} Days`;
}
