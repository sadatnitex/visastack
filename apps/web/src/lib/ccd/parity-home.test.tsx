import type { AttentionItem, DeadlineEntry } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Home (screen 02): see parity-kit.test-support.ts for how the comparison works. */

const data = vi.hoisted(() => ({
  consents: {} as Record<string, unknown>,
  applicants: [] as { id: string; displayName: string; createdAt: Date; relationship?: string }[],
  documents: 0,
  openRequests: 0,
  withAgency: 0,
  missions: 0,
  pendingGrants: 0,
  memberships: [] as { active: boolean }[],
  platformAdmin: false,
  items: [] as AttentionItem[],
  deadlines: [] as DeadlineEntry[],
  readiness: null as { requiredCount: number; satisfiedRequired: number } | null,
  depth: 'auto' as string,
  events: [] as { seq: number; eventType: string }[],
  auditReads: [] as { applicantId: string; limit: unknown }[],
}));

vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' }),
}));
vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../admin', () => ({ holdsPlatformRole: async () => data.platformAdmin }));
vi.mock('./depth.server', () => ({ readDepth: async () => data.depth }));
vi.mock('@visastack/services', async (importOriginal) => {
  const { rankAttentionItems, rankDeadlines } =
    await importOriginal<typeof import('@visastack/services')>();
  return {
    rankAttentionItems,
    rankDeadlines,
    listDeadlineClock: async (access: { applicantId: string }) => ({
      ok: true,
      value: {
        applicantId: access.applicantId,
        entries: data.deadlines.filter((e) => e.applicantId === access.applicantId),
      },
    }),
    accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
    requireAccess: async (
      _db: unknown,
      _p: unknown,
      _a: unknown,
      ref: { applicantId: string },
    ) => ({
      ok: true,
      value: { actor: { kind: 'applicant_owner' }, applicantId: ref.applicantId },
    }),
    listNeedsAttention: async (access: { applicantId: string }) => {
      const name = data.applicants.find((a) => a.id === access.applicantId)?.displayName ?? '';
      return {
        ok: true,
        value: {
          applicantId: access.applicantId,
          applicantName: name,
          items: data.items.map((item) => ({
            ...item,
            applicantId: access.applicantId,
            applicantName: name,
          })),
          activeCases: Array.from({ length: data.missions }, (_, i) => ({
            id: `case-${access.applicantId.slice(-2)}-${i}`,
            title: `Synthetic Case ${i + 1}`,
            state: 'IN_PROGRESS',
          })),
          activeCaseCount: data.missions,
          requests: { waitingOnYou: data.openRequests, withAgency: data.withAgency },
        },
      };
    },
    computeReadiness: async () =>
      data.readiness
        ? { ok: true, value: data.readiness }
        : { ok: false, error: { code: 'invalid', message: 'no count' } },
    getConsents: async () => data.consents,
    listApplicants: async () => data.applicants,
    listGrantsForRecipientAccount: async () =>
      Array.from({ length: data.pendingGrants }, () => ({
        grant: { status: 'PENDING_ACCEPTANCE', createdAt: new Date('2026-10-01T00:00:00Z') },
      })),
    listAuditEventsForApplicant: async (
      _db: unknown,
      _account: string,
      applicantId: string,
      limit: unknown,
    ) => {
      data.auditReads.push({ applicantId, limit });
      return data.events.map((event) => ({
        ...event,
        actorEmail: 'me@example.com',
        action: null,
        result: 'ALLOWED',
        occurredAt: new Date('2026-11-09T10:00:00Z'),
        agencyAi: null,
      }));
    },
    listMembershipsForAccount: async () => data.memberships,
    listDocuments: async () => ({ ok: true, value: Array.from({ length: data.documents }) }),
  };
});
vi.mock('../../app/app/consent-button', async () => {
  const { stub } = await import('../next-mocks.test-support');
  return { ConsentButton: stub('ConsentButton') };
});

const { default: Page } = await import('../../app/app/(home)/page');

function item(overrides: Partial<AttentionItem> & Pick<AttentionItem, 'key'>): AttentionItem {
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

const person = (n: number, name: string, relationship = 'SELF') => ({
  id: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  displayName: name,
  relationship,
  createdAt: new Date(`2026-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`),
});

const consentOn = () => {
  data.consents = { CORE_PROCESSING: { grantedAt: new Date() } };
};

registerParity({
  name: 'home',
  reset: () => {
    data.consents = {};
    data.applicants = [];
    data.documents = 0;
    data.openRequests = 0;
    data.withAgency = 0;
    data.missions = 0;
    data.pendingGrants = 0;
    data.memberships = [];
    data.platformAdmin = false;
    data.items = [];
    data.deadlines = [];
    data.readiness = null;
    data.depth = 'auto';
    data.events = [];
    data.auditReads = [];
  },
  render: async () => await renderServer(Page({})),
  states: [
    {
      name: 'core processing off, one traveller',
      setup: () => {
        data.applicants = [person(1, 'Karim Hossain')];
      },
    },
    {
      name: 'nothing started yet, agency member',
      setup: () => {
        consentOn();
        data.memberships = [{ active: true }];
      },
    },
    {
      name: 'busy: requests, items, dates, a sharing invitation, one active case',
      setup: () => {
        consentOn();
        data.applicants = [person(1, 'Karim Hossain')];
        data.documents = 3;
        data.missions = 1;
        data.openRequests = 2;
        data.withAgency = 1;
        data.pendingGrants = 1;
        data.readiness = { requiredCount: 8, satisfiedRequired: 6 };
        data.items = [
          item({
            key: 'evidence_request:open-1',
            kind: 'evidence_request',
            tier: 1,
            title: 'Document Requested',
            why: 'An agency asked you for a document. Reply with a file from your documents.',
            caseTitle: 'Japan Tourist Visa',
            dueDate: '2026-10-20',
            dueState: 'overdue',
            daysUntilDue: -8,
            subject: {
              kind: 'request',
              requestKind: 'DOCUMENT',
              docType: 'BANK_STATEMENT',
              fieldKey: null,
            },
            href: '/app/applicant/x/evidence',
          }),
          item({
            key: 'task:t1',
            tier: 3,
            title: 'Book the Appointment',
            caseTitle: 'Japan Tourist Visa',
            dueDate: '2026-11-05',
            dueState: 'due_soon',
            daysUntilDue: 8,
            href: '/app/mission/case-01-0',
          }),
          item({
            key: 'suggestions:1',
            kind: 'suggestions',
            tier: 7,
            title: 'Suggested Details Waiting for Your Decision',
            why: 'Details were read from a document.',
            dueState: 'none',
            count: 2,
            href: '/app/applicant/x/documents',
          }),
        ];
        data.deadlines = [
          {
            applicantId: person(1, 'x').id,
            kind: 'document_expiry',
            label: 'Passport',
            date: '2027-01-14',
          } as unknown as DeadlineEntry,
        ];
      },
    },
    {
      name: 'all clear with a case and documents',
      setup: () => {
        consentOn();
        data.applicants = [person(1, 'Karim Hossain')];
        data.documents = 2;
        data.missions = 1;
      },
    },
    {
      name: 'a household of two',
      setup: () => {
        consentOn();
        data.applicants = [person(1, 'Karim Hossain'), person(2, 'Amina Rahman', 'SPOUSE')];
        data.documents = 1;
      },
    },
    {
      name: 'more people than Home reads',
      setup: () => {
        consentOn();
        data.applicants = Array.from({ length: 27 }, (_, i) =>
          person(i + 1, `Person ${i + 1}`, 'OTHER'),
        );
        data.documents = 1;
        data.missions = 1;
        data.items = [
          item({
            key: 'task:t9',
            tier: 3,
            title: 'Renew',
            dueDate: '2026-11-01',
            dueState: 'due_soon',
            daysUntilDue: 4,
          }),
        ];
      },
    },
  ],
});

describe('home: recent activity', () => {
  beforeEach(() => {
    data.consents = {};
    data.applicants = [];
    data.events = [];
    data.platformAdmin = false;
    data.memberships = [];
    data.items = [];
    data.deadlines = [];
    data.depth = 'auto';
    data.auditReads = [];
  });
  const events = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      seq: count - index,
      eventType: 'DOCUMENT_UPLOADED',
    }));
  const rows = (html: string) => html.match(/home-activity-row/g)?.length ?? 0;

  it('lists the newest five events of the own record with See All to its Access Log', async () => {
    consentOn();
    data.applicants = [person(1, 'Sam Other', 'CHILD'), person(2, 'Karim Hossain')];
    data.events = events(7);
    const html = await renderServer(Page({}));
    expect(html).toContain('Recent Activity');
    // The core call in the page asks for five; the mock returns more, and Home still shows five.
    expect(rows(html)).toBe(5);
    // One bounded read, for the own record only, never a loop over people.
    expect(data.auditReads).toEqual([{ applicantId: person(2, 'x').id, limit: 5 }]);
    expect(html).toContain('File Uploaded');
    expect(html).toContain(`href="/app/applicant/${person(2, 'x').id}/sharing#access-log"`);
  });

  it('says nothing yet in one plain line when the record has no events', async () => {
    consentOn();
    data.applicants = [person(1, 'Karim Hossain')];
    const html = await renderServer(Page({}));
    expect(html).toContain('Recent Activity');
    expect(rows(html)).toBe(0);
    expect(html).toContain('Nothing yet. Each time your record is opened or changed');
  });

  it('is left out while core processing is off', async () => {
    data.applicants = [person(1, 'Karim Hossain')];
    data.events = events(3);
    const html = await renderServer(Page({}));
    expect(html).not.toContain('Recent Activity');
    expect(data.auditReads).toEqual([]);
  });
});
