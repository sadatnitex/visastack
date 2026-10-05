import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latinWords,
  localeState,
  renderServer,
  stub,
  stubProps,
  textOf,
} from '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getConsents: vi.fn(),
  listApplicants: vi.fn(),
  listDocuments: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  listGrantsForRecipientAccount: vi.fn(),
  listMissions: vi.fn(),
  listPendingProposals: vi.fn(),
}));

vi.mock('@visastack/services', () => mocks);
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./consent-button', () => ({ ConsentButton: stub('ConsentButton') }));

const { default: Page } = await import('./page');

const BENGALI = /[ঀ-৿]/;

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.getConsents.mockResolvedValue({ CORE_PROCESSING: true, MARKETING: false });
  mocks.listGrantsForRecipientAccount.mockResolvedValue([
    { grant: { status: 'PENDING_ACCEPTANCE' } },
    { grant: { status: 'ACTIVE' } },
  ]);
  mocks.listApplicants.mockResolvedValue([
    { id: 'a1', displayName: 'রহিম উদ্দিন', relationship: 'SELF' },
    { id: 'a2', displayName: 'Karim', relationship: 'FAMILY_MEMBER' },
  ]);
  mocks.listDocuments.mockResolvedValue({ ok: true, value: [{}, {}] });
  mocks.listPendingProposals.mockImplementation(async (_db: unknown, id: string) =>
    id === 'a1' ? [{}] : [],
  );
  mocks.listMissions.mockResolvedValue({
    ok: true,
    value: [{ state: 'OPEN' }, { state: 'CLOSED' }],
  });
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({
    ok: true,
    value: [{ status: 'OPEN' }],
  });
});

describe('Overview in English', () => {
  it('reads exactly as it did, with the section named Overview', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Overview');
    expect(text).not.toContain('Home');
    expect(text).toContain('Welcome back');
    expect(text).toContain('traveller@example.com');
    expect(text).toContain('At a glance');
    expect(text).toContain('Needs your attention');
    expect(text).toContain('রহিম উদ্দিন - AI proposal(s) awaiting your review');
    expect(text).toContain('Evidence request(s) awaiting a response');
    expect(text).toContain('Sharing invitation(s) awaiting your acceptance');
    expect(text).toContain('Review রহিম উদ্দিন');
    expect(text).toContain('1 pending');
    expect(text).toContain('Core processing consent');
    expect(text).not.toMatch(/শুরু|সম্মতি|আবার/);
  });

  it('hands the consent buttons their English words', async () => {
    const html = await renderServer(Page());
    const buttons = stubProps<{ type: string; granted: boolean; messages: Record<string, string> }>(
      html,
      'ConsentButton',
    );
    expect(buttons).toHaveLength(6);
    expect(buttons[0]?.messages['consent.action.grant']).toBe('Grant');
    expect(buttons.find((b) => b.type === 'CORE_PROCESSING')?.granted).toBe(true);
    expect(buttons.find((b) => b.type === 'MARKETING')?.granted).toBe(false);
  });

  it('asks for core consent first when it has not been given', async () => {
    mocks.getConsents.mockResolvedValue({});
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Grant core processing consent');
    expect(text).not.toContain('At a glance');
  });
});

describe('Overview in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('is in Bangla from the heading to the consent list, with no English interface words left', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('আবার স্বাগতম');
    expect(text).toContain('এক নজরে');
    expect(text).toContain('আপনার মনোযোগ প্রয়োজন');
    expect(text).toContain('যে অনুমতিগুলো আপনার নিয়ন্ত্রণে');
    expect(text).toContain('মূল প্রক্রিয়াকরণ সম্মতি');
    // What is left in Latin script is what a person typed.
    expect([...new Set(latinWords(text))].sort()).toEqual(['Karim', 'com', 'example', 'traveller']);
  });

  it('writes the counts in Bengali digits and keeps a name exactly as it was typed', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('আবেদনকারী ২');
    expect(text).toContain('আপলোড করা নথি ৪');
    expect(text).toContain('চলমান কেস ২');
    expect(text).toContain('১টি অপেক্ষমাণ');
    expect(text).toContain('পর্যালোচনা করুন: রহিম উদ্দিন');
    expect(text).toContain('রহিম উদ্দিন - আপনার পর্যালোচনার অপেক্ষায় থাকা এআই প্রস্তাব');
  });

  it('hands the consent buttons Bangla words, never the catalog', async () => {
    const html = await renderServer(Page());
    const [first] = stubProps<{ messages: Record<string, string> }>(html, 'ConsentButton');
    expect(first?.messages).toEqual({
      'consent.action.grant': 'প্রদান করুন',
      'consent.action.revoke': 'প্রত্যাহার করুন',
      'consent.saving': 'সংরক্ষণ হচ্ছে…',
    });
  });

  it('says plainly that the consent wording is still waiting for a professional review', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('পেশাদার আইনি পর্যালোচনা এখনও শেষ হয়নি');
  });
});
