import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getTravellerInsights: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  getTravellerInsights: mocks.getTravellerInsights,
}));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { buildTravellerInsights } = await import('@visastack/services');
const { default: InsightsPage } = await import('./page');

const render = () => renderServer(InsightsPage({ params: Promise.resolve({ id: 'a1' }) }));

// Made-up values: none of them may appear anywhere on the page.
const PASSPORT_NUMBER = 'BX7319046';
const DATE_OF_BIRTH = '1987-03-14';
const SECRETS = [PASSPORT_NUMBER, 'BX7319047', DATE_OF_BIRTH, '1987-03-15', 'Nusrat', 'Jahan'];

/** Insights worked out by the real summary from a traveller holding sensitive details. */
function populated() {
  return buildTravellerInsights({
    documents: [
      {
        id: 'doc-pass',
        docType: 'PASSPORT',
        expiresAt: '2027-01-23T12:00:00.000Z',
        lifecycle: 'CURRENT',
        safetyStatus: 'CLEAN',
        createdAt: '2026-01-01T00:00:00Z',
        reminderThresholds: [90, 60, 30, 7, 0],
      },
      {
        id: 'doc-job',
        docType: 'EMPLOYMENT_CERTIFICATE',
        expiresAt: null,
        lifecycle: 'UNKNOWN',
        safetyStatus: 'CLEAN',
        createdAt: '2026-02-01T00:00:00Z',
        reminderThresholds: [90, 60, 30, 7, 0],
      },
    ],
    facts: [
      {
        fieldKey: 'passport_number',
        repeatingRecordKey: null,
        status: 'DOCUMENT_SUPPORTED',
        isProtected: true,
        value: PASSPORT_NUMBER,
        comparable: true,
        sourceDocumentId: 'doc-pass',
      },
      {
        fieldKey: 'date_of_birth',
        repeatingRecordKey: null,
        status: 'CONFLICTED',
        isProtected: false,
        value: DATE_OF_BIRTH,
        comparable: true,
        sourceDocumentId: 'doc-pass',
      },
      {
        fieldKey: 'given_name',
        repeatingRecordKey: null,
        status: 'APPLICANT_CONFIRMED',
        isProtected: false,
        value: 'Nusrat',
        comparable: true,
        sourceDocumentId: null,
      },
      {
        fieldKey: 'job_title',
        repeatingRecordKey: null,
        status: 'DOCUMENT_SUPPORTED',
        isProtected: false,
        value: 'Engineer',
        comparable: true,
        sourceDocumentId: 'doc-job',
      },
    ],
    pendingReadings: [
      { documentId: 'doc-pass', fieldKey: 'passport_number', value: 'BX7319047' },
      { documentId: 'doc-pass', fieldKey: 'given_name', value: 'Nusrath' },
    ],
    pendingCheckDocumentIds: [],
    sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
    cases: [
      {
        id: 'case-1',
        title: 'Family Visit',
        readiness: {
          overallState: 'NEEDS_ACTION',
          requiredCount: 3,
          satisfiedRequired: 1,
          requirementResults: [
            { kind: 'DOCUMENT', key: 'PASSPORT', optional: false, state: 'SATISFIED' },
            { kind: 'DOCUMENT', key: 'BANK_STATEMENT', optional: false, state: 'CRITICAL_GAP' },
          ],
        },
      },
    ],
    now: new Date('2026-10-25T12:00:00Z'),
  });
}

function ownerProof() {
  return { ok: true, value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ownerProof());
});

describe('the document insights page', () => {
  it('shows each summary in plain words, without any saved or read value', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: populated() });
    const html = await render();
    const text = textOf(html);

    for (const heading of [
      'What Your Documents Show',
      'Details to Check',
      'Expiry Timeline',
      'Readiness by Case',
      'Originals to Bring',
      'Sections Backed by a Document',
      'Documents Behind Your Details',
    ]) {
      expect(text).toContain(heading);
    }
    // Mismatches say only that two values differ, and where.
    expect(text).toContain('Passport Number differs from your saved detail');
    expect(text).toContain('Read from your Passport');
    expect(text).toContain('Two values for Date of Birth');
    // Expiry in plain time-until words, with the date the Expiry page already shows.
    expect(text).toContain('Expires in about 3 months · 23 Jan 2027');
    // Readiness exactly as the case reports it.
    expect(text).toContain('Needs Action');
    expect(text).toContain('1 of 3 required items ready');
    expect(html).toContain('href="/app/mission/case-1"');
    // Originals: the passport is on file, the bank statement needs uploading.
    expect(text).toContain('On File');
    expect(html).toContain(
      'href="/app/applicant/a1/documents?type=BANK_STATEMENT#document-upload"',
    );
    // A restricted document is summarised by section, not by the details it holds.
    expect(text).toMatch(/Passport Protected Backs 1 saved detail in Passport\./);
    expect(text).toContain('Backs 1 saved detail: Job Title.');

    for (const secret of SECRETS) expect(html).not.toContain(secret);
  });

  it('asks the gate for owner access to this traveller', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: populated() });
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
  });

  it('is not found for anyone the gate refuses, or anyone who is not the owner', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'individual_recipient', accountId: 'acct-1' } },
    });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getTravellerInsights).not.toHaveBeenCalled();
  });

  it('says when the summary could not load, rather than reporting nothing to check', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const text = textOf(await render());
    expect(text).toContain('We could not put this summary together just now.');
    expect(text).not.toContain('Nothing to Check');
  });

  it('explains every empty area and where to start', async () => {
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: buildTravellerInsights({
        documents: [],
        facts: [],
        pendingReadings: [],
        pendingCheckDocumentIds: [],
        sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
        cases: [],
        now: new Date('2026-10-25T12:00:00Z'),
      }),
    });
    const html = await render();
    const text = textOf(html);
    for (const empty of [
      'Nothing to Check',
      'No Expiry Dates Yet',
      'No Open Cases',
      'No Originals Listed Yet',
      'No Documents Yet',
    ]) {
      expect(text).toContain(empty);
    }
    expect(html).toContain('href="/app/applicant/a1/missions"');
  });
});
