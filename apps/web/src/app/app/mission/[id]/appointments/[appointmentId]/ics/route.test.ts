import { calendarUid } from '@visastack/core/calendar';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getAppointment: vi.fn(),
  recordCalendarExport: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  getAppointment: mocks.getAppointment,
  recordCalendarExport: mocks.recordCalendarExport,
}));
vi.mock('../../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { GET } = await import('./route');

const APPOINTMENT_ID = '20000000-0000-4000-8000-000000000001';
const MISSION_ID = '30000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: MISSION_ID, appointmentId: APPOINTMENT_ID }) };
const request = () => new Request('https://vs.example.test/ics');
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } },
  });
  mocks.getAppointment.mockResolvedValue({
    ok: true,
    value: {
      id: APPOINTMENT_ID,
      missionId: MISSION_ID,
      title: 'Biometrics',
      localDateTime: new Date('2026-11-03T09:30:00.000Z'),
      timezone: 'Asia/Dhaka',
      place: null,
      channel: null,
      updatedAt: new Date('2026-10-20T08:00:00.000Z'),
    },
  });
  mocks.recordCalendarExport.mockResolvedValue({ ok: true, value: undefined });
});

describe('single appointment calendar file', () => {
  it('checks the case through the gate as its owner', async () => {
    await GET(request(), params);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'VIEW_METADATA',
      { missionId: MISSION_ID },
      { purpose: 'self' },
    );
  });

  it('has a generic file name and private headers, with no id in the name', async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="visastack-appointment.ics"',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).not.toContain(APPOINTMENT_ID);
  });

  it('uses the same opaque UID as the dates file and no raw id anywhere', async () => {
    const ics = unfold(await (await GET(request(), params)).text());
    expect(ics).toContain(`UID:${calendarUid('appointment', APPOINTMENT_ID)}`);
    expect(ics).not.toContain(APPOINTMENT_ID);
    expect(ics).not.toContain(MISSION_ID);
  });

  it('writes one audit entry for the file, and sends no file when it cannot', async () => {
    await GET(request(), params);
    expect(mocks.recordCalendarExport).toHaveBeenCalledTimes(1);
    expect(mocks.recordCalendarExport.mock.calls[0]?.[1]).toEqual({
      eventCount: 1,
      kinds: ['appointment'],
      source: 'appointment',
    });
    mocks.recordCalendarExport.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } });
    const failed = await GET(request(), params);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('Content-Type')).not.toContain('text/calendar');
  });

  it('is not found for anyone but the owner, writing nothing', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    expect((await GET(request(), params)).status).toBe(404);
    mocks.requireAccess.mockResolvedValueOnce({
      ok: true,
      value: { actor: { kind: 'grant_recipient', applicantId: 'a1' } },
    });
    expect((await GET(request(), params)).status).toBe(404);
    mocks.getAppointment.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    expect((await GET(request(), params)).status).toBe(404);
    expect(mocks.recordCalendarExport).not.toHaveBeenCalled();
  });
});
