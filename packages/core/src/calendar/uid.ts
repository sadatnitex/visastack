import type { CalendarKind } from './kinds';
import { sha256Hex } from './sha256';

/**
 * The permanent UID scheme. A calendar app matches events by UID, so once people have imported a
 * file this rule must never change: a new rule would put every date in their calendar twice.
 *
 *   uid = first 32 hex characters of sha256("visastack:v1:<kind>:<resourceId>") + "@visastack"
 *
 * Opaque (no record id is readable from it), stable (the same record always gives the same UID,
 * in a one-time file, a future feed or an adapter) and namespaced by kind, so two kinds never
 * collide. A future scheme would be a new version prefix, used only for new kinds of event.
 */
export const CALENDAR_UID_NAMESPACE = 'visastack:v1';

export function calendarUid(kind: CalendarKind, resourceId: string): string {
  return `${sha256Hex(`${CALENDAR_UID_NAMESPACE}:${kind}:${resourceId}`).slice(0, 32)}@visastack`;
}
