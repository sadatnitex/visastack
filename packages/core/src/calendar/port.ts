import type { CalendarEvent } from './model';
import type { CalendarExportOptions } from './options';

/**
 * Where calendar events go. Today there is no implementation: the one-time file is a plain
 * download built with `serializeCalendar`. This interface is the seam later destinations plug
 * into, each built from the same `CalendarEvent` list and `CalendarExportOptions`:
 *
 * - a live feed (a per-person, revocable secret address that calendar apps poll): needs a token
 *   table and migration, a revoke control, and the owner's approval;
 * - Google or Microsoft calendar adapters (in packages/adapters, behind this port): need the
 *   owner's word and the v1.2 rule of no OAuth and no calendar credentials to be lifted.
 *
 * `publish` returns where the events went (a feed address, an adapter's own id) or an error;
 * `revoke` stops a feed or removes what an adapter wrote.
 */
export interface CalendarPublisher {
  publish(
    events: readonly CalendarEvent[],
    options: CalendarExportOptions,
  ): Promise<
    | { readonly ok: true; readonly reference: string }
    | { readonly ok: false; readonly reason: string }
  >;
  revoke?(reference: string): Promise<void>;
}
