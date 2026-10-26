import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import {
  APPOINTMENT_KEY,
  CALENDAR_ITEMS,
  DOCUMENT_KEY,
  FOREIGN_KEY,
  REQUEST_KEY,
  TASK_KEY,
  ownerProof,
  sharedProof,
} from './fixtures.test-support';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listCalendarDates: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  listCalendarDates: mocks.listCalendarDates,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { default: CalendarPage } = await import('./page');
const { GET } = await import('./download/route');

const ID = 'a1';
const render = (query: Record<string, string | string[]> = {}) =>
  renderServer(
    CalendarPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(query) }),
  );

/** The preview's titles and dates, in order, as the page shows them. */
function previewRows(html: string): { title: string; when: string }[] {
  return [
    ...html.matchAll(
      /<span class="calendar-preview-title">([^<]*)<\/span><span class="calendar-preview-when">([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ title: textOf(m[1] ?? ''), when: textOf(m[2] ?? '') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ownerProof());
  mocks.listCalendarDates.mockResolvedValue({
    ok: true,
    value: { applicantId: ID, items: CALENDAR_ITEMS, truncated: false },
  });
});

describe('calendar export page (v1.2 B05)', () => {
  it('is owner-only: a refused gate or someone shared with sees not found', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValueOnce(sharedProof());
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listCalendarDates).not.toHaveBeenCalled();
  });

  it('lists every dated item with nothing chosen, case names off, and says it is a one-time copy', async () => {
    const html = await render();
    expect(html.match(/name="key"/g)).toHaveLength(CALENDAR_ITEMS.length);
    expect(html).not.toMatch(/name="key"[^>]*checked/);
    expect(html).not.toMatch(/name="names"[^>]*checked/);
    expect(html).not.toContain('calendar-preview-heading');
    const text = textOf(html);
    expect(text).toContain(
      'This is a one-time copy. If a date changes later, your calendar will not update; download a new file.',
    );
    expect(text).toContain('Dates without a time are added as all-day events.');
    expect(text).toContain('Tue 3 Nov 2026, 09:30 Asia/Dhaka time');
    expect(text).toContain('Fri 30 Apr 2027, all day');
    // Choices are a labelled group, each box tied to its label, and the form needs no script.
    expect(html).toMatch(/<fieldset[^>]*><legend class="field-label">Dates to Add<\/legend>/);
    expect(html).toMatch(/<legend class="field-label">Titles<\/legend>/);
    for (let i = 0; i < CALENDAR_ITEMS.length; i++) {
      expect(html).toContain(`for="calendar-date-${i}"`);
      expect(html).toContain(`id="calendar-date-${i}"`);
    }
    expect(html).toContain('for="calendar-case-names"');
    expect(html).toMatch(/<form [^>]*action="\/app\/applicant\/a1\/calendar" method="get"/);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    // Headings in order under the page's h2.
    expect([...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]))).toEqual([2, 3]);
    expect(text).not.toMatch(/mission/i);
  });

  it('previews exactly the titles and dates the file holds, in the same order', async () => {
    const query = { preview: '1', key: [TASK_KEY, APPOINTMENT_KEY, DOCUMENT_KEY], names: '1' };
    const html = await render(query);
    const rows = previewRows(html);
    expect(rows).toEqual([
      { title: 'Appointment - Japan Visit', when: 'Tue 3 Nov 2026, 09:30 Asia/Dhaka time' },
      { title: 'Task Due - Japan Visit', when: 'Tue 3 Nov 2026, all day' },
      { title: 'Document Expires', when: 'Fri 30 Apr 2027, all day' },
    ]);
    // The chosen boxes stay ticked so the person can change the choice.
    const ticked = (key: string) => html.includes(`name="key" checked="" value="${key}"`);
    expect(ticked(TASK_KEY)).toBe(true);
    expect(ticked(REQUEST_KEY)).toBe(false);

    // The download form carries the same keys and choice; the file has the same titles.
    const form = html.slice(html.indexOf('action="/app/applicant/a1/calendar/download"'));
    const hidden = [
      ...form.slice(0, form.indexOf('</form>')).matchAll(/name="(key|names)" value="([^"]*)"/g),
    ]
      .map((m) => `${m[1]}=${encodeURIComponent(m[2] ?? '')}`)
      .join('&');
    expect(form).toContain('Download Calendar File');
    const response = await GET(
      new Request(`https://vs.example.test/app/applicant/${ID}/calendar/download?${hidden}`),
      { params: Promise.resolve({ id: ID }) },
    );
    const ics = (await response.text()).replace(/\r\n /g, '');
    const fileTitles = ics
      .split('\r\n')
      .filter((line) => line.startsWith('SUMMARY:'))
      .map((line) => line.slice('SUMMARY:'.length).replace(/\\([,;\\])/g, '$1'));
    expect(fileTitles).toEqual(rows.map((row) => row.title));
    expect(ics).toContain('DTSTART;TZID=Asia/Dhaka:20261103T093000');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261103');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270430');
  });

  it('shows generic titles in the preview unless case names were chosen', async () => {
    const rows = previewRows(await render({ preview: '1', key: TASK_KEY }));
    expect(rows).toEqual([{ title: 'Task Due', when: 'Tue 3 Nov 2026, all day' }]);
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
    mocks.listCalendarDates.mockResolvedValueOnce({
      ok: true,
      value: { applicantId: ID, items: [], truncated: false },
    });
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
