import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagEmoji } from '../../../../../components/country-flag';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../../lib/next-mocks.test-support';

/** Document Requests pages (UMPE P6). Synthetic values only; the services are stand-ins here. */

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  choices: vi.fn(),
  summary: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.test' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  agencyCollectionPrincipal: mocks.principal,
  listCollectionRequests: mocks.list,
  getCollectionRequest: mocks.get,
  listCollectionPackChoices: mocks.choices,
  summariseCollectionAnswers: mocks.summary,
}));
vi.mock('./collection-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    NewRequestForm: stub('NewRequestForm'),
    AddItemForm: stub('AddItemForm'),
    ItemEditForm: stub('ItemEditForm'),
    PackChoiceForm: stub('PackChoiceForm'),
    IssueRequestForm: stub('IssueRequestForm'),
    NewLinkForm: stub('NewLinkForm'),
    EmailLinkForm: stub('EmailLinkForm'),
    EndRequestForm: stub('EndRequestForm'),
  };
});

const NOT_EMAILED = {
  status: 'NOT_EMAILED',
  reason: null,
  retrying: false,
  sentAt: null,
  deliveredAt: null,
} as const;

const { default: ListPage } = await import('./page');
const { default: NewPage } = await import('./new/page');
const { default: DetailPage } = await import('./request/page');

const ORG = '20000000-0000-4000-8000-000000000001';
const REQ = '30000000-0000-4000-8000-000000000001';
const props = { params: Promise.resolve({ orgId: ORG }) };
const detailProps = {
  params: Promise.resolve({ orgId: ORG }),
  searchParams: Promise.resolve({ id: REQ }),
};

const official = {
  id: 'r1',
  label: 'Passport',
  kind: 'DOCUMENT',
  fieldKey: null,
  docType: 'passport',
  necessity: 'MANDATORY',
  provenance: 'OFFICIAL',
  groupKey: null,
  note: null,
  order: 0,
  source: 'r1',
  citation: 'Synthetic rule 1',
};
const agencyItem = {
  ...official,
  id: 'a1',
  label: 'Employer Letter',
  docType: null,
  necessity: 'RECOMMENDED',
  provenance: 'AGENCY_ADDED',
  source: 'agency',
  citation: null,
  order: 1,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    status: 'DRAFT',
    storedStatus: 'DRAFT',
    destination: 'GB',
    purpose: 'Tourism',
    route: null,
    travelFrom: null,
    travelTo: null,
    dueAt: null,
    nationality: null,
    residence: null,
    applicationPlace: null,
    recipientNameHint: 'Synthetic Person',
    recipientEmailHint: null,
    createdAt: new Date('2026-11-02T00:00:00Z'),
    draftPack: { packVersionId: 'pv1', packName: 'Synthetic UK Visit', version: 1 },
    draftItems: [official, agencyItem],
    revisions: [],
    links: [],
    ...overrides,
  };
}

/** The page's words as a reader hears them: the flags are hidden from readers, so they are left out. */
const spoken = (html: string) =>
  textOf(html.replace(/<span class="country-flag"[^>]*>.*?<\/span>/g, ''));

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = `/app/agency/${ORG}/collection`;
  mocks.principal.mockResolvedValue({ ok: true, value: { authority: 'ADMIN' } });
  mocks.choices.mockResolvedValue({ ok: true, value: [] });
  mocks.summary.mockResolvedValue(new Map());
});
afterEach(() => vi.unstubAllEnvs());

describe('Document Requests pages', () => {
  it('are not found when the scope is refused (switch off, not an owner or admin, other agency)', async () => {
    mocks.principal.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(ListPage(props)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(NewPage(props)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(DetailPage(detailProps)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('are not found for a request this agency cannot see', async () => {
    mocks.get.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(DetailPage(detailProps)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('list every status in plain words', async () => {
    const at = new Date('2026-11-02T00:00:00Z');
    mocks.list.mockResolvedValue({
      ok: true,
      value: ['DRAFT', 'SENT', 'EXPIRED', 'REVOKED', 'CLOSED'].map((status, i) => ({
        id: `3000000${i}-0000-4000-8000-000000000001`,
        status,
        destination: 'GB',
        purpose: i === 0 ? null : 'Tourism',
        route: null,
        recipientNameHint: null,
        dueAt: null,
        createdAt: at,
        updatedAt: at,
      })),
    });
    const text = textOf(await renderServer(ListPage(props)));
    for (const word of ['Draft', 'Sent', 'Expired', 'Revoked', 'Closed', 'Not Sure Yet']) {
      expect(text).toContain(word);
    }
    expect(text).toContain('United Kingdom');
  });

  it('draws the flag beside the written destination in the list, and none for a code it does not hold (P16)', async () => {
    const at = new Date('2026-11-02T00:00:00Z');
    const base = {
      status: 'SENT',
      purpose: 'Tourism',
      route: null,
      recipientNameHint: 'Synthetic Anna',
      dueAt: null,
      createdAt: at,
      updatedAt: at,
    };
    mocks.list.mockResolvedValue({
      ok: true,
      value: [
        { ...base, id: '30000001-0000-4000-8000-000000000001', destination: 'GB' },
        { ...base, id: '30000002-0000-4000-8000-000000000001', destination: 'ZZ' },
      ],
    });
    const html = await renderServer(ListPage(props));
    const cells = html.split('<td data-label="Destination">').slice(1);
    expect(cells).toHaveLength(2);
    expect(cells[0]?.split('</td>')[0]).toBe(
      `<span class="country-flag-inline"><span class="country-flag" data-size="sm" data-flag-kind="emoji" aria-hidden="true">${flagEmoji('GB')}</span>United Kingdom</span>`,
    );
    // A code the country list does not hold is written as it is: no flag, no empty badge.
    expect(cells[1]?.split('</td>')[0]).toBe('ZZ');
    expect(html.match(/class="country-flag"/g)).toHaveLength(1);
    expect(html).not.toContain('country-flag-unknown');
  });

  describe('the list, by status', () => {
    const at = new Date('2026-11-02T00:00:00Z');
    const row = (n: number, status: string, who: string | null) => ({
      id: `3000000${n}-0000-4000-8000-000000000001`,
      status,
      destination: 'GB',
      purpose: 'Tourism',
      route: null,
      recipientNameHint: who,
      dueAt: null,
      createdAt: at,
      updatedAt: at,
    });
    const list = (params: { status?: string | string[] } = {}) =>
      renderServer(ListPage({ ...props, searchParams: Promise.resolve(params) }));

    beforeEach(() => {
      mocks.list.mockResolvedValue({
        ok: true,
        value: [
          row(1, 'SENT', 'Synthetic Anna'),
          row(2, 'SENT', 'Synthetic Ben'),
          row(3, 'DRAFT', null),
          row(4, 'CLOSED', 'Synthetic Cara'),
        ],
      });
    });

    it('leads with the customer, names an unnamed request in words, and labels every cell', async () => {
      const html = await list();
      expect(html).toContain('>Synthetic Anna</a>');
      expect(html).toContain('>Not Named Yet</a>');
      expect(html.match(/<td data-label="For"/g)).toHaveLength(4);
      for (const label of ['Destination', 'Purpose', 'Status', 'Created']) {
        expect(html.match(new RegExp(`<td data-label="${label}"`, 'g'))).toHaveLength(4);
      }
    });

    it('offers a filter only for statuses that have a request, each with its count', async () => {
      const text = textOf(await list());
      expect(text).toContain('All 4');
      expect(text).toContain('Sent 2');
      expect(text).toContain('Draft 1');
      expect(text).toContain('Closed 1');
      expect(text).not.toContain('Expired 0');
      expect(text).not.toMatch(/Revoked \d/);
    });

    it('shows only the chosen status, marks it as the current one, and ignores a value that is not a status', async () => {
      const sent = await list({ status: 'SENT' });
      expect(sent).toContain('Synthetic Anna');
      expect(sent).toContain('Synthetic Ben');
      expect(sent).not.toContain('Synthetic Cara');
      expect(sent.match(/aria-current="page"/g)).toHaveLength(1);
      expect(sent).toMatch(/aria-current="page"[^>]*>Sent/);
      const odd = await list({ status: 'NOPE' });
      expect(odd).toContain('Synthetic Cara');
      expect(odd).toMatch(/aria-current="page"[^>]*>All/);
      // A status with no request is not offered, so asking for it shows everything.
      expect(await list({ status: 'REVOKED' })).toContain('Synthetic Cara');
    });
  });

  describe('the answers on the list (UMPE UX5)', () => {
    const at = new Date('2026-11-02T00:00:00Z');
    const ids = [1, 2, 3, 4].map((n) => `3000000${n}-0000-4000-8000-000000000001`);
    const row = (n: number, status: string, who: string) => ({
      id: ids[n - 1],
      status,
      destination: 'GB',
      purpose: 'Tourism',
      route: null,
      recipientNameHint: who,
      dueAt: null,
      createdAt: at,
      updatedAt: at,
    });
    const list = (params: { status?: string; review?: string } = {}) =>
      renderServer(ListPage({ ...props, searchParams: Promise.resolve(params) }));
    const counts = (
      answers: number,
      waiting: number,
      needsCorrection: number,
      accepted: number,
    ) => ({
      answers,
      waiting,
      needsCorrection,
      accepted,
    });

    beforeEach(() => {
      mocks.list.mockResolvedValue({
        ok: true,
        value: [
          row(1, 'SENT', 'Synthetic Anna'),
          row(2, 'SENT', 'Synthetic Ben'),
          row(3, 'DRAFT', 'Synthetic Dev'),
          row(4, 'CLOSED', 'Synthetic Cara'),
        ],
      });
      mocks.summary.mockResolvedValue(
        new Map([
          [ids[0], counts(3, 2, 1, 0)],
          [ids[1], counts(1, 0, 0, 1)],
          [ids[3], counts(2, 1, 0, 1)],
        ]),
      );
    });

    it('shows an owner or admin the answers of each listed request, and a dash where there are none', async () => {
      const html = await list();
      expect(mocks.summary).toHaveBeenCalledTimes(1);
      expect(mocks.summary.mock.calls[0]?.[2]).toEqual(ids);
      expect(html.match(/<td data-label="Answers"/g)).toHaveLength(4);
      const text = textOf(html);
      expect(text).toContain('3 Answers');
      expect(text).toContain('2 Waiting for Review');
      expect(text).toContain('1 Needs Correction');
      expect(text).toContain('1 Answer');
      expect(text).toContain('1 Accepted');
      expect(text).toContain('No Answers Yet');
    });

    it('never calls a waiting answer reviewed or accepted', async () => {
      mocks.summary.mockResolvedValue(new Map([[ids[0], counts(2, 2, 0, 0)]]));
      const text = textOf(await list());
      expect(text).toContain('2 Waiting for Review');
      expect(text).not.toMatch(/Reviewed|Accepted|Received/);
    });

    it('shows a member no answers column and never reads the answers', async () => {
      mocks.principal.mockResolvedValue({ ok: true, value: { authority: 'REQUESTER' } });
      const html = await list({ review: 'waiting' });
      expect(mocks.summary).not.toHaveBeenCalled();
      expect(html).not.toContain('data-label="Answers"');
      expect(html).not.toContain('>Answers<');
      const text = textOf(html);
      expect(text).not.toContain('Waiting for Review');
      // The filter is ignored for a member: every request is still listed.
      expect(text).toContain('Synthetic Cara');
      expect(text).toContain('Synthetic Dev');
    });

    it('offers Waiting for Review with the count of requests that have something waiting', async () => {
      const text = textOf(await list());
      expect(text).toContain('All Answers');
      expect(text).toContain('Waiting for Review 2');
    });

    it('offers no Waiting for Review filter when nothing is waiting', async () => {
      mocks.summary.mockResolvedValue(new Map([[ids[1], counts(1, 0, 0, 1)]]));
      const html = await list({ review: 'waiting' });
      expect(textOf(html)).not.toContain('All Answers');
      expect(html).toContain('Synthetic Dev');
    });

    it('shows only requests with answers waiting for ?review=waiting and marks it as current', async () => {
      const html = await list({ review: 'waiting' });
      expect(html).toContain('Synthetic Anna');
      expect(html).toContain('Synthetic Cara');
      expect(html).not.toContain('Synthetic Ben');
      expect(html).not.toContain('Synthetic Dev');
      expect(html).toMatch(/aria-current="page"[^>]*>Waiting for Review/);
      expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    });

    it('composes with the status filter, and each filter keeps the other in its links', async () => {
      const html = await list({ status: 'SENT', review: 'waiting' });
      expect(html).toContain('Synthetic Anna');
      expect(html).not.toContain('Synthetic Cara');
      expect(html).not.toContain('Synthetic Ben');
      expect(html).toContain(
        `href="/app/agency/${ORG}/collection?status=CLOSED&amp;review=waiting"`,
      );
      expect(html).toContain(`href="/app/agency/${ORG}/collection?status=SENT"`);
      // Nothing both sent and waiting: say so instead of an empty table.
      mocks.summary.mockResolvedValue(new Map([[ids[3], counts(1, 1, 0, 0)]]));
      expect(textOf(await list({ status: 'SENT', review: 'waiting' }))).toContain(
        'No requests match both filters',
      );
    });

    it('ignores a review value that is not waiting', async () => {
      const html = await list({ review: 'everything' });
      expect(html).toContain('Synthetic Ben');
      expect(html).toContain('Synthetic Dev');
      expect(html).toMatch(/aria-current="page"[^>]*>All Answers/);
    });
  });

  it('show official items as official and the agency items as the agency own', async () => {
    mocks.get.mockResolvedValue({ ok: true, value: detail() });
    const html = await renderServer(DetailPage(detailProps));
    const text = textOf(html);
    expect(text).toContain('Passport');
    expect(text).toContain('Mandatory · Official Requirement');
    expect(text).toContain('Recommended · Requested by Your Agency');
    expect(text).not.toMatch(/Employer Letter\s+Recommended · Official/);
    const edits = stubProps<{ removable: boolean; item: { agency: boolean } }>(
      html,
      'ItemEditForm',
    );
    expect(edits.map((e) => [e.item.agency, e.removable])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(stubProps(html, 'IssueRequestForm')).toHaveLength(1);
    expect(stubProps(html, 'NewLinkForm')).toHaveLength(0);
  });

  it('keeps the request heading text and draws the flag of its destination inside it, hidden from readers (P16)', async () => {
    mocks.get.mockResolvedValue({ ok: true, value: detail() });
    const html = await renderServer(DetailPage(detailProps));
    const heading = html.match(/<h1 class="page-title">(.*?)<\/h1>/)?.[1] ?? '';
    expect(spoken(heading)).toContain('Document Request: United Kingdom');
    expect(heading).toContain(
      `<span class="country-flag" data-size="md" data-flag-kind="emoji" aria-hidden="true">${flagEmoji('GB')}</span>`,
    );
    mocks.get.mockResolvedValue({ ok: true, value: detail({ destination: 'ZZ' }) });
    const unknown = await renderServer(DetailPage(detailProps));
    const plain = unknown.match(/<h1 class="page-title">(.*?)<\/h1>/)?.[1] ?? '';
    expect(spoken(plain)).toContain('Document Request: ZZ');
    expect(plain).not.toContain('country-flag');
  });

  it('label a request with no official checklist as the agency own, never official', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({ draftPack: null, draftItems: [agencyItem], purpose: null }),
    });
    const text = textOf(await renderServer(DetailPage(detailProps)));
    expect(text).toContain("Your agency's own checklist. It is not an official checklist");
    expect(text).not.toContain('Official Requirement');
  });

  it('offer sharing once sent, and never show an issued revision that no longer verifies', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({
        status: 'SENT',
        storedStatus: 'SENT',
        revisions: [
          {
            id: 'rev1',
            revisionNo: 1,
            issuedAt: new Date('2026-11-02T00:00:00Z'),
            packVersionId: 'pv1',
            packChecksum: 'a'.repeat(64),
            intact: false,
            items: [],
            brand: null,
          },
        ],
        links: [
          {
            id: 'l1',
            revisionNo: 1,
            state: 'OPEN',
            emailed: false,
            email: NOT_EMAILED,
            createdAt: new Date('2026-11-02T00:00:00Z'),
            expiresAt: new Date('2026-11-16T00:00:00Z'),
            lastOpenedAt: null,
          },
        ],
      }),
    });
    const html = await renderServer(DetailPage(detailProps));
    const text = textOf(html);
    expect(stubProps(html, 'NewLinkForm')).toHaveLength(1);
    expect(stubProps(html, 'EmailLinkForm')).toHaveLength(1);
    expect(text).toContain('This revision no longer matches what was issued');
    expect(text).toContain('Copied Link');
    expect(text).not.toMatch(/\bdelivered\b/i);
    // VS-018: answering through the link is built (the /collect desk), so the page says how it
    // works and its real limit instead of saying it opens in a later release.
    expect(text).not.toMatch(/later release|opens in a later|shows only who/i);
    expect(text).toContain('one-time code sent to the email address you entered');
    expect(text).toContain('choose Submit Documents. Nothing reaches you before that.');
    expect(text).toContain('Each file can be up to 4 MB.');
  });

  it('end: a revoked request offers no editing, sharing or ending', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({ status: 'REVOKED', storedStatus: 'REVOKED' }),
    });
    const html = await renderServer(DetailPage(detailProps));
    for (const form of ['ItemEditForm', 'IssueRequestForm', 'NewLinkForm', 'EndRequestForm']) {
      expect(stubProps(html, form)).toHaveLength(0);
    }
  });

  it('shows each link email truthfully: Sent to Mail Provider is not Delivered, Not Sent says why (UMPE G3)', async () => {
    const link = (id: string, email: Record<string, unknown>) => ({
      id,
      revisionNo: 1,
      state: 'OPEN',
      emailed: true,
      email: { ...NOT_EMAILED, ...email },
      createdAt: new Date('2026-11-02T00:00:00Z'),
      expiresAt: new Date('2026-11-16T00:00:00Z'),
      lastOpenedAt: null,
    });
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({
        links: [
          link('l1', { status: 'SENT', sentAt: new Date('2026-11-02T00:00:00Z') }),
          link('l2', { status: 'NOT_SENT', reason: 'LINK_CLOSED' }),
          link('l3', { status: 'QUEUED', retrying: true }),
        ],
      }),
    });
    const text = textOf(await renderServer(DetailPage(detailProps)));
    expect(text).toContain('Sent to Mail Provider');
    expect(text).not.toMatch(/\bDelivered\b/);
    expect(text).toContain('Not Sent');
    expect(text).toContain('The link closed before the email could go.');
    expect(text).toContain('Queued (Trying Again)');
  });

  it('a member with May Request Documents sees the request but no answers or corrections (UMPE G3)', async () => {
    const issued = detail({
      revisions: [
        {
          id: 'rev1',
          revisionNo: 1,
          issuedAt: new Date('2026-11-02T00:00:00Z'),
          packVersionId: 'pv1',
          packChecksum: 'a'.repeat(64),
          intact: true,
          items: [],
          brand: null,
        },
      ],
    });
    mocks.get.mockResolvedValue({ ok: true, value: issued });
    const asAdmin = textOf(await renderServer(DetailPage(detailProps)));
    expect(asAdmin).toContain('Answers');
    expect(asAdmin).toContain('Official Checklist Updates');

    mocks.principal.mockResolvedValue({ ok: true, value: { authority: 'REQUESTER' } });
    const asRequester = textOf(await renderServer(DetailPage(detailProps)));
    expect(asRequester).toContain('Issued Revisions');
    expect(asRequester).not.toContain('Answers');
    expect(asRequester).not.toContain('Official Checklist Updates');
  });
});
