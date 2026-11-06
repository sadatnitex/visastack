import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from './next-mocks.test-support';
import {
  PROSE_WORD_BUDGET,
  budgetProblem,
  countProse,
  wordCount,
} from './prose-budget.test-support';

/**
 * THE 30-WORD RULE (Owner, 5 Nov 2026: "no page should have more than 30 words while being
 * exceptionally intuitively designed"). A screen is rendered the way the server sends it, and the
 * words of explanation a person has to read at its phone default depth (Glance) are counted by
 * countProse (prose-budget.test-support.ts holds the exact definition).
 *
 * A RATCHET: a registered screen can only be held to a smaller budget, never a bigger one, and a
 * screen that is converted registers here at 30 or fewer. Screens that are not converted yet are
 * not registered; where each stands today is written down in prose-budget.baseline.json so the gap
 * is visible. To register a screen, write a renderer for its states below and add it to SCREENS.
 *
 * How the phone default depth is read: the page is rendered with its saved depth "auto", which is
 * what a first visit gets, and countProse reads "auto" on a phone as Glance, exactly as the
 * stylesheet does (the shots harness does the same by dropping the script-off marker and
 * screenshotting at 390 and 450 wide).
 */

/** Set this variable to a file name to have each state's count and sentences appended to it. */
const REPORT_VARIABLE = 'PROSE_REPORT';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
  listPendingProposals: vi.fn(),
  lifecycle: false,
  states: new Map<string, unknown>(),
  exceptions: [] as unknown[],
  automatic: [] as unknown[],
  receipts: false,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  getWalletView: mocks.getWalletView,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  referenceCodesFor: async () => new Map(),
  getApplicantEvidenceBytes: async () => 0,
  storageLimitsForOwner: async (
    _db: unknown,
    _owner: string,
    config: { maxAccountEvidenceBytes: number; maxApplicantEvidenceBytes: number },
  ) => ({
    accountBytes: config.maxAccountEvidenceBytes,
    personBytes: config.maxApplicantEvidenceBytes,
  }),
  getLatestOcrRun: async () => undefined,
  listIssuerVerificationsForDocument: async () => [],
  listPendingDocumentTypeProposals: async () => [],
  listPendingInconsistencyFlags: async () => [],
  listPendingProposals: mocks.listPendingProposals,
  listApplicantProfile: async () => [],
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  lifecycleTablesPresent: async () => mocks.lifecycle,
  getDocumentLifecycles: async () => mocks.states,
  listDeletionReceipts: async () => ({ ok: true, value: mocks.receipts ? [{ id: 'r1' }] : [] }),
  duplicateStatuses: async () => new Map(),
  listCopyPeople: async () => [],
  listDocumentExceptions: async () => ({ exceptions: mocks.exceptions, confirmed: [] }),
  listHeldFiles: async () => ({ files: [], people: [] }),
  listAutoPlacements: async () => mocks.automatic,
  listDocumentReadingStates: async () => ({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  }),
}));
vi.mock('../app/app/applicant/[id]/documents/manage/request/facts', () => ({
  removalRequestFacts: async () => new Map(),
}));
vi.mock('./ai', () => ({
  isClassificationConfigured: async () => false,
  isEnvAiExtractionConfigured: () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: async () => false,
  resolveAiExtractionAvailability: async () => 'unconfigured',
}));
vi.mock('./locale', () => ({ getLocale: async () => 'en' }));
vi.mock('./session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
// A first visit: no saved depth, so a phone starts at Glance and a desktop at Browse.
vi.mock('./ccd/depth.server', () => ({ readDepth: async () => 'auto' }));

const { default: DocumentsPage } = await import('../app/app/applicant/[id]/documents/page');

const lifecycleState = (state: string) => ({
  state,
  replaced: false,
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  deletePath: null,
});

function doc(
  id: string,
  name: string,
  processingStatus: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    originalName: name,
    approvedName: name,
    safetyStatus: 'CLEAN',
    processingStatus,
    classification: null,
    latestVersionId: `${id}-v1`,
    latestVersionNumber: 1,
    pendingNameVersion: null,
    documentDate: null,
    docType: null,
    subject: null,
    updatedAt: new Date('2026-11-04T09:00:00Z'),
    ...extra,
  };
}

function resetDocuments() {
  vi.clearAllMocks();
  mocks.lifecycle = false;
  mocks.states = new Map();
  mocks.exceptions = [];
  mocks.automatic = [];
  mocks.receipts = false;
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Nazmus Sadat',
  });
  mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.listPendingProposals.mockResolvedValue([]);
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.loadUploadQuotaConfig.mockReturnValue({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
    maxAccountEvidenceBytes: 200 * 1024 * 1024,
  });
}

const renderDocuments = () =>
  renderServer(
    DocumentsPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve({}),
    }),
  );

/** The states of the Documents screen a person meets, each rendered through the real page. */
const DOCUMENT_STATES = {
  /** The owner's own phone (5 Nov 2026): two files nobody could name, two placed for him, lists. */
  'files that need a name, some sorted for you, archived and deleted lists': async () => {
    resetDocuments();
    mocks.lifecycle = true;
    mocks.receipts = true;
    const current = [
      doc('tin', 'Tax Identification Number Certificate - Nazmus Sadat.pdf', 'AWAITING_REVIEW', {
        docType: 'TIN_CERTIFICATE',
      }),
      doc('nid', 'National ID Card - Nazmus Sadat.pdf', 'AWAITING_REVIEW', {
        docType: 'NATIONAL_ID',
      }),
      doc('u1', 'Document, Nazmus, 4 Nov 2026', 'AWAITING_REVIEW'),
      doc('u2', 'Document, Nazmus, 4 Nov 2026', 'AWAITING_REVIEW'),
      doc('passport', 'Passport - Nazmus Sadat - BGD - Expires 2024-12-17.pdf', 'AWAITING_REVIEW', {
        docType: 'PASSPORT',
      }),
      doc('hotel', 'Hotel or Stay Booking, Nazmus', 'AWAITING_REVIEW', {
        docType: 'HOTEL_BOOKING',
      }),
      doc('visa', 'Visa Photo, Nazmus', 'AWAITING_REVIEW', { docType: 'PASSPORT_PHOTO' }),
    ];
    const archived = [doc('a1', 'Old Bank Statement.pdf', 'APPROVED')];
    const deleted = [
      doc('x1', 'Test Upload.pdf', 'APPROVED'),
      doc('x2', 'Scan 0042.pdf', 'FAILED'),
    ];
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [...current, ...archived, ...deleted],
    });
    mocks.states = new Map<string, unknown>([
      ...current.map((d) => [d.id, lifecycleState('CURRENT')] as const),
      ...archived.map((d) => [d.id, lifecycleState('ARCHIVED')] as const),
      ...deleted.map((d) => [d.id, lifecycleState('RECENTLY_DELETED')] as const),
    ]);
    mocks.exceptions = [
      { kind: 'unknown_type', documentId: 'u1', title: 'Document, Nazmus, 4 Nov 2026' },
      { kind: 'unknown_type', documentId: 'u2', title: 'Document, Nazmus, 4 Nov 2026' },
    ];
    mocks.automatic = [
      {
        placementId: 'p1',
        documentId: 'nid',
        placement: 'KIND',
        title: 'National ID Card - Nazmus Sadat.pdf',
        kindLabel: 'National ID Card',
      },
      {
        placementId: 'p2',
        documentId: 'tin',
        placement: 'KIND',
        title: 'Tax Identification Number Certificate - Nazmus Sadat.pdf',
        kindLabel: 'Tax Identification Number Certificate',
      },
    ];
    return renderDocuments();
  },
  'a few documents, one still being checked, one failed': async () => {
    resetDocuments();
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        doc('passport', 'passport-scan.pdf', 'APPROVED', { docType: 'PASSPORT' }),
        doc('statement', 'bank-statement-oct.pdf', 'AWAITING_REVIEW', {
          docType: 'BANK_STATEMENT',
        }),
        doc('photo', 'photo.jpg', 'SCANNING'),
        doc('broken', 'scan0042.pdf', 'FAILED'),
      ],
    });
    return renderDocuments();
  },
  'a suggested link between two files, and a kind the AI suggested': async () => {
    resetDocuments();
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        doc('s1', 'statement-april.pdf', 'APPROVED', { docType: 'BANK_STATEMENT' }),
        doc('s2', 'statement-april-copy.pdf', 'APPROVED', { docType: 'BANK_STATEMENT' }),
        doc('u1', 'Document, Nazmus, 4 Nov 2026', 'APPROVED'),
      ],
    });
    mocks.exceptions = [
      {
        kind: 'relation',
        proposalId: 'r1',
        documentId: 's2',
        title: 'statement-april-copy.pdf',
        relatedDocumentId: 's1',
        relatedTitle: 'statement-april.pdf',
        relation: 'EXACT_DUPLICATE',
        newIsCurrent: true,
        labels: { newDocument: 'Same as an Existing Copy', relatedDocument: 'Original' },
      },
      {
        kind: 'suggested_kind',
        documentId: 'u1',
        title: 'Document, Nazmus, 4 Nov 2026',
        suggestedLabel: 'Bank Statement',
      },
    ];
    return renderDocuments();
  },
  'nothing added yet': async () => {
    resetDocuments();
    return renderDocuments();
  },
} as const;

/**
 * The screens held to the rule. `max` is the budget in words; it only ever goes down. Every state
 * of a registered screen must pass, so a new state needs its own entry in the screen's renderers.
 */
const SCREENS = [{ screen: 'Documents', max: PROSE_WORD_BUDGET, states: DOCUMENT_STATES }] as const;

describe('the 30-word rule: every registered screen at its phone default depth', () => {
  for (const { screen, max, states } of SCREENS) {
    describe(screen, () => {
      it('is held to at most 30 words, and the budget only goes down', () => {
        expect(max).toBeLessThanOrEqual(PROSE_WORD_BUDGET);
      });
      for (const [name, render] of Object.entries(states)) {
        it(`${name}: at most ${max} words of explanation`, async () => {
          const report = countProse(await render(), { viewport: 'phone' });
          // PROSE_REPORT=<file> appends what each state shows to that file, for the baseline table.
          const reportFile = process.env[REPORT_VARIABLE];
          if (reportFile) {
            const lines = report.passages.map((p) => `    ${p.words}: ${p.text}`).join('\n');
            const desktop = countProse(await render(), { viewport: 'desktop' });
            const desktopLines = desktop.passages
              .map((p) => `    ${p.words}: ${p.text}`)
              .join('\n');
            appendFileSync(
              reportFile,
              `${screen} | ${name} | phone ${report.words} | desktop ${desktop.words}\n${lines}\n  desktop:\n${desktopLines}\n`,
            );
          }
          expect(budgetProblem(`${screen} (${name})`, report, max)).toBeNull();
        });
      }
    });
  }

  it('fails when one more word is added to a registered screen (mutation proof)', async () => {
    const html = await DOCUMENT_STATES['a few documents, one still being checked, one failed']();
    const before = countProse(html, { viewport: 'phone' });
    expect(budgetProblem('Documents', before)).toBeNull();
    // Pad the real page with sentences until it holds exactly 31 words, then one fewer.
    const sentence = (count: number) =>
      `<p>${Array.from({ length: count }, () => 'word').join(' ')}</p>`;
    const at = (words: number) => `${html}${sentence(words - before.words)}`;
    const atLimit = countProse(at(PROSE_WORD_BUDGET), { viewport: 'phone' });
    expect(atLimit.words).toBe(PROSE_WORD_BUDGET);
    expect(budgetProblem('Documents', atLimit)).toBeNull();
    const over = countProse(at(PROSE_WORD_BUDGET + 1), { viewport: 'phone' });
    expect(over.words).toBe(PROSE_WORD_BUDGET + 1);
    expect(budgetProblem('Documents', over)).toContain('31 words');
  });

  it('keeps the sentences it moved: they are still in the markup, behind a closed disclosure', async () => {
    const html =
      await DOCUMENT_STATES[
        'files that need a name, some sorted for you, archived and deleted lists'
      ]();
    for (const sentence of [
      'Keep reusable evidence together. Processing, review and expiry are separate signals.',
      'Most files are sorted on their own. These need one answer from you. Nothing changes until you choose.',
      'These were sorted for you. If one is wrong, Change puts it back as it was.',
      'no kind set yet',
      'left out when you share by category',
    ]) {
      expect(html, sentence).toContain(sentence);
      // And not one of them is among the words a person has to read first.
      const shown = countProse(html, { viewport: 'phone' }).passages.map((p) => p.text);
      expect(
        shown.filter((text) => text.includes(sentence)),
        sentence,
      ).toEqual([]);
    }
  });
});

describe('where the other screens stand today (not registered yet)', () => {
  type Row = { screen: string; state: string; words: number; registered: boolean };
  const baseline = JSON.parse(
    readFileSync(join(__dirname, 'prose-budget.baseline.json'), 'utf8'),
  ) as { measuredOn: string; viewport: string; rows: Row[] };

  it('lists every screen with its measured count, so the gap is visible', () => {
    expect(baseline.viewport).toBe('phone default depth (Glance), 390 wide');
    expect(baseline.rows.length).toBeGreaterThan(5);
    for (const row of baseline.rows) {
      expect(Number.isInteger(row.words), row.screen).toBe(true);
      expect(row.words, row.screen).toBeGreaterThanOrEqual(0);
    }
  });

  it('registers only screens that are within the budget today', () => {
    for (const row of baseline.rows) {
      if (row.registered)
        expect(row.words, `${row.screen} (${row.state})`).toBeLessThanOrEqual(PROSE_WORD_BUDGET);
    }
    expect(baseline.rows.some((row) => row.screen === 'Documents' && row.registered)).toBe(true);
  });

  it('has a registered screen for every row it marks registered', () => {
    const registered = new Set<string>(SCREENS.map((entry) => entry.screen));
    for (const row of baseline.rows) {
      if (row.registered) expect(registered.has(row.screen), row.screen).toBe(true);
    }
  });
});

describe('countProse: the definition', () => {
  const page = (body: string, depth = 'auto') =>
    `<main><div class="depth-scope" data-depth-scope="documents" data-depth="${depth}">${body}</div></main>`;
  const words = (body: string, options?: Parameters<typeof countProse>[1], depth?: string) =>
    countProse(page(body, depth), options).words;

  it('counts words in paragraphs, list items and muted or note, hint and meta lines', () => {
    expect(words('<p>One two three.</p>')).toBe(3);
    expect(words('<ul><li>Four five six seven</li></ul>')).toBe(4);
    expect(words('<span class="muted">Two words</span>')).toBe(2);
    expect(words('<span class="row-note">A note here</span>')).toBe(3);
    expect(words('<div class="field-hint">Hint of three</div>')).toBe(3);
    expect(words('<div class="case-meta">Meta line two</div>')).toBe(3);
  });

  it('counts a sentence nested in a list item once', () => {
    expect(words('<ul><li><p>Only counted once</p></li></ul>')).toBe(3);
  });

  it('counts a bare sentence in a div, but not a short label', () => {
    expect(words('<div>This is plainly a whole sentence here.</div>')).toBe(7);
    expect(words('<div>Two words</div>')).toBe(0);
  });

  it('leaves out headings, buttons, links, summaries, labels and fields', () => {
    expect(
      words(
        '<h2>Heading words here</h2><button>Button words here</button><a href="#">Link words here</a><details><summary>Summary words</summary></details><label>Label words here</label><select><option>Option words</option></select>',
      ),
    ).toBe(0);
  });

  it('leaves out badges, pills, chips, tabs and names that end in label, kicker, metric or filter', () => {
    expect(
      words(
        '<p><span class="badge badge-warning">Needs Review Now</span></p><p class="status-pill">Pill words here</p><p class="x-chip">Chip words here</p><p class="lc-tab">Tab words here</p><p class="card-kicker">Kicker words here</p><p class="a-label">Label words</p><p class="a-metric">Metric words</p><p class="a-filter">Filter words</p>',
      ),
    ).toBe(0);
  });

  it('reports a sentence that hides in a label class instead of skipping it silently', () => {
    const report = countProse(
      '<main><div class="foo-label">This label is really a whole sentence that explains something to the reader.</div></main>',
      { viewport: 'phone' },
    );
    expect(report.problems.join(' ')).toMatch(/a label class holds a sentence/);
    const fine = countProse('<main><span class="foo-label">Ready to Use</span></main>', {
      viewport: 'phone',
    });
    expect(fine.problems).toEqual([]);
  });

  it('leaves out a sentence that is only a link or a button inside a paragraph', () => {
    expect(words('<p>Read <a href="#">the full rules here</a> please</p>')).toBe(2);
  });

  it('leaves out marked data, and reports a sentence that was marked as data', () => {
    const ok = countProse(
      page('<li><span data-value="name">Passport - Nazmus Sadat.pdf</span></li>'),
    );
    expect(ok.words).toBe(0);
    expect(ok.problems).toEqual([]);
    const sentence = countProse(
      page('<p><span data-value="kind">This is a whole sentence.</span></p>'),
    );
    expect(sentence.problems).toHaveLength(1);
    const long = countProse(
      page(
        '<p><span data-value="x">one two three four five six seven eight nine ten eleven twelve thirteen</span></p>',
      ),
    );
    expect(long.problems).toHaveLength(1);
    // Marked data inside a button is checked too.
    const inButton = countProse(
      page('<button><span data-value="name">It ends like this.</span></button>'),
    );
    expect(inButton.problems).toHaveLength(1);
  });

  it('leaves out navigation chrome, hidden parts and screen reader only text', () => {
    expect(words('<nav><p>Nav words here</p></nav>')).toBe(0);
    expect(words('<p hidden>Hidden words here</p>')).toBe(0);
    expect(words('<p aria-hidden="true">Hidden words here</p>')).toBe(0);
    expect(words('<p class="sr-only">Screen reader words</p>')).toBe(0);
    expect(words('<noscript><p>Script off words</p></noscript>')).toBe(0);
  });

  it('leaves out what is in a closed details element, and counts it once it is open', () => {
    expect(words('<details><summary>More</summary><p>Behind a disclosure now</p></details>')).toBe(
      0,
    );
    expect(
      words('<details open><summary>More</summary><p>Behind a disclosure now</p></details>'),
    ).toBe(4);
    expect(
      words(
        '<details><summary>More</summary><details open><p>Nested in a closed one</p></details></details>',
      ),
    ).toBe(0);
  });

  it('reads the depth: "auto" is Glance on a phone and on a desktop (Owner, 6 Nov 2026)', () => {
    const body =
      '<p>Always shown</p><p data-level="browse">Browse only line</p><p data-level="everything">Everything only here today</p>';
    expect(words(body, { viewport: 'phone' })).toBe(2);
    expect(words(body, { viewport: 'desktop' })).toBe(2);
    expect(words(body, { viewport: 'desktop' }, 'browse')).toBe(5);
    expect(words(body, { viewport: 'phone' }, 'browse')).toBe(5);
    expect(words(body, { viewport: 'phone' }, 'everything')).toBe(9);
    expect(words(body, { viewport: 'phone', depth: 'everything' })).toBe(9);
  });

  it('counts only the depth switch sentence for the level shown', () => {
    const notes =
      '<p class="depth-note" data-for="glance">Glance says this</p><p class="depth-note" data-for="browse">Browse says something longer</p>';
    expect(words(notes, { viewport: 'phone' })).toBe(3);
    expect(words(notes, { viewport: 'desktop' })).toBe(3);
    expect(words(notes, { viewport: 'desktop' }, 'browse')).toBe(4);
  });

  it('shows a glance-only line at Glance and hides it deeper', () => {
    const body = '<p data-only="glance">Two more things</p>';
    expect(words(body, { viewport: 'phone' })).toBe(3);
    expect(words(body, { viewport: 'phone' }, 'browse')).toBe(0);
  });

  it('leaves out the selected-document screen while it is closed on a phone, not on a desktop', () => {
    const body = '<aside data-sheet="closed"><p>Details of the chosen file</p></aside>';
    expect(words(body, { viewport: 'phone' })).toBe(0);
    expect(words(body, { viewport: 'desktop' })).toBe(5);
    expect(
      words('<aside data-sheet="open"><p>Details of the chosen file</p></aside>', {
        viewport: 'phone',
      }),
    ).toBe(5);
  });

  it('counts words, not marks', () => {
    expect(wordCount('One - two · three, four. 5')).toBe(5);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('Document, Nazmus, 4 Nov 2026')).toBe(5);
  });

  it('names the sentences that put a screen over its budget', () => {
    const report = countProse(page(`<p>${'word '.repeat(31)}</p>`));
    const message = budgetProblem('Sample', report) ?? '';
    expect(message).toContain('Sample shows 31 words');
    expect(message).toContain('limit 30');
    expect(message).toContain('31: word');
  });
});
