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
