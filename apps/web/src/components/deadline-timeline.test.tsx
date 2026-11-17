import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import { DeadlineTimeline, buildTimeline } from './deadline-timeline';

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  getReminderThresholds: vi.fn(),
  listIssuerVerificationsForDocument: vi.fn(),
  listMissions: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));

/**
 * The deadline timeline: today, the next appointment, the passport end and the trip start on one
 * wrapping line, each a small picture with its date and a short word. Every date comes from data
 * the Expiry page already loads; the passport gap uses the trip date checks that already exist.
 * Test dates are built from the clock the tests run on, never a fixed day near today.
 */

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
/** A calendar day `offset` days from today, as a date at UTC midnight (how dates are stored). */
const day = (offset: number): Date => new Date(midnight + offset * DAY);
const iso = (offset: number): string => day(offset).toISOString().slice(0, 10);

const base = {
  now,
  timezone: 'UTC',
  appointment: null,
  passportExpiry: null,
  travelStart: null,
  travelEnd: null,
} as const;

const kinds = (timeline: ReturnType<typeof buildTimeline>) =>
  timeline?.items.map((item) => item.kind) ?? [];

describe('buildTimeline', () => {
  it('is null when there is no date besides today, so the plain list stays', () => {
    expect(buildTimeline(base)).toBeNull();
  });

  it('puts today and each date in day order, whatever order they arrive in', () => {
    const timeline = buildTimeline({
      ...base,
      appointment: { date: iso(20), daysUntil: 20 },
      passportExpiry: day(900),
      travelStart: day(120),
    });
    expect(kinds(timeline)).toEqual(['today', 'appointment', 'trip', 'passport']);
  });

  it('puts a date that has already passed before today', () => {
    const timeline = buildTimeline({ ...base, travelStart: day(-3) });
    expect(kinds(timeline)).toEqual(['trip', 'today']);
    expect(timeline?.items[0]?.daysUntil).toBe(-3);
  });

  it('counts a due day as past only after it has ended in the traveller time zone', () => {
    // 23:30 on the 1st in UTC is 05:30 on the 2nd in Dhaka, so the 1st is already over there.
    const late = new Date(Date.UTC(2031, 0, 1, 23, 30));
    const timeline = buildTimeline({
      ...base,
      now: late,
      timezone: 'Asia/Dhaka',
      travelStart: new Date(Date.UTC(2031, 0, 1)),
    });
    expect(timeline?.items.find((item) => item.kind === 'trip')?.daysUntil).toBe(-1);
    const utc = buildTimeline({
      ...base,
      now: late,
      timezone: 'UTC',
      travelStart: new Date(Date.UTC(2031, 0, 1)),
    });
    expect(utc?.items.find((item) => item.kind === 'trip')?.daysUntil).toBe(0);
  });

  it('adds the existing passport warning when the passport ends within six months of the trip', () => {
    const timeline = buildTimeline({
      ...base,
      passportExpiry: day(150),
      travelStart: day(100),
    });
    expect(timeline?.warning).toEqual({
      title: 'Your passport has less than six months left after your trip starts',
    });
  });

  it('has no warning when the passport outlasts the trip by six months, or a date is missing', () => {
    expect(
      buildTimeline({ ...base, passportExpiry: day(900), travelStart: day(100) })?.warning,
    ).toBeNull();
    expect(buildTimeline({ ...base, passportExpiry: day(150) })?.warning).toBeNull();
    expect(buildTimeline({ ...base, travelStart: day(100) })?.warning).toBeNull();
  });

  it('draws the trip end too, and names it, when the case has one', () => {
    const timeline = buildTimeline({ ...base, travelStart: day(10), travelEnd: day(20) });
    expect(kinds(timeline)).toEqual(['today', 'trip', 'trip_end']);
    expect(timeline?.items[2]?.label).toBe('Trip Ends');
    expect(buildTimeline({ ...base, travelEnd: day(20) })?.items[1]?.label).toBe('Trip Ends');
  });

  it('measures the warning from the trip end when there is one, in the existing words', () => {
    const timeline = buildTimeline({
      ...base,
      passportExpiry: day(150),
      travelStart: day(10),
      travelEnd: day(100),
    });
    expect(timeline?.warning?.title).toBe(
      'Your passport has less than six months left after your trip ends',
    );
  });

  it('skips a date that does not parse instead of failing', () => {
    expect(buildTimeline({ ...base, passportExpiry: new Date('nope') })).toBeNull();
  });

  it('ignores a date that is not a real day', () => {
    const timeline = buildTimeline({
      ...base,
      appointment: { date: '2026-02-31', daysUntil: 5 },
    });
    expect(timeline).toBeNull();
  });
});

describe('DeadlineTimeline', () => {
  const timeline = buildTimeline({
    ...base,
    appointment: { date: iso(20), daysUntil: 20 },
    passportExpiry: day(150),
    travelStart: day(100),
  });

  it('draws one list item per date, each with a picture, a word and a real time element', () => {
    const html = renderToStaticMarkup(<DeadlineTimeline timeline={timeline} />);
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('Today');
    expect(html).toContain('Next Appointment');
    expect(html).toContain('Passport Ends');
    expect(html).toContain('Trip Starts');
    expect(html).toContain(`dateTime="${iso(100)}"`);
    expect(html).toContain('in 20 days');
  });

  it('names the gap in words as well as a marker, and adds no ids to the markup', () => {
    const html = renderToStaticMarkup(<DeadlineTimeline timeline={timeline} />);
    expect(html).toContain('Worth a Look');
    expect(html).toContain('Your passport has less than six months left after your trip starts');
    expect(html).not.toMatch(/\sid="/);
  });

  it('says a passed date in words, not only by position', () => {
    const past = buildTimeline({ ...base, travelStart: day(-3) });
    expect(renderToStaticMarkup(<DeadlineTimeline timeline={past} />)).toContain('3 days ago');
  });

  it('draws nothing when there is no timeline, and never says refused or approved', () => {
    expect(renderToStaticMarkup(<DeadlineTimeline timeline={null} />)).toBe('');
    const html = renderToStaticMarkup(<DeadlineTimeline timeline={timeline} />);
    expect(html).not.toMatch(/refus|reject|approv|guarantee|\u2014/i);
  });
});

describe('the timeline on the Expiry page', () => {
  const params = { params: Promise.resolve({ id: 'person' }) };

  beforeEach(() => {
    vi.resetAllMocks();
    service.getApplicant.mockResolvedValue({
      id: 'person',
      ownerAccountId: 'owner',
      timezone: 'UTC',
    });
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    service.getReminderThresholds.mockResolvedValue([90, 60, 30, 7, 0]);
    service.listIssuerVerificationsForDocument.mockResolvedValue([]);
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    service.getEvidenceCandidates.mockResolvedValue({ ok: true, value: [] });
    service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
    service.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
    });
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: { applicantId: 'person', entries: [] },
    });
  });

  const passport = (expiresAt: Date) => ({
    id: 'd1',
    docType: 'PASSPORT',
    approvedName: 'Passport',
    originalName: 'passport.pdf',
    expiresAt: expiresAt.toISOString(),
    expiry: { origin: 'READ', canType: false, mismatch: false },
  });

  it('shows the timeline above the clock when a trip date and a passport are on file', async () => {
    const { default: Page } = await import('../app/app/applicant/[id]/expiry/page');
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [passport(day(150))] });
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'c1',
          title: 'Case',
          state: 'INTAKE',
          travelStartDate: day(100),
          travelEndDate: null,
        },
      ],
    });
    const text = textOf(await renderServer(Page(params)));
    expect(text).toContain('Trip Starts');
    expect(text).toContain('Passport Ends');
    expect(text).toContain('Worth a Look');
    expect(text).toContain('Deadline Clock');
  });

  it('shows no timeline, only the clock, when no trip, passport or appointment date is on file', async () => {
    const { default: Page } = await import('../app/app/applicant/[id]/expiry/page');
    const text = textOf(await renderServer(Page(params)));
    expect(text).not.toContain('Trip Starts');
    expect(text).toContain('Deadline Clock');
  });

  it('uses the nearest trip that has not started, and the latest one when all have passed', async () => {
    const { default: Page } = await import('../app/app/applicant/[id]/expiry/page');
    const open = (id: string, offset: number) => ({
      id,
      title: id,
      state: 'INTAKE',
      travelStartDate: day(offset),
      travelEndDate: null,
    });
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [open('far', 200), open('old', -30), open('near', 40)],
    });
    expect(await renderServer(Page(params))).toContain(`dateTime="${iso(40)}"`);
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [open('old', -30), open('older', -90)],
    });
    expect(await renderServer(Page(params))).toContain(`dateTime="${iso(-30)}"`);
  });

  it('shows the next appointment, never one that has passed', async () => {
    const { default: Page } = await import('../app/app/applicant/[id]/expiry/page');
    const appt = (key: string, offset: number) => ({
      key,
      kind: 'appointment',
      applicantId: 'person',
      applicantName: 'Synthetic Traveller',
      date: iso(offset),
      daysUntil: offset,
      urgency: 'later',
      docType: null,
      subject: null,
      label: null,
      doubt: null,
      caseId: null,
      href: '/app/applicant/person/expiry',
    });
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: { applicantId: 'person', entries: [appt('a1', -2), appt('a2', 12)] },
    });
    const html = await renderServer(Page(params));
    // The clock below lists the passed one too; only the timeline is under test.
    const line = html.slice(html.indexOf('deadline-timeline'), html.indexOf('deadline-clock'));
    expect(line).toContain('Next Appointment');
    expect(line).toContain('in 12 days');
    expect(line).not.toContain('2 days ago');
  });

  it('ignores the trip of a case that is already handed in', async () => {
    const { default: Page } = await import('../app/app/applicant/[id]/expiry/page');
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'c1',
          title: 'Case',
          state: 'SUBMITTED',
          travelStartDate: day(10),
          travelEndDate: null,
        },
      ],
    });
    expect(textOf(await renderServer(Page(params)))).not.toContain('Trip Starts');
  });
});
