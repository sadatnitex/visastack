import { keyedError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Case-flow refusals (second half): what an agency member reads under each language. */

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  decide: vi.fn(),
  copy: vi.fn(),
  principal: vi.fn(),
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => mocks.locale }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  decideEvidenceResponse: mocks.decide,
  makeAgencyCopy: mocks.copy,
  agencyChecklistPrincipal: mocks.principal,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../../../lib/capabilities', () => ({
  getPlatformCapabilities: () => ({ agencyCollaboration: 'available' }),
  capabilityUnavailableMessage: () => 'unavailable',
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'signed-in-account' }),
}));

const { decideEvidenceResponseAction } = await import('./actions');
const { copyListAction } = await import('./checklists/actions');
const { serviceErrorMessage } = await import('../../../../lib/service-error-message');

const BENGALI = /[ঀ-৿]/;
const bn = serviceMessages.bn as Record<string, string>;
const en = serviceMessages.en as Record<string, string>;
const OURS = (key: string) =>
  /^(agency|agency_checklists|umpe_(collection|correction|document|outcome))/.test(key);
const bnKeys = Object.keys(bn).filter(OURS);
const enKeys = Object.keys(en).filter(OURS);

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const START = { ok: true, message: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.principal.mockResolvedValue({
    ok: true,
    value: { accountId: 'signed-in-account', organizationId: 'org-1' },
  });
});

describe('case-flow refusals in the visitor language', () => {
  it('has Bangla for some keys and English for all of them', () => {
    expect(enKeys.length).toBeGreaterThan(100);
    expect(bnKeys.length).toBeGreaterThan(0);
    for (const key of bnKeys) expect(en).toHaveProperty(key);
  });

  it('under en shows the exact English for every key', async () => {
    for (const key of enKeys) {
      expect(await serviceErrorMessage(keyedError('invalid', key as never))).toBe(en[key]);
    }
  });

  it('under bn renders Bangla for every key that has it (bn N = rendered N)', async () => {
    mocks.locale = 'bn';
    let rendered = 0;
    for (const key of bnKeys) {
      const text = await serviceErrorMessage(keyedError('invalid', key as never));
      expect(text).toMatch(BENGALI);
      expect(text).toBe(bn[key]);
      rendered += 1;
    }
    expect(rendered).toBe(bnKeys.length);
  });

  it('under bn keeps English for a key with no checked Bangla', async () => {
    mocks.locale = 'bn';
    const key = enKeys.find((k) => !(k in bn));
    expect(key).toBeDefined();
    expect(await serviceErrorMessage(keyedError('invalid', key as never))).toBe(en[key as string]);
  });

  it('a checklist action shows the Bangla under bn and the English under en', async () => {
    const key = 'agency.applicant_not_found';
    mocks.copy.mockResolvedValue({ ok: false, error: keyedError('not_found', key) });
    const data = form({ organizationId: 'org-1', packVersionId: 'pv1' });
    expect((await copyListAction(START, data)).message).toBe(en[key]);
    mocks.locale = 'bn';
    expect((await copyListAction(START, data)).message).toBe(bn[key]);
  });

  it('marks a replaced copy as stale under both languages, not by its wording', async () => {
    const key = 'agency.a_newer_copy_was_sent_or';
    mocks.decide.mockResolvedValue({ ok: false, error: keyedError('invalid', key) });
    const data = form({ organizationId: 'org-1', requestId: 'r1', outcome: 'ACCEPTED' });
    for (const locale of ['en', 'bn'] as const) {
      mocks.locale = locale;
      const result = await decideEvidenceResponseAction(START, data);
      expect(result.ok).toBe(false);
      expect(result.stale).toBe(true);
    }
    mocks.decide.mockResolvedValue({
      ok: false,
      error: keyedError('invalid', 'agency.task_not_found'),
    });
    expect((await decideEvidenceResponseAction(START, data)).stale).toBeUndefined();
  });
});
