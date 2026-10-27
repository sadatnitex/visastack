import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

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
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));

const { default: Page } = await import('./page');

const params = { params: Promise.resolve({ id: 'person' }) };
const page = () => renderServer(Page(params));

const entry = (overrides: Record<string, unknown>) => ({
  key: 'document_expires:d1',
  kind: 'document_expires',
  applicantId: 'person',
  applicantName: 'Synthetic Traveller',
  date: '2026-11-07',
  daysUntil: 12,
  urgency: 'month',
  docType: 'PASSPORT',
  subject: null,
  label: null,
  doubt: null,
  caseId: null,
  href: '/app/applicant/person/expiry',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'owner' });
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

describe('the deadline clock on the Expiry page (Growth G5)', () => {
  it('reads five dates through the gate as the owner and shows them above the three signals', async () => {
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: {
        applicantId: 'person',
        entries: [
          entry({
            key: 'task_due:t',
            kind: 'task_due',
            docType: null,
            label: 'Pay the visa fee',
            daysUntil: 0,
            urgency: 'soon',
            href: '/app/mission/c1',
          }),
          entry({}),
        ],
      },
    });
    const html = await page();
    expect(service.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner' },
      'VIEW_METADATA',
      { applicantId: 'person' },
      { purpose: 'self' },
    );
    expect(service.listDeadlineClock).toHaveBeenCalledWith(
      expect.objectContaining({ applicantId: 'person' }),
      expect.objectContaining({ limit: 5 }),
    );
    const text = textOf(html);
    expect(text).toContain('Deadline Clock');
    expect(text).toContain('Due today');
    expect(text).toContain('Pay the visa fee');
    expect(text).toContain('Expires in 12 days');
    expect(html.indexOf('Deadline Clock')).toBeLessThan(html.indexOf('Intrinsic Expiry'));
    // The three signals stay separate and are still there.
    for (const heading of ['Intrinsic Expiry', 'Case-Specific Freshness', 'Verification Expiry']) {
      expect(text).toContain(heading);
    }
  });

  it('teaches when there are no dates, with the add-document button', async () => {
    const html = await page();
    const clock = html.slice(
      html.indexOf('expiry-deadline-clock-heading'),
      html.indexOf('Intrinsic Expiry'),
    );
    expect(textOf(clock)).toContain('No Dates Yet');
    expect(textOf(clock)).toContain(
      'Add a passport and its expiry date appears here, so you hear about it before it matters.',
    );
    expect(clock).toContain('href="/app/applicant/person/documents"');
  });

  it('marks a date it is unsure of Check This Date', async () => {
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: {
        applicantId: 'person',
        entries: [entry({ docType: null, doubt: 'date_before_issue' })],
      },
    });
    const text = textOf(await page());
    expect(text).toContain('Check This Date');
    expect(text).toContain('This date falls before the document was issued.');
  });

  it('says dates are unavailable, not empty, when they cannot be read', async () => {
    service.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const text = textOf(await page());
    expect(text).toContain('Dates are unavailable right now.');
    expect(service.listDeadlineClock).not.toHaveBeenCalled();
  });

  it("shows nothing, and reads nothing, for a file that is not the owner's", async () => {
    service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'foreign' });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(service.requireAccess).not.toHaveBeenCalled();
    expect(service.listDeadlineClock).not.toHaveBeenCalled();
  });
});

describe('dates the page does not have (owner finding 6)', () => {
  const doc = (overrides: Record<string, unknown>) => ({
    id: 'd1',
    docType: 'PASSPORT',
    expiresAt: null,
    approvedName: null,
    originalName: 'synthetic-file.pdf',
    ...overrides,
  });

  it('says a passport has no expiry date read yet, how it is read and what to do, never "Unknown"', async () => {
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc({})] });
    const text = textOf(await page());
    expect(text).toContain('No Date on File');
    expect(text).not.toContain('Unknown');
    expect(text).toContain(
      'No expiry date has been read from this passport yet. It is read from the two lines of letters and numbers at the bottom of the photo page. If they were not clear, open it on Documents to check it again, or upload a sharper scan.',
    );
  });

  it('says other documents have no expiry date on file, without suggesting one can be typed in', async () => {
    service.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ id: 'd2', docType: 'BANK_STATEMENT' }), doc({ id: 'd3', docType: null })],
    });
    const text = textOf(await page());
    expect(text).toContain(
      'No expiry date is on file. For now, expiry dates are read only from passports, so check the date printed on this document yourself.',
    );
    // A document whose kind is not confirmed yet could be a passport: it asks for the kind first.
    expect(text).toContain(
      'No expiry date is on file. Confirm what kind of document this is on Documents. For a passport, the date is then read from the two lines at the bottom of the photo page.',
    );
    expect(text).not.toContain('Unknown');
  });

  it('keeps a known date as it was: the countdown and the date, with no missing-date note', async () => {
    const soon = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    service.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ expiresAt: soon })],
    });
    const text = textOf(await page());
    expect(text).toContain('OK');
    expect(text).toMatch(/Expires in \d+ days/);
    expect(text).not.toContain('No expiry date');
  });

  it('says a route check is waiting for the document date, and where to enter it', async () => {
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [{ id: 'c1', title: 'Synthetic Visit Case' }],
    });
    service.getEvidenceCandidates.mockResolvedValue({
      ok: true,
      value: [
        {
          kind: 'DOCUMENT',
          key: 'bank_statement',
          documentCandidates: [
            { documentId: 'd1', staleness: { status: 'unknown', ageDays: null } },
          ],
        },
      ],
    });
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Document Date Not Entered');
    expect(text).not.toContain('Freshness Unknown');
    expect(text).toContain(
      'This route needs a recently dated document, and no date has been entered for this one, so it cannot be checked.',
    );
    expect(html).toContain(
      'Enter the date printed on it under Document Date on <a href="/app/applicant/person/documents">Documents</a>.',
    );
  });
});
