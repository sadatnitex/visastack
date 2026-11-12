import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderServer,
  stub,
  stubProps,
  textOf,
} from '../../../../../../lib/next-mocks.test-support';
import { countProse } from '../../../../../../lib/prose-budget.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  requireAccess: vi.fn(),
  planEvidenceAnswers: vi.fn(),
  readEvidenceAnswerReceipt: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  getApplicant: mocks.getApplicant,
  requireAccess: mocks.requireAccess,
  planEvidenceAnswers: mocks.planEvidenceAnswers,
  readEvidenceAnswerReceipt: mocks.readEvidenceAnswerReceipt,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('./answer-set-form', () => ({ AnswerSetForm: stub('AnswerSetForm') }));

const { default: AnswerPage } = await import('./page');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const copy = (id: string, over: Record<string, unknown> = {}) => ({
  documentId: `doc-${id}`,
  versionId: `ver-${id}`,
  versionNumber: 1,
  name: `${id}.pdf`,
  addedAt: new Date('2026-11-01T10:00:00Z'),
  expiresOn: null,
  documentDate: null,
  ageDays: null,
  state: 'OK',
  sendable: true,
  acceptedBefore: null,
  ...over,
});
const item = (id: string, readiness: string, copies: unknown[] = [], over = {}) => ({
  requestId: `req-${id}`,
  referenceCode: null,
  kind: 'DOCUMENT',
  docType: 'PASSPORT',
  fieldKey: null,
  status: 'OPEN',
  missionId: null,
  dueDate: null,
  rule: null,
  readiness,
  copies,
  ...over,
});
const group = (organizationId: string, organizationName: string, items: unknown[]) => ({
  organizationId,
  organizationName,
  canReceive: true,
  items,
});
const plan = (agencies: unknown[], over: Record<string, unknown> = {}) => ({
  ok: true,
  value: { available: true, agencies, more: false, ...over },
});
const LINE = (id: string, state = 'WAITING_FOR_REVIEW') => ({
  submissionId: `sub-${id}`,
  requestId: `req-${id}`,
  referenceCode: 'R-7K2Q9M',
  docType: 'PASSPORT',
  title: `${id}.pdf`,
  versionNumber: 2,
  checksumFingerprint: 'abcdef123456',
  sentAt: new Date('2026-11-12T08:30:00Z'),
  state,
});
const KEY = 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd';

const render = (search: Record<string, string> = {}) =>
  renderServer(
    AnswerPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve(search) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'TEST Rahim Synthetic',
    timezone: 'Asia/Dhaka',
  });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.planEvidenceAnswers.mockResolvedValue(plan([]));
  mocks.readEvidenceAnswerReceipt.mockResolvedValue({
    ok: true,
    value: { organizationId: ORG_A, organizationName: '', lines: [] },
  });
});

describe('who may open the page', () => {
  it('is not found for a traveller that does not exist, or belongs to someone else', async () => {
    mocks.getApplicant.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'someone-else' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.planEvidenceAnswers).not.toHaveBeenCalled();
  });

  it('asks the central gate for the owner proof, for the traveller in the address', async () => {
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
  });
});

describe('when the plan cannot be read', () => {
  it.each([
    ['the access gate says no', () => mocks.requireAccess.mockResolvedValue({ ok: false })],
    [
      'the plan fails',
      () => mocks.planEvidenceAnswers.mockResolvedValue({ ok: false, error: { code: 'x' } }),
    ],
  ])(
    'says so and that nothing was sent when %s, never that nothing is waiting',
    async (_name, setup) => {
      setup();
      const text = textOf(await render());
      expect(text).toContain('Your requests could not be loaded, so nothing was sent.');
      expect(text).not.toMatch(/Nothing Is Waiting|no agency is waiting/i);
      expect(text).not.toContain('Who Is Asking');
    },
  );
});

describe('when answering in one step is not available yet', () => {
  it('says so and links to the requests page', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(
      plan([group(ORG_A, 'TEST Agency Unrelated', [item('p', 'READY', [copy('p')])])], {
        available: false,
      }),
    );
    const html = await render();
    expect(textOf(html)).toContain('Answering in one step is not available yet.');
    expect(html).toContain('href="/app/applicant/a1/evidence"');
    expect(stubProps(html, 'AnswerSetForm')).toHaveLength(0);
  });
});

describe('when nothing is waiting', () => {
  it('shows an empty state with a link back to Requests', async () => {
    const html = await render();
    expect(textOf(html)).toContain('Nothing Is Waiting for You');
    expect(html).toContain('href="/app/applicant/a1/evidence"');
    expect(mocks.readEvidenceAnswerReceipt).not.toHaveBeenCalled();
  });

  it('still shows the receipt when one was asked for and has lines', async () => {
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: 'TEST Agency Unrelated',
        lines: [LINE('passport')],
      },
    });
    const html = await render({ agency: ORG_A, done: KEY });
    const text = textOf(html);
    expect(mocks.readEvidenceAnswerReceipt).toHaveBeenCalledWith(
      { gate: 'proof' },
      { organizationId: ORG_A, confirmationKey: KEY },
    );
    expect(text).toContain('Answers Sent');
    expect(text).toContain('1 exact copy went to TEST Agency Unrelated.');
    expect(text).toContain('Nothing Is Waiting for You');
  });
});

describe('with several agencies waiting', () => {
  const several = () =>
    plan([
      group(ORG_A, 'TEST Agency Unrelated', [
        item('p', 'READY', [copy('p')]),
        item('b', 'READY', [copy('b')]),
        item('l', 'MISSING'),
      ]),
      group(ORG_B, 'TEST Agency North', [item('n', 'CHOOSE', [copy('n1'), copy('n2')])]),
    ]);

  it('lists who is asking, with the counts, and chooses nobody', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Who Is Asking');
    expect(text).toContain('TEST Agency Unrelated');
    expect(text).toContain('3 requests waiting · 2 ready from saved records');
    expect(text).toContain('TEST Agency North');
    expect(text).toContain('1 request waiting · 0 ready from saved records');
    expect(html).toContain(`href="/app/applicant/a1/evidence/answer?agency=${ORG_A}"`);
    expect(html).toContain(`href="/app/applicant/a1/evidence/answer?agency=${ORG_B}"`);
    expect(stubProps(html, 'AnswerSetForm')).toHaveLength(0);
  });

  it('lists them again, choosing nobody, when the agency in the address is unknown', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const html = await render({ agency: '33333333-3333-4333-8333-333333333333' });
    expect(textOf(html)).toContain('Who Is Asking');
    expect(stubProps(html, 'AnswerSetForm')).toHaveLength(0);
  });

  it('shows the review for the agency in the address, with a way back to the list', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const html = await render({ agency: ORG_B });
    const [form] = stubProps<{
      organizationId: string;
      agencyName: string;
      confirmationKey: string;
      planKey: string;
      waitingTotal: number;
      review: { choose: unknown[]; ready: unknown[] };
    }>(html, 'AnswerSetForm');
    expect(form).toMatchObject({ organizationId: ORG_B, agencyName: 'TEST Agency North' });
    expect(form?.planKey).toBeTruthy();
    // Counted over the whole plan (every agency), not only the one on screen.
    expect(form?.waitingTotal).toBe(4);
    expect(form?.review.choose).toHaveLength(1);
    expect(textOf(html)).toContain('TEST Agency North: 1 request waiting');
    expect(textOf(html)).toContain('All Agencies');
    expect(textOf(html)).not.toContain('Who Is Asking');
  });
});

describe('with exactly one agency waiting', () => {
  const one = () =>
    plan([
      group(ORG_A, 'TEST Agency Unrelated', [
        item('p', 'READY', [copy('p')]),
        item('o', 'OUTDATED', [copy('o', { state: 'EXPIRED', sendable: false })]),
        item('d', 'OWN_STEP', [], { kind: 'FIELD', docType: null, fieldKey: 'passport_number' }),
      ]),
    ]);

  it('goes straight to the review, grouped, with a server-made confirmation key', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    const html = await render();
    const [form] = stubProps<{
      confirmationKey: string;
      timeZone: string;
      applicantId: string;
      review: { ready: { name: string }[]; choose: unknown[]; other: { name: string }[] };
    }>(html, 'AnswerSetForm');
    expect(form?.confirmationKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(form).toMatchObject({ timeZone: 'Asia/Dhaka', applicantId: 'a1' });
    expect(form?.review.ready.map((entry) => entry.name)).toEqual(['Document: Passport']);
    expect(form?.review.other.map((entry) => entry.name)).toEqual([
      'Document: Passport',
      'Detail: Passport Number',
    ]);
    expect(textOf(html)).toContain('TEST Agency Unrelated: 3 requests waiting');
    expect(textOf(html)).not.toContain('All Agencies');
  });

  it('never answers an address that names another agency with this one: the receipt shows, and the person chooses', async () => {
    // Everything TEST Agency North asked for was just sent, so only the other agency still waits.
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_B,
        organizationName: 'TEST Agency North',
        lines: [LINE('statement')],
      },
    });
    const html = await render({ agency: ORG_B, done: KEY });
    const text = textOf(html);
    expect(mocks.readEvidenceAnswerReceipt).toHaveBeenCalledWith(
      { gate: 'proof' },
      { organizationId: ORG_B, confirmationKey: KEY },
    );
    expect(text).toContain('1 exact copy went to TEST Agency North.');
    // The other agency is offered by name, not opened for the person.
    expect(text).toContain('Who Is Asking');
    expect(html).toContain(`href="/app/applicant/a1/evidence/answer?agency=${ORG_A}"`);
    expect(stubProps(html, 'AnswerSetForm')).toHaveLength(0);
  });

  it('makes a new confirmation key for every render, in the server', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    const keys = new Set<string>();
    for (let n = 0; n < 3; n += 1) {
      const [form] = stubProps<{ confirmationKey: string }>(await render(), 'AnswerSetForm');
      keys.add(form?.confirmationKey ?? '');
    }
    expect(keys.size).toBe(3);
  });

  it('shows the receipt above the review, and what still waits below it', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: 'TEST Agency Unrelated',
        lines: [LINE('passport'), LINE('bank', 'ACCEPTED'), LINE('photo', 'SENT_BACK')],
      },
    });
    const html = await render({ done: KEY });
    const text = textOf(html);
    expect(mocks.readEvidenceAnswerReceipt).toHaveBeenCalledWith(
      { gate: 'proof' },
      { organizationId: ORG_A, confirmationKey: KEY },
    );
    expect(text).toContain('3 exact copies went to TEST Agency Unrelated.');
    expect(text).toContain('passport.pdf');
    expect(text).toContain('Version 2 · Fingerprint abcdef123456 ·');
    expect(text).toContain('12 Nov 2026, 14:30 GMT+6');
    expect(text).toContain('R-7K2Q9M');
    expect(text).toContain('Received, Not Yet Reviewed');
    expect(text).toContain('Accepted');
    expect(text).toContain('Sent Back');
    expect(text.indexOf('Answers Sent')).toBeLessThan(
      text.indexOf('TEST Agency Unrelated: 3 requests'),
    );
    expect(stubProps(html, 'AnswerSetForm')).toHaveLength(1);
  });

  it('words a received copy as received, never as accepted or reviewed', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: 'TEST Agency Unrelated',
        lines: [LINE('passport')],
      },
    });
    const text = textOf(await render({ done: KEY }));
    expect(text).toContain('Received, Not Yet Reviewed');
    expect(text).not.toContain('Accepted');
  });

  it('shows no receipt for a key that names no send', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    const text = textOf(await render({ done: 'unknown-key' }));
    expect(text).not.toContain('Answers Sent');
  });

  it('says more requests wait than are listed, with a link, when the plan is cut short', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue({
      ok: true,
      value: { ...one().value, more: true },
    });
    const html = await render();
    expect(textOf(html)).toContain('More requests are waiting than are listed here.');
  });

  it('stays inside the 30-word rule at first view, at every width', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(one());
    const html = `<main>${await render()}</main>`;
    for (const viewport of ['phone', 'desktop'] as const) {
      const report = countProse(html, { viewport });
      expect(report.problems).toEqual([]);
      expect(report.words, JSON.stringify(report.passages)).toBeLessThanOrEqual(30);
    }
  });
});
