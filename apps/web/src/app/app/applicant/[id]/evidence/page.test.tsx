import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  referenceCodesFor: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listEvidenceRequestDecisions: vi.fn(),
  requireAccess: vi.fn(),
  listRequestItemExtras: vi.fn(),
  getDocumentLifecycles: vi.fn(),
  loadVersionScanEvidence: vi.fn(),
  evidenceSubmissionsPresent: vi.fn(),
  listEvidenceSubmissions: vi.fn(),
}));
/**
 * The page asks for one page of requests (WP-SB3). Fixtures stay plain lists: this turns a list
 * into the page the service returns, first `limit` requests plus counts over all of them.
 */
async function requestPage(...args: unknown[]) {
  const listed = (await mocks.listEvidenceRequestsForApplicant(...args)) as
    | { ok: true; value: { status: string }[] }
    | { ok: false };
  const options = args[3] as { limit?: number } | undefined;
  if (!listed.ok || !Array.isArray(listed.value) || !options) return listed;
  const limit = options.limit ?? 100;
  return {
    ok: true,
    value: {
      items: listed.value.slice(0, limit),
      more: listed.value.length > limit,
      counts: {
        total: listed.value.length,
        awaiting: listed.value.filter(
          (item) => item.status === 'OPEN' || item.status === 'NEEDS_REPLACEMENT',
        ).length,
      },
    },
  };
}
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listEvidenceRequestsForApplicant: requestPage,
  referenceCodesFor: mocks.referenceCodesFor,
  listApplicantProfile: async () => [],
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  listEvidenceRequestDecisions: mocks.listEvidenceRequestDecisions,
  requireAccess: mocks.requireAccess,
  listRequestItemExtras: mocks.listRequestItemExtras,
  getDocumentLifecycles: mocks.getDocumentLifecycles,
  loadVersionScanEvidence: mocks.loadVersionScanEvidence,
  evidenceSubmissionsPresent: mocks.evidenceSubmissionsPresent,
  listEvidenceSubmissions: mocks.listEvidenceSubmissions,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./submit-response-form', () => ({ SubmitResponseForm: stub('SubmitResponseForm') }));
vi.mock('./ask-about-item-form', () => ({ AskAboutItemForm: stub('AskAboutItemForm') }));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: stub('ClearerCopyPanel') }));

const { default: EvidencePage } = await import('./page');
const render = () => renderServer(EvidencePage({ params: Promise.resolve({ id: 'a1' }) }));

const request = {
  id: 'r1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  status: 'OPEN',
  message: null,
  dueDate: null,
  missionId: null,
  respondingDocumentId: null,
  respondedAt: null,
};

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  originalName: 'statement.pdf',
  approvedName: null,
  docType: 'BANK_STATEMENT',
  latestVersionId: 'v1',
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  ...over,
});

const NO_EXTRAS = { ok: true, value: { rules: new Map(), questions: new Map() } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'R',
    timezone: 'Asia/Dhaka',
  });
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [request] });
  mocks.referenceCodesFor.mockResolvedValue(new Map());
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.listEvidenceRequestDecisions.mockResolvedValue({ ok: true, value: [] });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.listRequestItemExtras.mockResolvedValue(NO_EXTRAS);
  // Every document is the everyday copy unless a test says otherwise.
  mocks.getDocumentLifecycles.mockImplementation(async (_db: unknown, ids: string[]) => {
    const current = { state: 'CURRENT', replaced: false };
    return new Map(ids.map((id) => [id.toLowerCase(), current]));
  });
  mocks.loadVersionScanEvidence.mockResolvedValue(new Map());
  mocks.evidenceSubmissionsPresent.mockResolvedValue(true);
  // No exact sends kept in these fixtures: the thread is built from the decisions.
  mocks.listEvidenceSubmissions.mockResolvedValue({
    ok: true,
    value: { available: false, submissions: [], legacy: [] },
  });
});

const withRequests = (...requests: Record<string, unknown>[]) =>
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: requests });

describe('request reference codes on the evidence page (ADR 0018)', () => {
  it('shows each request code, read in one call for the listed requests', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    const html = await render();
    expect(mocks.referenceCodesFor).toHaveBeenCalledWith(expect.anything(), 'R', ['r1']);
    expect(textOf(html)).toContain('Request Reference');
    expect(html).toContain('R-7K2Q9M');
  });

  it('shows no code before migration 0091 has run', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map());
    expect(textOf(await render())).not.toContain('Request Reference');
  });
});

describe('each item shows its group and what to do (spec B09, WP-V4 U07)', () => {
  it('says Missing for a request still open, with the next step and the response form', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Missing');
    expect(text).toContain('Next: send a document from your wallet');
    expect(html).toContain('lift-pill-md');
    const [form] = stubProps<{ awaiting: boolean; timeZone: string }>(html, 'SubmitResponseForm');
    expect(form).toMatchObject({ awaiting: true, timeZone: 'Asia/Dhaka' });
  });

  it('calls a request the agency has Received, never Submitted, and does not claim a review', async () => {
    withRequests({ ...request, status: 'RECEIVED', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    const text = textOf(await render());
    expect(text).toContain('Received');
    expect(text).toContain('Received does not mean accepted');
    expect(text).not.toMatch(/Submitted|Reviewed/);
  });

  it('says Processing while a sent file is still being checked', async () => {
    withRequests({ ...request, status: 'RECEIVED', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ processingStatus: 'SCANNING', safetyStatus: 'SCANNING' })],
    });
    const text = textOf(await render());
    expect(text).toContain('Processing');
    expect(text).toContain('still being checked');
    expect(text).not.toContain('Received does not mean accepted');
  });

  it('says Needs Correction when the file that was sent can no longer be used, and offers a question', async () => {
    withRequests({
      ...request,
      status: 'RECEIVED',
      respondingDocumentId: 'd1',
      missionId: 'm1',
    });
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ safetyStatus: 'QUARANTINED', processingStatus: 'NEEDS_ATTENTION' })],
    });
    const html = await render();
    expect(textOf(html)).toContain('Needs Correction');
    expect(textOf(html)).toContain('could not be used');
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(1);
  });

  it('says Needs Correction for a request sent back, shows the reason, and says Reviewed only once accepted', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'NEEDS_REPLACEMENT' },
      { ...request, id: 'r2', status: 'ACCEPTED', respondedAt: new Date('2026-10-27T08:32:00Z') },
    );
    mocks.listEvidenceRequestDecisions.mockImplementation(
      async (_db: unknown, _a: string, id: string) =>
        id === 'r1'
          ? {
              ok: true,
              value: [
                {
                  outcome: 'NEEDS_REPLACEMENT',
                  reason: 'The last page is cut off.',
                  createdAt: new Date('2026-10-21T09:00:00Z'),
                },
              ],
            }
          : { ok: true, value: [] },
    );
    const text = textOf(await render());
    expect(text).toContain('Needs Correction');
    expect(text).toContain('Replacement needed: The last page is cut off.');
    expect(text).toContain('Reviewed');
    expect(text).toContain('You sent this on 27 Oct 2026, 14:32 GMT+6.');
  });

  it('reads what was said only on requests that have been answered, and shows a reason only where it was given', async () => {
    withRequests(
      { ...request, id: 'r0', status: 'OPEN' },
      { ...request, id: 'r1', status: 'RECEIVED' },
      { ...request, id: 'r2', status: 'ACCEPTED' },
      { ...request, id: 'r3', status: 'NEEDS_REPLACEMENT' },
    );
    mocks.listEvidenceRequestDecisions.mockImplementation(
      async (_db: unknown, _a: string, id: string) => ({
        ok: true,
        value:
          id === 'r3'
            ? [
                {
                  outcome: 'NEEDS_REPLACEMENT',
                  reason: 'The last page is cut off.',
                  createdAt: new Date('2026-10-21T09:00:00Z'),
                },
              ]
            : [],
      }),
    );
    const text = textOf(await render());
    const asked = mocks.listEvidenceRequestDecisions.mock.calls.map((call) => call[2]).sort();
    // An open request nobody has answered has nothing to read.
    expect(asked).toEqual(['r1', 'r2', 'r3']);
    expect(text.match(/The last page is cut off\./g)).toHaveLength(1);
  });

  it('says earlier history could not be loaded when a read fails, never that there is none', async () => {
    withRequests({
      ...request,
      id: 'r1',
      status: 'RECEIVED',
      respondedAt: new Date('2026-10-27T08:32:00Z'),
    });
    mocks.listEvidenceRequestDecisions.mockRejectedValue(new Error('down'));
    mocks.listEvidenceSubmissions.mockRejectedValue(new Error('down'));
    const text = textOf(await render());
    expect(text).toContain('Earlier history could not be loaded. Refresh to try again.');
    expect(text).not.toMatch(/no history|nothing was sent/i);
  });

  it('reads the exact sends with the owner proof, for a document only', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'RECEIVED', respondedAt: new Date('2026-10-27T08:32:00Z') },
      {
        ...request,
        id: 'r2',
        kind: 'FIELD',
        docType: null,
        fieldKey: 'passport_number',
        status: 'RECEIVED',
      },
    );
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.listEvidenceSubmissions).toHaveBeenCalledTimes(1);
    expect(mocks.listEvidenceSubmissions).toHaveBeenCalledWith(
      { gate: 'proof' },
      { requestId: 'r1' },
    );
  });

  it('shows a cancelled or older closed request as closed, with no form and no question box', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'CANCELLED', missionId: 'm1' },
      { ...request, id: 'r2', status: 'FULFILLED', missionId: 'm1' },
    );
    mocks.referenceCodesFor.mockResolvedValue(
      new Map([
        ['r1', 'R-AAAAAA'],
        ['r2', 'R-BBBBBB'],
      ]),
    );
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Cancelled');
    expect(text).toContain('Closed');
    expect(text).not.toMatch(/Reviewed|Fulfilled/);
    expect(stubProps(html, 'SubmitResponseForm')).toHaveLength(0);
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(0);
  });

  it('puts Received and Reviewed requests last under their own Finished heading, Received in the information colour and Reviewed in the success colour', async () => {
    withRequests(
      {
        ...request,
        id: 'done',
        docType: 'PASSPORT',
        status: 'ACCEPTED',
        dueDate: new Date('2026-11-01'),
      },
      {
        ...request,
        id: 'got',
        docType: 'VISA',
        status: 'RECEIVED',
        respondingDocumentId: 'd1',
        dueDate: new Date('2026-11-02'),
      },
      // Still being checked: not finished, though its deadline is the latest.
      {
        ...request,
        id: 'busy',
        docType: 'NATIONAL_ID',
        status: 'RECEIVED',
        respondingDocumentId: 'd2',
        dueDate: new Date('2026-12-01'),
      },
      { ...request, id: 'open', docType: 'BANK_STATEMENT', status: 'OPEN' },
    );
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc(), doc({ id: 'd2', processingStatus: 'SCANNING', safetyStatus: 'SCANNING' })],
    });
    const html = await render();
    const text = textOf(html);
    // What needs a reply or is still being checked comes first; the finished ones follow the
    // Finished heading, even when their deadline is sooner.
    expect(text.indexOf('Bank Statement')).toBeLessThan(text.indexOf('Finished'));
    expect(text.indexOf('National Id')).toBeLessThan(text.indexOf('Finished'));
    expect(text.indexOf('Finished')).toBeLessThan(text.indexOf('Visa'));
    expect(text.indexOf('Finished')).toBeLessThan(text.indexOf('Passport'));
    expect(text.match(/Finished/g)).toHaveLength(1);
    const dom = new JSDOM(html).window.document;
    const pill = (label: string) =>
      [...dom.querySelectorAll('[data-pattern="list-row"] .lift-pill')].find(
        (b) => b.textContent === label,
      );
    expect(pill('Received')?.className).toContain('lift-pill-info');
    expect(pill('Reviewed')?.className).toContain('badge-success');
    expect(pill('Reviewed')?.className).not.toContain('lift-pill-info');
    // A row never wears a tick for an accepted request: its mark is the kind of thing asked for.
    expect(dom.querySelector('[data-row="done"] .lift-check-icon svg')).not.toBeNull();
  });

  it('numbers each row from the order the requests were read in, so Show More lands on the first new row, not on one already seen', async () => {
    withRequests(
      {
        ...request,
        id: 'done',
        docType: 'PASSPORT',
        status: 'ACCEPTED',
        dueDate: new Date('2026-11-01'),
      },
      {
        ...request,
        id: 'busy',
        docType: 'NATIONAL_ID',
        status: 'RECEIVED',
        respondingDocumentId: 'd2',
        dueDate: new Date('2026-12-01'),
      },
      { ...request, id: 'open', docType: 'BANK_STATEMENT', status: 'OPEN' },
    );
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ id: 'd2', processingStatus: 'SCANNING', safetyStatus: 'SCANNING' })],
    });
    const html = await render();
    // Read order: open, done, busy. Drawn order: open, busy (still being checked), then done.
    const idOf = (name: string) =>
      html.match(
        new RegExp(`id="(evidence-row-\\d+)"(?:(?!evidence-row-)[^])*?Document: ${name}`),
      )?.[1];
    expect(idOf('Bank Statement')).toBe('evidence-row-1');
    expect(idOf('Passport')).toBe('evidence-row-2');
    expect(idOf('National Id')).toBe('evidence-row-3');
  });

  it('shows no Finished heading while every request still needs a reply', async () => {
    withRequests(
      { ...request, id: 'one', docType: 'PASSPORT', status: 'OPEN' },
      { ...request, id: 'two', docType: 'VISA', status: 'OPEN' },
    );
    expect(textOf(await render())).not.toContain('Finished');
  });

  it('keeps requests waiting on the person first, soonest deadline first, and counts them', async () => {
    withRequests(
      { ...request, id: 'late', docType: 'PASSPORT', status: 'RECEIVED' },
      { ...request, id: 'soon', docType: 'VISA', status: 'OPEN', dueDate: new Date('2026-12-01') },
      {
        ...request,
        id: 'sooner',
        docType: 'BANK_STATEMENT',
        status: 'OPEN',
        dueDate: new Date('2026-11-01'),
      },
    );
    const text = textOf(await render());
    expect(text).toContain('2 requests are waiting for you.');
    expect(text.indexOf('Bank Statement')).toBeLessThan(text.indexOf('Visa'));
    expect(text.indexOf('Visa')).toBeLessThan(text.indexOf('Passport'));
  });
});

describe('what the checklist says and the questions already asked', () => {
  it('shows the checklist date range, optional note, and keeps raw codes out', async () => {
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: {
        rules: new Map([['r1', { maxAgeDays: 90, optional: true }]]),
        questions: new Map(),
      },
    });
    const text = textOf(await render());
    expect(text).toContain('The checklist asks for something dated within the last 90 days.');
    expect(text).toContain('This item is optional on the checklist.');
    expect(text).not.toContain('BANK_STATEMENT');
  });

  it('reads the extras through the owner gate with the codes already shown', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'VIEW_METADATA',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.listRequestItemExtras).toHaveBeenCalledWith(
      { gate: 'proof' },
      new Map([['r1', 'R-7K2Q9M']]),
    );
  });

  it('still shows every request when the gate or the extras fail', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(textOf(await render())).toContain('Missing');
    mocks.requireAccess.mockResolvedValue({ ok: true, value: {} });
    mocks.listRequestItemExtras.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(textOf(await render())).toContain('Missing');
  });

  it('lists the questions asked, links to the case notes, and offers the box only with a case and a code', async () => {
    withRequests({ ...request, missionId: 'm1' }, { ...request, id: 'r2', missionId: null });
    mocks.referenceCodesFor.mockResolvedValue(
      new Map([
        ['r1', 'R-7K2Q9M'],
        ['r2', 'R-ZZZZZZ'],
      ]),
    );
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: {
        rules: new Map(),
        questions: new Map([
          [
            'r1',
            [{ text: 'Is a photo of the page enough?', askedAt: new Date('2026-10-27T08:32:00Z') }],
          ],
        ]),
      },
    });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Your Questions');
    expect(text).toContain('Asked 27 Oct 2026, 14:32 GMT+6');
    expect(text).toContain('Is a photo of the page enough?');
    expect(html).toContain('href="/app/mission/m1#notes"');
    const asks = stubProps<{ missionId: string; requestId: string; maxLength: number }>(
      html,
      'AskAboutItemForm',
    );
    expect(asks).toEqual([
      expect.objectContaining({ missionId: 'm1', requestId: 'r1', maxLength: 500 }),
    ]);
  });

  it('stops offering the box once the limit is reached and points to the case notes', async () => {
    withRequests({ ...request, missionId: 'm1' });
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    const asked = Array.from({ length: 5 }, (_, i) => ({
      text: `Question ${i}`,
      askedAt: new Date(Date.UTC(2026, 9, 27, 8, i)),
    }));
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: { rules: new Map(), questions: new Map([['r1', asked]]) },
    });
    const html = await render();
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(0);
    expect(textOf(html)).toContain('You have asked several questions about this item');
  });
});

describe('a long list of requests stays short (WP-SB3)', () => {
  const many = () =>
    Array.from({ length: 30 }, (_, index) => ({
      ...request,
      id: `r${index}`,
      status: index < 12 ? 'OPEN' : 'ACCEPTED',
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
    }));
  const renderAt = (search: Record<string, string>) =>
    renderServer(
      EvidencePage({
        params: Promise.resolve({ id: 'a1' }),
        searchParams: Promise.resolve(search),
      }),
    );

  it('reads ten requests, counts every waiting one, and offers Show More', async () => {
    withRequests(...many());
    const html = await render();
    expect(mocks.listEvidenceRequestsForApplicant).toHaveBeenCalledWith({}, 'owner', 'a1', {
      limit: 10,
    });
    expect(html.match(/data-pattern="list-row"/g)).toHaveLength(10);
    const text = textOf(html);
    expect(text).toContain('12 requests are waiting for you.');
    expect(text).toContain('Showing 10 of 30 requests.');
    expect(html).toContain('href="/app/applicant/a1/evidence?show=20#evidence-row-11"');
  });

  it('grows by ten and never claims nothing is waiting while more exist', async () => {
    withRequests(...many().map((item) => ({ ...item, status: 'ACCEPTED' })));
    const html = await renderAt({ show: '20' });
    expect(mocks.listEvidenceRequestsForApplicant).toHaveBeenLastCalledWith({}, 'owner', 'a1', {
      limit: 20,
    });
    expect(html.match(/data-pattern="list-row"/g)).toHaveLength(20);
    expect(textOf(html)).not.toContain('Nothing is waiting for you.');
    // The way to the rest shows at every level, so Glance is never an empty card.
    expect(html).toMatch(/<div class="show-more" id="evidence-requests-more">/);
    const before = html.slice(0, html.indexOf('id="evidence-requests-more"'));
    expect(before.lastIndexOf('<div data-level="browse">')).toBeLessThan(
      before.lastIndexOf('class="rows"'),
    );
  });
});

describe('the copies offered for a document request (Lane E)', () => {
  type Choice = {
    documentId: string;
    versionId: string;
    name: string;
    kindLabel: string;
    addedLabel: string;
    scanLabel: string;
    usable: boolean;
    sentBack: boolean;
    newest: boolean;
  };
  type FormProps = {
    documentChoices: Choice[];
    idempotencyKey: string;
    exactCopies: boolean;
    documentsRead: boolean;
  };
  const when = (iso: string) => ({ createdAt: iso });
  const lifecycles = (map: Record<string, { state: string; replaced: boolean }>) =>
    mocks.getDocumentLifecycles.mockImplementation(async () => new Map(Object.entries(map)));

  it('offers only the everyday copy: an archived, removed or replaced one is not a choice', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        doc({ id: 'd1', latestVersionId: 'v1', ...when('2026-10-01T00:00:00Z') }),
        doc({ id: 'd2', latestVersionId: 'v2', ...when('2026-10-02T00:00:00Z') }),
        doc({ id: 'd3', latestVersionId: 'v3', ...when('2026-10-03T00:00:00Z') }),
        doc({ id: 'd4', latestVersionId: 'v4', ...when('2026-10-04T00:00:00Z') }),
        doc({
          id: 'd5',
          docType: 'PASSPORT',
          latestVersionId: 'v5',
          ...when('2026-10-05T00:00:00Z'),
        }),
      ],
    });
    lifecycles({
      d1: { state: 'CURRENT', replaced: false },
      d2: { state: 'ARCHIVED', replaced: false },
      d3: { state: 'CURRENT', replaced: true },
      d4: { state: 'RECENTLY_DELETED', replaced: false },
      d5: { state: 'CURRENT', replaced: false },
    });
    const [form] = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    expect(form?.documentChoices.map((c) => c.documentId)).toEqual(['d1']);
    expect(form?.documentChoices[0]).toMatchObject({
      versionId: 'v1',
      name: 'statement.pdf',
      kindLabel: 'Bank Statement',
      usable: true,
      sentBack: false,
    });
  });

  it('lists the newest first, marks only the newest, and words how each was checked', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        doc({ id: 'd1', latestVersionId: 'v1', ...when('2026-10-01T00:00:00Z') }),
        doc({ id: 'd2', latestVersionId: 'v2', ...when('2026-10-20T00:00:00Z') }),
      ],
    });
    mocks.loadVersionScanEvidence.mockResolvedValue(
      new Map([
        ['v1', { kind: 'VIRUS_SCANNED', scannedAt: '2026-10-01T00:05:00Z' }],
        ['v2', { kind: 'FORMAT_CHECKED', scannedAt: null }],
      ]),
    );
    const [form] = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    expect(form?.documentChoices.map((c) => [c.documentId, c.newest, c.scanLabel])).toEqual([
      ['d2', true, 'Format Checked'],
      ['d1', false, 'Checked for Viruses'],
    ]);
    expect(form?.documentChoices[0]?.addedLabel).toBe('20 Oct 2026, 06:00 GMT+6');
  });

  it('reads how each file was checked with the owner proof and only for the offered copies', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ id: 'd1', latestVersionId: 'v1' }), doc({ id: 'd2', latestVersionId: 'v2' })],
    });
    lifecycles({
      d1: { state: 'CURRENT', replaced: false },
      d2: { state: 'ARCHIVED', replaced: false },
    });
    await render();
    expect(mocks.loadVersionScanEvidence).toHaveBeenCalledWith({ gate: 'proof' }, [
      { id: 'v1', safetyStatus: 'CLEAN' },
    ]);
  });

  it('marks the copy the agency sent back, and offers a clearer copy started from it', async () => {
    withRequests({
      ...request,
      status: 'NEEDS_REPLACEMENT',
      respondingDocumentId: 'd1',
    });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ id: 'd1', latestVersionId: 'v1' })],
    });
    const html = await render();
    const [form] = stubProps<FormProps>(html, 'SubmitResponseForm');
    expect(form?.documentChoices.map((c) => [c.documentId, c.sentBack])).toEqual([['d1', true]]);
    const panels = stubProps<{
      applicantId: string;
      requestId: string;
      documentId: string;
      documentName: string;
      primary: boolean;
    }>(html, 'ClearerCopyPanel');
    expect(panels).toEqual([
      {
        applicantId: 'a1',
        requestId: 'r1',
        documentId: 'd1',
        documentName: 'statement.pdf',
        primary: true,
      },
    ]);
  });

  it('does not make the clearer copy the main action while another copy can be sent', async () => {
    withRequests({ ...request, status: 'NEEDS_REPLACEMENT', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        doc({ id: 'd1', latestVersionId: 'v1' }),
        doc({ id: 'd2', latestVersionId: 'v2', ...when('2026-11-01T00:00:00Z') }),
      ],
    });
    const [panel] = stubProps<{ primary: boolean }>(await render(), 'ClearerCopyPanel');
    expect(panel?.primary).toBe(false);
  });

  it('offers Add Documents instead when the sent back copy is no longer an everyday copy', async () => {
    withRequests({ ...request, status: 'NEEDS_REPLACEMENT', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ id: 'd1', latestVersionId: 'v1' })],
    });
    lifecycles({ d1: { state: 'ARCHIVED', replaced: false } });
    const html = await render();
    expect(stubProps(html, 'ClearerCopyPanel')).toHaveLength(0);
    expect(html).toContain('href="/app/applicant/a1/documents/add"');
    expect(textOf(html)).toContain('Add Documents');
  });

  it('offers no clearer copy for a request that is only waiting, or a detail request', async () => {
    const waiting = await render();
    expect(stubProps(waiting, 'ClearerCopyPanel')).toHaveLength(0);
    withRequests({
      ...request,
      kind: 'FIELD',
      docType: null,
      fieldKey: 'passport_number',
      status: 'NEEDS_REPLACEMENT',
    });
    expect(stubProps(await render(), 'ClearerCopyPanel')).toHaveLength(0);
  });

  it('makes a fresh retry key on the server for every render and every request', async () => {
    withRequests({ ...request, id: 'r1' }, { ...request, id: 'r2' });
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    const first = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    const second = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    const keys = [...first, ...second].map((form) => form.idempotencyKey);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{16,200}$/);
  });

  it('tells the form whether the service keeps exact copies yet', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    expect(stubProps<FormProps>(await render(), 'SubmitResponseForm')[0]?.exactCopies).toBe(true);
    mocks.evidenceSubmissionsPresent.mockResolvedValue(false);
    expect(stubProps<FormProps>(await render(), 'SubmitResponseForm')[0]?.exactCopies).toBe(false);
    mocks.evidenceSubmissionsPresent.mockRejectedValue(new Error('down'));
    expect(stubProps<FormProps>(await render(), 'SubmitResponseForm')[0]?.exactCopies).toBe(false);
  });

  it('says the documents could not be read, and offers no copy, when the lifecycle read fails', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    mocks.getDocumentLifecycles.mockRejectedValue(new Error('down'));
    const [form] = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    expect(form?.documentsRead).toBe(false);
    expect(form?.documentChoices).toEqual([]);
  });

  it('says the documents could not be read when the owner proof is refused', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const [form] = stubProps<FormProps>(await render(), 'SubmitResponseForm');
    expect(form?.documentsRead).toBe(false);
    expect(form?.documentChoices).toEqual([]);
  });
});
