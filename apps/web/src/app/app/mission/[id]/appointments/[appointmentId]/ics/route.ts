import { getAppointment } from '@visastack/services';
import { buildIcsForAppointment } from '../../../../../../../lib/ics';
import { withSession } from '../../../../../../../lib/session';

/**
 * Commercial V1 Part 4 §11: "Appointment: ... add-to-calendar file/download."
 * Owner-only, mirrors the snapshot download route's shape exactly.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
): Promise<Response> {
  const { id, appointmentId } = await params;

  const appointment = await withSession(async ({ db, accountId }) => {
    const result = await getAppointment(db, accountId, id, appointmentId);
    return result.ok ? result.value : null;
  });

  if (!appointment) return new Response('not found', { status: 404 });

  const ics = buildIcsForAppointment({
    id: appointment.id,
    title: appointment.title,
    localDateTime: appointment.localDateTime,
    timezone: appointment.timezone,
    place: appointment.place,
    channel: appointment.channel,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${appointment.id}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
