import {
  accountPrincipal,
  getAppointment,
  recordCalendarExport,
  requireAccess,
} from '@visastack/services';
import { buildIcsForAppointment } from '../../../../../../../lib/ics';
import { withSession } from '../../../../../../../lib/session';

/**
 * Commercial V1 Part 4 §11: "Appointment: ... add-to-calendar file/download."
 *
 * Owner only: the central access gate on the case as its owner (`purpose: 'self'`), then the
 * owner-checked appointment read. The file goes through the shared calendar core, so it has the
 * same permanent opaque UID as the same appointment in the dates file, and a SEQUENCE from the
 * appointment's last change, so importing a newer file replaces the older copy. The file name is
 * generic (no ids or names), and each download writes one audit entry, as the dates file does;
 * when that entry cannot be written, no file is sent.
 */
export const dynamic = 'force-dynamic';

const APPOINTMENT_FILE_NAME = 'visastack-appointment.ics';

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
): Promise<Response> {
  const { id, appointmentId } = await params;

  const outcome = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId: id },
      { purpose: 'self' },
    );
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') {
      return { state: 'not_found' as const };
    }
    const result = await getAppointment(db, accountId, id, appointmentId);
    if (!result.ok) return { state: 'not_found' as const };
    const appointment = result.value;
    const ics = buildIcsForAppointment({
      id: appointment.id,
      title: appointment.title,
      localDateTime: appointment.localDateTime,
      timezone: appointment.timezone,
      place: appointment.place,
      channel: appointment.channel,
      updatedAt: appointment.updatedAt,
    });
    const recorded = await recordCalendarExport(access.value, {
      eventCount: 1,
      kinds: ['appointment'],
      source: 'appointment',
    });
    return recorded.ok ? { state: 'ready' as const, ics } : { state: 'failed' as const };
  });

  if (outcome.state === 'not_found') {
    return new Response('not found', { status: 404, headers: PRIVATE });
  }
  if (outcome.state === 'failed') {
    return new Response('The calendar file could not be made. Please try again.', {
      status: 500,
      headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(outcome.ics, {
    status: 200,
    headers: {
      ...PRIVATE,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${APPOINTMENT_FILE_NAME}"`,
    },
  });
}
