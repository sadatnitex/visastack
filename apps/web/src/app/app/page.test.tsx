import type { AttentionItem } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stubProps, textOf } from '../../lib/next-mocks.test-support';

const data = vi.hoisted(() => ({
  consents: {} as Record<string, unknown>,
  applicants: [] as { id: string; displayName: string; createdAt: Date }[],
  documents: 0,
  openRequests: 0,
  proposals: 0,
  missions: 0,
  pendingGrants: 0,
  memberships: [] as { active: boolean }[],
  platformAdmin: false,
  /** Extra Needs Attention items for every applicant, as the projection would return them. */
  items: [] as AttentionItem[],
  /** The access gate refuses (for example, a record that is no longer the person's). */
  gateRefuses: false,
}));

vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../lib/admin', () => ({ isPlatformAdmin: async () => data.platformAdmin }));
vi.mock('@visastack/services', async (importOriginal) => {
  // The real ranking, so Home's merge is the one the services tests pin (ADR 0016).
  const { rankAttentionItems } = await importOriginal<typeof import('@visastack/services')>();
  return {
    rankAttentionItems,
    accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
    requireAccess: async (_db: unknown, _p: unknown, _a: unknown, ref: { applicantId: string }) =>
      data.gateRefuses
        ? { ok: false, error: { code: 'forbidden' } }
        : { ok: true, value: { actor: { kind: 'applicant_owner' }, applicantId: ref.applicantId } },
    listNeedsAttention: async (access: { applicantId: string }) => {
      const applicant = data.applicants.find((a) => a.id === access.applicantId);
      const name = applicant?.displayName ?? '';
      const items: AttentionItem[] = [
        ...Array.from({ length: data.openRequests }, (_, i) =>
          attentionItem({
            key: `evidence_request:open-${access.applicantId}-${i}`,
            kind: 'evidence_request',
            title: 'Document Requested',
            why: 'An agency asked you for a document. Reply with a file from your documents.',
            applicantId: access.applicantId,
            applicantName: name,
            subject: {
              kind: 'request',
              requestKind: 'DOCUMENT',
              docType: 'BANK_STATEMENT',
              fieldKey: null,
            },
            href: `/app/applicant/${access.applicantId}/evidence`,
          }),
        ),
        ...(data.proposals > 0
          ? [
              attentionItem({
                key: `suggestions:${access.applicantId}`,
                kind: 'suggestions',
                tier: 7,
                title: 'Suggested Details Waiting for Your Decision',
                why: 'Details were read from a document.',
                applicantId: access.applicantId,
                applicantName: name,
                dueState: 'none',
                count: data.proposals,
                href: `/app/applicant/${access.applicantId}/documents`,
              }),
            ]
          : []),
        ...data.items,
      ];
      return {
        ok: true,
        value: {
          applicantId: access.applicantId,
          applicantName: name,
          items,
          activeCases: Array.from({ length: data.missions }, (_, i) => ({
            id: `case-${i}`,
            title: `Synthetic Case ${i + 1}`,
            state: 'IN_PROGRESS',
          })),
          activeCaseCount: data.missions,
          requests: { waitingOnYou: data.openRequests, withAgency: 0 },
        },
      };
    },
    getConsents: async () => data.consents,
    listApplicants: async () => data.applicants,
    listGrantsForRecipientAccount: async () =>
      Array.from({ length: data.pendingGrants }, () => ({
        grant: { status: 'PENDING_ACCEPTANCE' },
      })),
    listMembershipsForAccount: async () => data.memberships,
    listDocuments: async () => ({ ok: true, value: Array.from({ length: data.documents }) }),
  };
});
vi.mock('./consent-button', async () => {
  const { stub } = await import('../../lib/next-mocks.test-support');
  return { ConsentButton: stub('ConsentButton') };
});
vi.mock('./add-applicant-form', async () => {
  const { stub } = await import('../../lib/next-mocks.test-support');
  return { AddApplicantForm: stub('AddApplicantForm') };
});

const { default: Page } = await import('./page');

/** A Needs Attention item in the projection's shape; `tier` is worked out again by the ranking. */
function attentionItem(
  overrides: Partial<AttentionItem> & Pick<AttentionItem, 'key'>,
): AttentionItem {
  return {
    kind: 'task',
    tier: 5,
    title: 'Task',
    why: 'A task on this case is still open.',
    applicantId: null,
    applicantName: null,
    caseId: null,
    caseTitle: null,
    dueDate: null,
    dueState: 'unknown',
    daysUntilDue: null,
    sentBack: false,
    count: null,
    subject: null,
    href: '/app',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const SELF = {
  id: '10000000-0000-4000-8000-000000000001',
  displayName: 'Synthetic Self',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  data.consents = {};
  data.applicants = [];
  data.documents = 0;
  data.openRequests = 0;
  data.proposals = 0;
  data.missions = 0;
  data.pendingGrants = 0;
  data.memberships = [];
  data.platformAdmin = false;
  data.items = [];
  data.gateRefuses = false;
});

describe('home (characterization before WP-V3)', () => {
  it('with an applicant and core processing on, shows the next step, the applicant and every consent control', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 2;
    data.missions = 1;
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Welcome Back');
    expect(text).toContain('Signed in as me@example.com');
    expect(text).toContain('Synthetic Self');
    expect(text).toContain('2 documents');
    expect(text).toContain('Permissions You Control');
    expect(stubProps<{ type: string }>(html, 'ConsentButton').map((p) => p.type)).toEqual([
      'CORE_PROCESSING',
      'AI_EXTRACTION',
      'AI_OCR',
      'SHARING',
      'MARKETING',
      'ISSUER_CONTACT',
    ]);
  });

  it('gives each permission name and its meaning their own element, so they never run together', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    const html = await renderServer(Page({}));
    expect(html).toContain(
      '<span class="consent-name">Let VisaStack Process My Details</span> <span class="consent-meaning">Needed before',
    );
    expect(html.match(/class="consent-name"/g)).toHaveLength(6);
    expect(html.match(/class="consent-meaning"/g)).toHaveLength(6);
  });

  it('puts what someone is waiting on first, and lists the rest', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.openRequests = 2;
    data.proposals = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Bank Statement');
    expect(text).toContain('Reply to Request');
    expect(text).toContain('Needs Attention');
    expect(text).toContain('Suggested Details Waiting for Your Decision');
  });

  it('when everything is done, says so', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 1;
    data.missions = 1;
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('You Are Up to Date');
    expect(text).not.toContain('Set up your account');
  });
});

const page = (params: Record<string, string> = {}) =>
  renderServer(Page({ searchParams: Promise.resolve(params) }));
const CORE = { CORE_PROCESSING: { grantedAt: new Date() } };

describe('task-first first run (WP-V3, D8)', () => {
  it('asks someone new for core processing alone: exactly one consent control', async () => {
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Step 1 of 2');
    expect(text).toContain('This does not turn on AI reading, sharing with an agency or marketing');
    const buttons = stubProps<{ type: string; granted: boolean; text: string }>(
      html,
      'ConsentButton',
    );
    expect(buttons).toEqual([
      expect.objectContaining({
        type: 'CORE_PROCESSING',
        granted: false,
        text: 'Allow core processing',
      }),
    ]);
    expect(text).not.toContain('Permissions You Control');
    expect(html).toContain('href="/app?setup=later"');
  });

  it('"Not Now" shows the ordinary home with every consent control', async () => {
    const html = await page({ setup: 'later' });
    expect(textOf(html)).toContain('Permissions You Control');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('a returning person with records who turned every permission off gets the ordinary home', async () => {
    data.applicants = [SELF];
    const html = await page();
    expect(textOf(html)).not.toContain('Step 1 of 2');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('someone who turned core processing off with another consent still on keeps every control', async () => {
    data.consents = { MARKETING: { grantedAt: new Date() } };
    const html = await page();
    expect(textOf(html)).not.toContain('Step 1 of 2');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('then asks who the record is for on the page that becomes "what do you want to do?"', async () => {
    data.consents = CORE;
    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/app?welcome=1');
    const html = await page({ welcome: '1' });
    expect(textOf(html)).toContain('Step 2 of 2');
    expect(stubProps<{ firstRun: boolean }>(html, 'AddApplicantForm')).toEqual([
      { firstRun: true },
    ]);
    expect(stubProps(html, 'ConsentButton')).toHaveLength(0);
    // Once the applicant is saved, the same page asks what to do next.
    data.applicants = [SELF];
    expect(textOf(await page({ welcome: '1' }))).toContain('What do you want to do?');
  });

  it('with a valid return path, finishes the two screens and goes to that task instead', async () => {
    data.consents = CORE;
    const next = '/app/client-invitations/accept?token=abc';
    const html = await page({ next });
    expect(textOf(html)).toContain('Step 2 of 2');
    expect(stubProps(html, 'AddApplicantForm')).toHaveLength(1);
    // "Not Now" goes to the task too, rather than leaving the invitation behind.
    expect(html).toContain(`href="${next.replaceAll('&', '&amp;')}"`);
    data.applicants = [SELF];
    await expect(page({ next })).rejects.toThrow(`NEXT_REDIRECT:${next}`);
  });

  it('"Not Now" also skips the welcome redirect', async () => {
    data.consents = CORE;
    const text = textOf(await page({ setup: 'later', welcome: '1' }));
    expect(text).toContain('Welcome Back');
    expect(text).not.toContain('Step 2 of 2');
  });

  it('never follows a return path that leaves the site, or one back to home', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    for (const next of [
      '//evil.example',
      'https://evil.example',
      '/app',
      '/app?welcome=1',
      '/api/health/ready',
      '/auth/sign-in',
      '/invitationx',
      '/app/../privacy/export',
      '/app/./../api/jobs/x',
      '/app/%2e%2e/api/x',
      '/app%2f..%2fapi/x',
      '/invitation/../api/x',
      '/invitation?kind=client&token=abc',
    ]) {
      const text = textOf(await page({ next }));
      expect(text).toContain('Welcome Back');
    }
  });

  it('asks what to do once, offering only destinations that exist, and can be skipped', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    let html = await page({ welcome: '1' });
    let text = textOf(html);
    expect(text).toContain('What do you want to do?');
    expect(text).toContain('Update or Find My Records');
    expect(text).not.toContain('Complete a Request');
    expect(text).not.toContain('Prepare a brief');
    expect(html).toContain(`href="/app/applicant/${SELF.id}"`);
    expect(html).toContain('href="/app"');
    data.openRequests = 1;
    html = await page({ welcome: '1' });
    text = textOf(html);
    expect(text).toContain('Complete a Request');
    expect(html).toContain(`href="/app/applicant/${SELF.id}/evidence"`);
  });

  it('does not show first run to someone with consent and an applicant', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    const text = textOf(await page());
    expect(text).not.toMatch(/Step [12] of 2/);
    expect(text).not.toContain('What do you want to do?');
    expect(text).toContain('Welcome Back');
  });

  it('never sends agency staff, platform staff or someone with shared access through first run', async () => {
    for (const setup of [
      () => {
        data.memberships = [{ active: true }];
      },
      () => {
        data.platformAdmin = true;
      },
      () => {
        data.pendingGrants = 1;
      },
    ]) {
      data.memberships = [];
      data.platformAdmin = false;
      data.pendingGrants = 0;
      setup();
      data.consents = {};
      expect(textOf(await page())).not.toContain('Step 1 of 2');
      data.consents = CORE;
      const text = textOf(await page());
      expect(text).not.toContain('Step 2 of 2');
      expect(text).toContain('Welcome Back');
    }
  });

  it('offers a waiting sharing invitation as the request to complete', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.pendingGrants = 1;
    const html = await page({ welcome: '1' });
    expect(textOf(html)).toContain('Complete a Request');
    expect(html).toContain('href="/app/shared"');
  });
});

describe('Home composition (WP-V4, v1.2 B13 and U03)', () => {
  const overdueRequest = attentionItem({
    key: 'evidence_request:overdue',
    kind: 'evidence_request',
    title: 'Document Requested',
    why: 'An agency asked you for a document. Reply with a file from your documents.',
    applicantId: SELF.id,
    applicantName: SELF.displayName,
    dueDate: '2026-10-01',
    dueState: 'overdue',
    daysUntilDue: -25,
    subject: { kind: 'request', requestKind: 'DOCUMENT', docType: 'PASSPORT', fieldKey: null },
    href: `/app/applicant/${SELF.id}/evidence`,
  });
  const overdueTask = attentionItem({
    key: 'task:overdue',
    kind: 'task',
    title: 'Book the Visa Appointment',
    applicantId: SELF.id,
    applicantName: SELF.displayName,
    caseId: 'case-japan',
    caseTitle: 'Japan Visit',
    dueDate: '2026-10-20',
    dueState: 'overdue',
    daysUntilDue: -6,
    href: '/app/mission/case-japan',
  });
  const sentBack = attentionItem({
    key: 'evidence_request:sent-back',
    kind: 'evidence_request',
    title: 'Replacement Requested',
    why: 'The agency looked at what you sent and asked for a new one.',
    applicantId: SELF.id,
    applicantName: SELF.displayName,
    sentBack: true,
    dueDate: '2026-12-15',
    dueState: 'later',
    daysUntilDue: 50,
    subject: {
      kind: 'request',
      requestKind: 'DOCUMENT',
      docType: 'BANK_STATEMENT',
      fieldKey: null,
    },
    href: `/app/applicant/${SELF.id}/evidence`,
  });

  function sectionText(html: string, id: string, nextId: string): string {
    const start = html.indexOf(`id="${id}"`);
    const end = html.indexOf(nextId, start);
    expect(start, id).toBeGreaterThan(-1);
    return textOf(html.slice(start, end === -1 ? undefined : end));
  }

  it('puts the next step first, then Needs Attention, My Records, Active Requests and Work, My Next Journey and the permissions last', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.missions = 1;
    data.items = [overdueRequest, overdueTask, sentBack];
    const html = await page();
    const order = [
      'id="next-step-title"',
      'id="home-attention-heading"',
      'id="home-records-heading"',
      'id="home-work-heading"',
      'id="home-journey"',
      'Permissions You Control',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Headings stay in order: one h1, then h2 sections, items as h3 inside Needs Attention.
    const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it('shows a request sent back for a fix and an overdue task in Needs Attention, each with its action', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.items = [overdueRequest, overdueTask, sentBack];
    const html = await page();
    // The oldest overdue item is the next step.
    const next = sectionText(html, 'next-step-title', 'home-attention-heading');
    expect(next).toContain('Passport');
    expect(next).toContain('Reply to Request');

    const attention = sectionText(html, 'home-attention-heading', 'home-records-heading');
    expect(attention.indexOf('Book the Visa Appointment')).toBeLessThan(
      attention.indexOf('Bank Statement'),
    );
    expect(attention).toContain('Past Due');
    expect(attention).toContain('Japan Visit');
    expect(attention).toContain('Open Case');
    expect(attention).toContain('Sent Back for a Fix');
    expect(attention).toContain('Send a Replacement');
    expect(html).toContain('href="/app/mission/case-japan"');
    // Each button's name starts with its visible words and says which item it is for.
    expect(html).toMatch(/Send a Replacement<span class="sr-only">: Bank Statement<\/span>/);
    // The person's record shows the sent-back request as open, not only OPEN ones.
    expect(textOf(html)).toContain('Action Needed');
  });

  it('shows a missing date as Date Unknown, never a guessed one', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.openRequests = 2;
    const attention = sectionText(await page(), 'home-attention-heading', 'home-records-heading');
    expect(attention).toContain('Date Unknown');
    expect(attention).not.toMatch(/Due on|Was due/);
  });

  it('adds waiting sharing invitations to the same ranked list, after the person-level items', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.pendingGrants = 2;
    data.items = [overdueTask];
    const html = await page();
    const attention = sectionText(html, 'home-attention-heading', 'home-records-heading');
    expect(attention).toContain('Sharing Invitations Waiting for Your Answer');
    expect(attention).toContain('2 invitations');
    expect(attention).toContain('See Invitations');
  });

  it('caps the list and says how many are left', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.openRequests = 12;
    const attention = sectionText(await page(), 'home-attention-heading', 'home-records-heading');
    expect(attention.match(/Reply to Request/g)).toHaveLength(8);
    expect(attention).toContain('Showing 8 of 11');
    expect(attention).toContain('See All Applicants');
  });

  it('lists open requests and active cases under Active Requests and Work', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.openRequests = 1;
    data.missions = 2;
    const html = await page();
    const work = sectionText(html, 'home-work-heading', 'id="home-journey"');
    expect(work).toContain('Requests from an Agency');
    expect(work).toContain('1 waiting for you');
    expect(work).toContain('Synthetic Case 1');
    expect(work).toContain('Synthetic Case 2');
  });

  it('when the gate refuses, still shows Home without attention items', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.items = [overdueTask];
    data.gateRefuses = true;
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Welcome Back');
    expect(text).not.toContain('Book the Visa Appointment');
    expect(html).not.toContain('id="home-attention-heading"');
  });

  it('keeps My Next Journey as supporting content once setup is done', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.documents = 1;
    data.missions = 1;
    const journey = sectionText(await page(), 'home-journey', 'id="permissions"');
    expect(journey).toContain('My Next Journey');
    expect(journey).toContain('Start a Case');
    expect(journey).not.toContain('Set Up Your Account');
  });

  it('gives My Next Journey one heading, with the setup checklist under it', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    const html = await page();
    const journey = html.slice(html.indexOf('id="home-journey"'), html.indexOf('id="permissions"'));
    expect(journey.match(/<h[1-6]/g)).toEqual(['<h2']);
    expect(textOf(journey)).toContain('My Next Journey');
    expect(textOf(journey)).toContain('Add a First Document');
  });

  it('reads the same people on every visit, oldest first, and says when some are left out', async () => {
    data.consents = CORE;
    // Out of order on purpose: Home sorts by when each record was added, then by id.
    data.applicants = Array.from({ length: 27 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(100 - i).padStart(12, '0')}`,
      displayName: `Person ${String(100 - i).padStart(3, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 3))),
    }));
    data.openRequests = 1;
    const html = await page();
    const records = sectionText(html, 'home-records-heading', 'home-work-heading');
    // The row labels only (the calendar sentence under the list names each person too).
    const shown = [...html.matchAll(/<span class="attention-label">Person (\d{3})<\/span>/g)].map(
      (m) => m[1],
    );
    const expected = [...data.applicants]
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, 25)
      .map((a) => a.displayName.slice(-3));
    expect(shown).toEqual(expected);
    expect(records).toContain('Home shows the first 25 of 27 people.');
    const attention = sectionText(html, 'home-attention-heading', 'home-records-heading');
    expect(attention).toContain('This list covers the first 25 of 27 people.');
    expect(attention).toContain('See All Applicants');
  });

  it('never says nothing is waiting when some people were not read', async () => {
    data.consents = CORE;
    data.applicants = Array.from({ length: 27 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      displayName: `Person ${String(i).padStart(3, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    }));
    // Setup is done, so the only reason left not to say "up to date" is the people not read.
    data.documents = 1;
    data.missions = 1;
    const text = textOf(await page());
    expect(text).not.toContain('You Are Up to Date');
    expect(text).not.toContain('Nothing is waiting for you.');
    expect(text).toContain('Nothing is waiting for the first 25 of 27 people.');
  });

  /** The My Records card, as markup. */
  function recordsHtml(html: string): string {
    const start = html.indexOf('id="home-records-heading"');
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf('id="home-work-heading"', start));
  }

  for (const [count, items] of [
    [0, []],
    [1, [overdueTask]],
    [3, [overdueRequest, overdueTask, sentBack]],
  ] as const) {
    it(`links the one own person to their calendar page with ${count} attention items`, async () => {
      data.consents = CORE;
      data.applicants = [SELF];
      data.items = [...items];
      const html = await page();
      const records = recordsHtml(html);
      expect(records).toMatch(
        new RegExp(`href="/app/applicant/${SELF.id}/calendar"[^>]*>Add Dates to My Calendar</a>`),
      );
      expect(html.match(/\/calendar"/g)).toHaveLength(1);
    });
  }

  it('with several own people, names each person as a link in one sentence, not a row of buttons', async () => {
    data.consents = CORE;
    const other = {
      id: '10000000-0000-4000-8000-000000000002',
      displayName: 'Synthetic Partner',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    };
    data.applicants = [SELF, other];
    const records = recordsHtml(await page());
    for (const person of [SELF, other]) {
      expect(records).toContain(
        `<a href="/app/applicant/${person.id}/calendar">${person.displayName}</a>`,
      );
    }
    expect(textOf(records)).toMatch(
      /Add dates to my calendar for Synthetic Self or Synthetic Partner ?\./,
    );
    expect(records).not.toMatch(/calendar"[^>]*class="btn/);
  });

  it('offers no calendar link before core processing is on', async () => {
    data.applicants = [SELF];
    data.items = [overdueTask];
    expect(await page()).not.toContain('/calendar"');
  });
});
