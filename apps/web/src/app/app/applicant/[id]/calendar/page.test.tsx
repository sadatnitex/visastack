import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import {
  APPOINTMENT_KEY,
  CALENDAR_ITEMS,
  DOCUMENT_KEY,
  FOREIGN_KEY,
  REQUEST_KEY,
  TASK_KEY,
  downloadRequest,
  ownerProof,
  sharedProof,
} from './fixtures.test-support';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listCalendarDates: vi.fn(),
  recordCalendarExport: vi.fn(),
  getCalendarFeedStatus: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  listCalendarDates: mocks.listCalendarDates,
  recordCalendarExport: mocks.recordCalendarExport,
  getCalendarFeedStatus: mocks.getCalendarFeedStatus,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { default: CalendarPage } = await import('./page');
const { POST } = await import('./download/route');

const ID = 'a1';
const render = (query: Record<string, string | string[]> = {}) =>
  renderServer(
    CalendarPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(query) }),
  );
const listing = (items = CALENDAR_ITEMS) => ({
  ok: true,
  value: { applicantId: ID, items, truncated: false },
});

/** The preview's titles and dates, in order, as the page shows them. */
function previewRows(html: string): { title: string; when: string }[] {
  return [
    ...html.matchAll(
      /<span class="calendar-preview-title">([^<]*)<\/span><span class="calendar-preview-when">([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ title: textOf(m[1] ?? ''), when: textOf(m[2] ?? '') }));
}

/** The hidden fields of the download form, as the browser would post them. */
function downloadFields(html: string): [string, string][] {
  const start = html.indexOf('action="/app/applicant/a1/calendar/download"');
  expect(start).toBeGreaterThan(-1);
  const form = html.slice(html.lastIndexOf('<form', start), html.indexOf('</form>', start));
  expect(form).toContain('method="post"');
  return [...form.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"/g)].map((m) => [
    m[1] ?? '',
    (m[2] ?? '').replaceAll('&amp;', '&'),
  ]);
}

async function fileFor(fields: [string, string][]) {
  const response = await POST(downloadRequest(fields), { params: Promise.resolve({ id: ID }) });
  const ics = (await response.text()).replace(/\r\n /g, '');
  const values = (name: string) =>
    ics.split('\r\n').filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
  return { response, ics, values };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ownerProof());
  mocks.listCalendarDates.mockResolvedValue(listing());
  mocks.recordCalendarExport.mockResolvedValue({ ok: true, value: undefined });
});

describe('calendar export page (v1.2 B05)', () => {
  it('is owner-only: a refused gate or someone shared with sees not found', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValueOnce(sharedProof());
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listCalendarDates).not.toHaveBeenCalled();
  });

  it('lists every dated item with nothing chosen, case names off, no reminder, and the one-time copy wording', async () => {
    const html = await render();
    expect(html.match(/name="key"/g)).toHaveLength(CALENDAR_ITEMS.length);
    expect(html).not.toMatch(/name="key"[^>]*checked/);
    expect(html).not.toMatch(/name="titles"[^>]*checked/);
    expect(html).toMatch(/name="remind" checked="" value=""/);
    expect(html.match(/name="remind"[^>]*checked/g)).toHaveLength(1);
    expect(html).not.toContain('calendar-preview-heading');
    const text = textOf(html);
    expect(text).toContain('Add Dates to My Calendar');
    expect(text).toContain(
      'This is a one-time copy. If a date changes later, your calendar will not update; download a new file.',
    );
    expect(text).toContain('Dates without a time are added as all-day events.');
    expect(text).toContain('Tue 3 Nov 2026, 09:30 Asia/Dhaka time');
    expect(text).toContain('Fri 30 Apr 2027, all day');
    expect(text).toContain('Add Case Names');
    // Reminder choices in a fixed order, None first.
    const reminders = [...html.matchAll(/id="calendar-remind-([a-z0-9]+)"/g)].map((m) => m[1]);
    expect(reminders).toEqual(['none', '0', '1440', '10080']);
    expect(text).toMatch(/None.*On the Day.*1 Day Before.*1 Week Before/);
    expect(text).toContain(
      'Calendar apps that support updates replace the dates you added before; others may add them again.',
    );
    // Labelled groups, each box tied to its label, plain forms with no script.
    for (const legend of ['Dates to Add', 'Titles', 'Remind Me']) {
      expect(html).toContain(`<legend class="field-label">${legend}</legend>`);
    }
    for (let i = 0; i < CALENDAR_ITEMS.length; i++) {
      expect(html).toContain(`for="calendar-date-${i}"`);
      expect(html).toContain(`id="calendar-date-${i}"`);
    }
    for (const id of ['calendar-case-names', 'calendar-remind-none', 'calendar-remind-1440']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<form [^>]*action="\/app\/applicant\/a1\/calendar" method="get"/);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    // The page heading, Choose Dates and Subscribe in Your Calendar App.
    expect([...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]))).toEqual([2, 3, 3]);
    expect(text).not.toMatch(/mission/i);
  });

  it('previews exactly the titles, dates and reminder the file holds, in the same order', async () => {
    const html = await render({
      preview: '1',
      key: [TASK_KEY, APPOINTMENT_KEY, DOCUMENT_KEY],
      titles: 'withCaseNames',
      remind: '1440',
    });
    const rows = previewRows(html);
    expect(rows).toEqual([
      { title: 'Appointment - Japan Visit', when: 'Tue 3 Nov 2026, 09:30 Asia/Dhaka time' },
      { title: 'Task Due - Japan Visit', when: 'Tue 3 Nov 2026, all day' },
      { title: 'Document Expires', when: 'Fri 30 Apr 2027, all day' },
    ]);
    expect(textOf(html)).toContain('Reminder: 1 day before.');
    expect(textOf(html)).toContain('anything finished or removed since this preview is left out');
    // The choices stay as made so the person can change them.
    const ticked = (key: string) => html.includes(`name="key" checked="" value="${key}"`);
    expect(ticked(TASK_KEY)).toBe(true);
    expect(ticked(REQUEST_KEY)).toBe(false);
    expect(html).toMatch(/name="remind" checked="" value="1440"/);

    const fields = downloadFields(html);
    expect(fields).toEqual([
      ['key', APPOINTMENT_KEY],
      ['key', TASK_KEY],
      ['key', DOCUMENT_KEY],
      ['titles', 'withCaseNames'],
      ['remind', '1440'],
    ]);
    const { values } = await fileFor(fields);
    const titles = values('SUMMARY').map((line) =>
      line.slice('SUMMARY:'.length).replace(/\\([,;\\])/g, '$1'),
    );
    expect(titles).toEqual(rows.map((row) => row.title));
    // 09:30 in Dhaka is 03:30 UTC; the all-day dates stay days.
    expect(values('DTSTART')).toEqual([
      'DTSTART:20261103T033000Z',
      'DTSTART;VALUE=DATE:20261103',
      'DTSTART;VALUE=DATE:20270430',
    ]);
    expect(values('TRIGGER')).toEqual(['TRIGGER:-PT1440M', 'TRIGGER:-PT900M', 'TRIGGER:-PT900M']);
  });

  it('if something was finished since the preview, the file still downloads with the rest', async () => {
    const html = await render({ preview: '1', key: [TASK_KEY, APPOINTMENT_KEY] });
    mocks.listCalendarDates.mockResolvedValueOnce(
      listing(CALENDAR_ITEMS.filter((item) => item.key !== TASK_KEY)),
    );
    const { response, values } = await fileFor(downloadFields(html));
    expect(response.status).toBe(200);
    expect(values('SUMMARY')).toEqual(['SUMMARY:Appointment']);
  });

  it('shows generic titles and no reminder in the preview unless chosen', async () => {
    const html = await render({ preview: '1', key: TASK_KEY });
    expect(previewRows(html)).toEqual([{ title: 'Task Due', when: 'Tue 3 Nov 2026, all day' }]);
    expect(textOf(html)).toContain('Reminder: none.');
    expect(downloadFields(html)).toEqual([['key', TASK_KEY]]);
  });

  it('a preview with nothing valid chosen asks for a choice and offers no download', async () => {
    for (const query of [
      { preview: '1' },
      { preview: '1', key: FOREIGN_KEY },
      { error: 'nothing' },
    ]) {
      const html = await render(query);
      expect(textOf(html)).toContain('Choose at least one date first.');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('Download Calendar File');
      expect(html).not.toContain(FOREIGN_KEY);
    }
  });

  it('with no dated items, says so plainly', async () => {
    mocks.listCalendarDates.mockResolvedValueOnce(listing([]));
    const text = textOf(await render());
    expect(text).toContain('No Dates to Add');
    expect(text).toContain('one-time copy');
  });

  it('says when a long list was cut', async () => {
    mocks.listCalendarDates.mockResolvedValueOnce({
      ok: true,
      value: { applicantId: ID, items: CALENDAR_ITEMS, truncated: true },
    });
    expect(textOf(await render())).toContain(
      'Only the earliest 50 of each kind of date are listed.',
    );
  });
});

describe('subscribing in a calendar app', () => {
  beforeEach(() => {
    mocks.requireAccess.mockResolvedValue(ownerProof());
    mocks.listCalendarDates.mockResolvedValue(listing());
  });

  it('offers to turn a private link on, with the warning that anyone with it sees the dates', async () => {
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'off' } });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Subscribe in Your Calendar App');
    expect(text).toContain('Anyone who has this link can see these dates');
    expect(text).toContain('Turn On Calendar Link');
    expect(text).not.toContain('Stop Sharing');
    expect(html).toContain('name="applicantId" value="a1"');
    // The status is asked of the gate as the owner, like the dates.
    expect(mocks.getCalendarFeedStatus).toHaveBeenCalledWith(ownerProof().value);
  });

  it('says a link is on without ever showing it again, and offers a new link or stopping it', async () => {
    mocks.getCalendarFeedStatus.mockResolvedValue({
      ok: true,
      value: { state: 'on', linkMadeAt: new Date('2026-10-20T08:00:00Z') },
    });
    const html = await render();
    const text = textOf(html);
    // In the traveller's own time zone (Dhaka is six hours ahead of UTC).
    expect(text).toContain('Your calendar link is on, made on 20 Oct 2026, 14:00 GMT+6');
    expect(text).toContain('shown only once');
    expect(text).toContain('Make a New Link');
    expect(text).toContain('Stop Sharing');
    expect(text).not.toContain('Turn On Calendar Link');
    expect(html).not.toContain('/api/calendar-feed/');
  });

  it('says it is not available yet before the table exists, also when there are no dates', async () => {
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'unavailable' } });
    mocks.listCalendarDates.mockResolvedValue(listing([]));
    const text = textOf(await render());
    expect(text).toContain('No Dates to Add');
    expect(text).toContain('Subscribing in your calendar app is not available yet.');
    expect(text).not.toContain('Turn On Calendar Link');
  });

  it('says it could not check, still offering Stop Sharing, when the status cannot be read', async () => {
    mocks.getCalendarFeedStatus.mockRejectedValue(new Error('database down'));
    const text = textOf(await render());
    expect(text).toContain('Choose Dates');
    expect(text).toContain('We could not check your calendar link just now.');
    expect(text).toContain('Stop Sharing');
    expect(text).not.toContain('not available yet');
  });

  it('says not available yet only when the table is missing', async () => {
    mocks.getCalendarFeedStatus.mockRejectedValue(
      Object.assign(new Error('relation "calendar_feeds" does not exist'), { code: '42P01' }),
    );
    const text = textOf(await render());
    expect(text).toContain('Subscribing in your calendar app is not available yet.');
  });

  it('reads the link with the same gate proof as the dates: one gate question for the page', async () => {
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'off' } });
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledOnce();
  });
});
