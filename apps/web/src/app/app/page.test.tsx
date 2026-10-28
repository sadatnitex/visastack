import type { AttentionItem, DeadlineEntry } from '@visastack/services';
import { JSDOM } from 'jsdom';
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
  /** What the deadline clock returns for every person (Growth G5). */
  deadlines: [] as DeadlineEntry[],
  /** The clock's read fails for these applicant ids. */
  deadlineFails: [] as string[],
  /** What the readiness source returns for every case; null stands for a case with no checklist attached. */
  readiness: null as { requiredCount: number; satisfiedRequired: number } | null,
  /** The refusal code the readiness source gives when there is no count; "invalid" means no checklist is attached. */
  readinessError: 'invalid',
}));

vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../lib/admin', () => ({ holdsPlatformRole: async () => data.platformAdmin }));
vi.mock('@visastack/services', async (importOriginal) => {
  // The real ranking, so Home's merge is the one the services tests pin (ADR 0016).
  const { rankAttentionItems, rankDeadlines } =
    await importOriginal<typeof import('@visastack/services')>();
  return {
    rankAttentionItems,
    rankDeadlines,
    listDeadlineClock: async (access: { applicantId: string }) =>
      data.deadlineFails.includes(access.applicantId)
        ? { ok: false, error: { code: 'upstream_error' } }
        : {
            ok: true,
            value: {
              applicantId: access.applicantId,
              entries: data.deadlines.filter((e) => e.applicantId === access.applicantId),
            },
          },
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
    computeReadiness: async () =>
      data.readiness
        ? { ok: true, value: data.readiness }
        : { ok: false, error: { code: data.readinessError, message: 'no count' } },
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

const { default: Page } = await import('./(home)/page');

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
  data.readiness = null;
  data.readinessError = 'invalid';
  data.pendingGrants = 0;
  data.memberships = [];
  data.platformAdmin = false;
  data.items = [];
  data.gateRefuses = false;
  data.deadlines = [];
  data.deadlineFails = [];
});

describe('home (characterization before WP-V3)', () => {
  it('with an applicant and core processing on, shows the next step, the applicant and every consent control', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [SELF];
    data.documents = 2;
    data.missions = 1;
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Account Overview');
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
    // The country screen (Growth G2) comes first; once it is done the permission screen is step 2 of 3.
    const html = await page({ step: 'consent' });
    const text = textOf(html);
    expect(text).toContain('Step 2 of 3');
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
    expect(text).not.toContain('Your Country');
  });

  it('"Not Now" shows the ordinary home with every consent control', async () => {
    const html = await page({ setup: 'later' });
    expect(textOf(html)).toContain('Permissions You Control');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('a returning person with records who turned every permission off gets the ordinary home', async () => {
    data.applicants = [SELF];
    const html = await page();
    expect(textOf(html)).not.toMatch(/Step \d of \d/);
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('someone who turned core processing off with another consent still on keeps every control', async () => {
    data.consents = { MARKETING: { grantedAt: new Date() } };
    const html = await page();
    expect(textOf(html)).not.toMatch(/Step \d of \d/);
    expect(stubProps(html, 'ConsentButton')).toHaveLength(6);
  });

  it('then asks who the record is for on the page that becomes "what do you want to do?"', async () => {
    data.consents = CORE;
    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/app?welcome=1');
    const html = await page({ welcome: '1' });
    expect(textOf(html)).toContain('Step 3 of 3');
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
    // Someone who came for a task is not asked for a country first: two screens, as before.
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
    expect(text).toContain('Account Overview');
    expect(text).not.toMatch(/Step \d of \d/);
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
      expect(text).toContain('Account Overview');
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
    // Prepare a Brief is offered now that its screen exists, and goes to that person's outputs page.
    expect(text).toContain('Prepare a Brief');
    expect(html).toContain(`href="/app/applicant/${SELF.id}/outputs?output=agency_brief"`);
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
    expect(text).not.toMatch(/Step \d of \d/);
    expect(text).not.toContain('What do you want to do?');
    expect(text).toContain('Account Overview');
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
      expect(textOf(await page())).not.toMatch(/Step \d of \d/);
      expect(textOf(await page())).not.toContain('Where do you want to go?');
      data.consents = CORE;
      const text = textOf(await page());
      expect(text).not.toMatch(/Step \d of \d/);
      expect(text).toContain('Account Overview');
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

describe('first run starts with a country (Growth G2)', () => {
  it('shows the country screen first, with the checklist box and a way to skip', async () => {
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Step 1 of 3');
    expect(text).toContain('Where do you want to go?');
    expect(text).toContain('Which Country Do You Want to Visit?');
    expect(text).toContain('Your checklist appears here as soon as you pick a country.');
    // Skipping goes on to the permission screen, with no country.
    expect(html).toContain('href="/app?step=consent"');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(0);
    expect(text).not.toContain('Continue With');
  });

  it('keeps a carried country when the person skips the step, without recording anything', async () => {
    const html = await page({ country: 'JP' });
    expect(html).toContain('href="/app?country=JP&amp;step=consent"');
  });

  it('opens on a country carried from the home page, with its checklist and a Continue button', async () => {
    const html = await page({ country: 'jp' });
    const text = textOf(html);
    expect(text).toContain('Showing the checklist for Japan');
    expect(text).toContain('Continue With Japan');
    expect(html).toMatch(/<input type="hidden" name="country" value="JP"/);
    expect(text).toContain('It is not a decision and not a promise');
  });

  it('ignores a country it does not hold, however it is written', async () => {
    for (const country of ['ZZ', 'Japan', '<script>', 'J', '']) {
      const text = textOf(await page({ country }));
      expect(text, country).toContain('Your checklist appears here');
      expect(text, country).not.toContain('Continue With');
    }
  });

  it('shows the chosen country on the permission screen, with a way back to change it', async () => {
    const html = await page({ country: 'JP', step: 'consent' });
    const text = textOf(html);
    expect(text).toContain('Step 2 of 3');
    expect(text).toContain('Your Country: Japan');
    expect(html).toContain('href="/app?country=JP"');
    expect(stubProps(html, 'ConsentButton')).toHaveLength(1);
    // A country we do not hold shows nothing rather than a guess.
    expect(textOf(await page({ country: 'ZZ', step: 'consent' }))).not.toContain('Your Country');
  });

  it('keeps the country through "who is this record for?" and offers its checklist at the end', async () => {
    data.consents = CORE;
    await expect(page({ country: 'JP' })).rejects.toThrow(
      'NEXT_REDIRECT:/app?welcome=1&country=JP',
    );
    // A code we do not hold is dropped, not carried.
    await expect(page({ country: 'ZZ' })).rejects.toThrow('NEXT_REDIRECT:/app?welcome=1');
    const name = await page({ welcome: '1', country: 'JP' });
    expect(textOf(name)).toContain('Step 3 of 3');
    expect(textOf(name)).toContain('Your Country: Japan');
    data.applicants = [SELF];
    const done = await page({ welcome: '1', country: 'JP' });
    expect(textOf(done)).toContain('See Your Japan Checklist');
    expect(done).toContain('href="/app/countries/jp"');
    expect(textOf(await page({ welcome: '1' }))).not.toContain('Checklist');
  });

  it('does not put the country screen in front of someone who came for a task', async () => {
    const next = '/app/client-invitations/accept?token=abc';
    const text = textOf(await page({ next }));
    expect(text).toContain('Step 1 of 2');
    expect(text).not.toContain('Where do you want to go?');
  });

  it('does not show the country screen once "Not Now" or a returning visit skips first run', async () => {
    expect(textOf(await page({ setup: 'later' }))).not.toContain('Where do you want to go?');
    data.consents = CORE;
    data.applicants = [SELF];
    expect(textOf(await page({ country: 'JP' }))).not.toContain('Where do you want to go?');
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

  it('does not call a case checklist-less when its count just could not be read', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.missions = 1;
    data.readinessError = 'internal';
    const html = await page();
    const start = html.indexOf('id="home-work-heading"');
    const work = html.slice(start, html.indexOf('id="home-journey"', start));
    expect(textOf(work)).toContain('Open the case to see its progress.');
    expect(textOf(work)).not.toContain('Pick a checklist');
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
    // The same warning colour family as the request's own screen.
    expect(work).toContain('Action Needed');
    expect(html).toContain('badge badge-warning');
    expect(work).toContain('Synthetic Case 1');
    expect(work).toContain('Synthetic Case 2');
  });

  it('draws the progress ring on each active case from its readiness, and an empty one where no checklist is attached', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.missions = 2;
    data.readiness = { requiredCount: 9, satisfiedRequired: 3 };
    const rawWork = async () => {
      const html = await page();
      const start = html.indexOf('id="home-work-heading"');
      return html.slice(start, html.indexOf('id="home-journey"', start));
    };
    const ready = await rawWork();
    expect(ready.match(/aria-label="3 of 9 items ready"/g)).toHaveLength(2);
    expect(ready).toContain('>3 of 9 items ready<');
    data.readiness = null;
    const empty = await rawWork();
    expect(empty.match(/aria-label="No checklist yet"/g)).toHaveLength(2);
    expect(empty).toContain('Pick a checklist to see what is ready');
    // Inside a link row there is no second link to nest.
    expect(empty).not.toContain('Pick a Checklist');
    expect(empty).not.toMatch(/\d+ of \d+ items ready/);
  });

  it('when the gate refuses, still shows Home without attention items', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.items = [overdueTask];
    data.gateRefuses = true;
    const html = await page();
    const text = textOf(html);
    expect(text).toContain('Account Overview');
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

describe('Coming Up: the deadline clock on Home (Growth G5)', () => {
  const OTHER = {
    id: '10000000-0000-4000-8000-000000000002',
    displayName: 'Synthetic Partner',
    createdAt: new Date('2026-02-01T00:00:00Z'),
  };

  function dated(
    key: string,
    person: { id: string; displayName: string },
    overrides: Partial<DeadlineEntry> = {},
  ): DeadlineEntry {
    return {
      key,
      kind: 'document_expires',
      applicantId: person.id,
      applicantName: person.displayName,
      date: '2026-11-07',
      daysUntil: 12,
      urgency: 'month',
      docType: 'PASSPORT',
      subject: null,
      label: null,
      doubt: null,
      caseId: null,
      href: `/app/applicant/${person.id}/expiry`,
      ...overrides,
    };
  }

  function comingUp(html: string): string {
    const start = html.indexOf('id="home-coming-up-heading"');
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf('id="home-records-heading"', start));
  }

  it('lists the next three dates across everyone, soonest first, each with a plain time and a tone word', async () => {
    data.consents = CORE;
    data.applicants = [SELF, OTHER];
    data.deadlines = [
      dated('document_expires:far', SELF, { daysUntil: 200, urgency: 'later', date: '2027-05-14' }),
      dated('task_due:late', OTHER, {
        kind: 'task_due',
        docType: null,
        label: 'Pay the visa fee',
        daysUntil: -3,
        urgency: 'overdue',
        date: '2026-10-23',
        href: '/app/mission/case-1',
      }),
      dated('document_expires:soon', OTHER, { daysUntil: 1, urgency: 'soon', date: '2026-10-27' }),
      dated('request_due:mid', SELF, {
        kind: 'request_due',
        docType: null,
        subject: {
          kind: 'request',
          requestKind: 'DOCUMENT',
          docType: 'BANK_STATEMENT',
          fieldKey: null,
        },
        daysUntil: 12,
        urgency: 'month',
        date: '2026-11-07',
        href: `/app/applicant/${SELF.id}/evidence`,
      }),
    ];
    const html = comingUp(await page());
    const text = textOf(html);
    // Three, soonest first: overdue, tomorrow, then twelve days. The far date is left out.
    expect(text.indexOf('Pay the visa fee')).toBeLessThan(text.indexOf('Passport'));
    expect(text.indexOf('Passport')).toBeLessThan(text.indexOf('Bank Statement'));
    expect(text).not.toContain('in about 6 months');
    expect(text).toContain('Was due 3 days ago');
    expect(text).toContain('Expires tomorrow');
    expect(text).toContain('Due in 12 days');
    for (const word of ['Overdue', 'Within a Week', 'Within a Month']) {
      expect(text).toContain(word);
    }
    // Whose date it is, because there is more than one person.
    expect(text).toContain('Synthetic Partner');
    expect(text).toContain('Synthetic Self');
    // Each links to the page where it is dealt with.
    expect(html).toContain('href="/app/mission/case-1"');
    expect(html).toContain(`href="/app/applicant/${SELF.id}/evidence"`);
    expect(html).toContain(`href="/app/applicant/${OTHER.id}/expiry"`);
  });

  it('sits between Needs Attention and My Records, and keeps the order of the sections around it', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.items = [
      attentionItem({
        key: 'task:x',
        kind: 'task',
        title: 'Book the Visa Appointment',
        applicantId: SELF.id,
        applicantName: SELF.displayName,
        dueDate: '2026-10-20',
        dueState: 'overdue',
        daysUntilDue: -6,
      }),
      attentionItem({
        key: 'task:y',
        kind: 'task',
        title: 'Print the Photo',
        applicantId: SELF.id,
        applicantName: SELF.displayName,
        dueDate: '2026-10-21',
        dueState: 'overdue',
        daysUntilDue: -5,
      }),
    ];
    data.deadlines = [dated('document_expires:a', SELF)];
    const html = await page();
    const order = [
      'id="home-attention-heading"',
      'id="home-coming-up-heading"',
      'id="home-records-heading"',
      'id="home-work-heading"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('with one person, leaves out their name and links to the full list', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.deadlines = [dated('document_expires:a', SELF)];
    const html = comingUp(await page());
    expect(textOf(html)).not.toContain('Synthetic Self');
    expect(html).toContain(
      `<a href="/app/applicant/${SELF.id}/expiry" class="deadline-more-link">`,
    );
  });

  it('teaches when there are no dates, with the add-document button, and does not call it unavailable', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    const html = comingUp(await page());
    const text = textOf(html);
    expect(text).toContain('No Dates Yet');
    expect(text).toContain(
      'Add a passport and its expiry date appears here, so you hear about it before it matters.',
    );
    expect(html).toContain(`href="/app/applicant/${SELF.id}/documents"`);
    expect(text).toContain('Add a Document');
    expect(text).not.toContain('unavailable');
  });

  it('labels a date it is unsure of Check This Date and words it as conditional', async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.deadlines = [
      dated('document_expires:u', SELF, { docType: null, doubt: 'kind_not_accepted' }),
    ];
    const text = textOf(comingUp(await page()));
    expect(text).toContain('Check This Date');
    expect(text).toContain('Expires in 12 days, if the date is right');
    expect(text).toContain('Document');
  });

  it("says dates are unavailable, not empty, when nobody's could be read", async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.deadlineFails = [SELF.id];
    const text = textOf(comingUp(await page()));
    expect(text).toContain('Dates are unavailable right now.');
    expect(text).not.toContain('No Dates Yet');
  });

  it('shows the dates it could read and says how many people it could not', async () => {
    data.consents = CORE;
    data.applicants = [SELF, OTHER];
    data.deadlineFails = [OTHER.id];
    data.deadlines = [dated('document_expires:a', SELF)];
    const text = textOf(comingUp(await page()));
    expect(text).toContain('Expires in 12 days');
    expect(text).toContain('Dates for 1 person could not be read.');
  });

  it('is not shown before core processing is on, or with nobody on the account', async () => {
    data.applicants = [SELF];
    data.deadlines = [dated('document_expires:a', SELF)];
    expect(await page()).not.toContain('home-coming-up-heading');
    data.consents = CORE;
    data.applicants = [];
    data.deadlines = [];
    expect(await page({ setup: 'later' })).not.toContain('home-coming-up-heading');
  });

  it("never carries another person's date: only the people on this account are read", async () => {
    data.consents = CORE;
    data.applicants = [SELF];
    data.deadlines = [
      dated('document_expires:mine', SELF),
      dated('document_expires:foreign', {
        id: '10000000-0000-4000-8000-0000000000ff',
        displayName: 'Someone Else',
      }),
    ];
    const text = textOf(comingUp(await page()));
    expect(text).not.toContain('Someone Else');
  });
});

describe('Home depth levels (CCD-2)', () => {
  const own = { ...SELF, displayName: 'Karim Hossain', relationship: 'SELF' };

  it('greets the person by first name, from the record they keep for themselves', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [own as never];
    const html = await renderServer(Page({}));
    expect(html).toMatch(/<h1[^>]*>Welcome back, Karim<\/h1>/);
  });

  it('greets without a name when there is no record of their own', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [{ ...SELF, relationship: 'SPOUSE' } as never];
    const html = await renderServer(Page({}));
    expect(html).toMatch(/<h1[^>]*>Welcome back<\/h1>/);
  });

  it('keeps the next step at every level and puts the working view at Browse and the rest at Everything', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [own as never];
    data.documents = 1;
    data.missions = 1;
    data.items = [
      attentionItem({ key: 'task:a', tier: 3, title: 'Book It', dueState: 'due_soon' }),
    ];
    data.openRequests = 1;
    const html = await renderServer(Page({}));
    expect(html).toContain('data-depth-scope="home"');
    const levelOf = (selector: string) =>
      new JSDOM(html).window.document
        .querySelector(selector)
        ?.closest('[data-level]')
        ?.getAttribute('data-level');
    expect(levelOf('#home-attention-heading')).toBe('browse');
    expect(levelOf('#home-records-heading')).toBe('browse');
    expect(levelOf('#home-work-heading')).toBe('browse');
    expect(levelOf('#permissions')).toBe('everything');
    expect(levelOf('#home-journey')).toBe('everything');
    // The next step comes before every gated block, so it shows at Glance.
    expect(html.indexOf('Next Step')).toBeGreaterThan(-1);
    expect(html.indexOf('Next Step')).toBeLessThan(html.indexOf('data-level='));
  });

  it('says how many more things are waiting, only at Glance, with a link that opens them', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [own as never];
    data.items = [
      attentionItem({ key: 'task:a', tier: 3, title: 'First', dueState: 'due_soon' }),
      attentionItem({ key: 'task:b', tier: 4, title: 'Second', dueState: 'due_soon' }),
      attentionItem({ key: 'task:c', tier: 5, title: 'Third', dueState: 'due_soon' }),
    ];
    const html = await renderServer(Page({}));
    expect(html).toContain('data-only="glance"');
    expect(textOf(html)).toContain('2 more things are waiting.');
    expect(html).toContain('href="#home-attention-heading"');
  });

  it('shows no waiting line when nothing else is waiting', async () => {
    data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
    data.applicants = [own as never];
    const html = await renderServer(Page({}));
    expect(html).not.toContain('data-only="glance"');
  });

  it('keeps the permissions at every level while core processing is off, because they are the next step', async () => {
    data.applicants = [own as never];
    const html = await renderServer(Page({}));
    const permissions = new JSDOM(html).window.document.querySelector('#permissions');
    expect(permissions).not.toBeNull();
    expect(permissions?.closest('[data-level]')).toBeNull();
  });
});
