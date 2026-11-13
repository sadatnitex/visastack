import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Sharing refusals on the sharing screen, in the visitor's language (table-driven). */

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', key: '' }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('@visastack/services', async (original) => {
  const real = await original<typeof import('@visastack/services')>();
  return {
    ...real,
    expandGrantScope: async () => ({
      ok: false,
      error: real.keyedError('invalid', state.key as never),
    }),
  };
});
vi.mock('../../../../../lib/hidden-record', async (original) => ({
  ...(await original<typeof import('../../../../../lib/hidden-record')>()),
  ownsGrant: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock('../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: vi.fn() }));
vi.mock('../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  tryEstablishStepUp: vi.fn(),
  establishStepUpProof: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));

const { expandGrantScopeAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const en = serviceMessages.en as Record<string, string>;
const bn = serviceMessages.bn as Record<string, string>;

// Grant refusals the sharing screen words through serviceErrorMessage, each with checked Bangla.
const SHARING_KEYS = [
  'sharing.acceptOnlyRecipient',
  'sharing.actionRequired',
  'sharing.aiAfterGrant',
  'sharing.cannotShareSelf',
  'sharing.caseAlreadyShared',
  'sharing.caseNotApplicants',
  'sharing.chooseCaseToAllow',
  'sharing.confirmToAllow',
  'sharing.consentRequired',
  'sharing.documentsNotApplicants',
  'sharing.expiredCannotResume',
  'sharing.expiryInvalid',
  'sharing.expiryPast',
  'sharing.grantMissing',
  'sharing.grantNotPending',
  'sharing.inviteEmailInvalid',
  'sharing.inviteNotPendingManage',
  'sharing.nameDocument',
  'sharing.noCategoryScope',
  'sharing.oneRecipientType',
  'sharing.ownerOnlyChange',
  'sharing.ownerOnlyChooseCase',
  'sharing.ownerOnlyGrant',
  'sharing.ownerOnlyRevoke',
  'sharing.purposeRequired',
  'sharing.recipientAccountMissing',
  'sharing.recipientOrganizationInactive',
  'sharing.recipientOrganizationMissing',
  'sharing.recipientRequired',
  'sharing.sharingEnded',
  'sharing.sharingMissing',
  'sharing.stepUpGrant',
] as const;

const form = () => {
  const data = new FormData();
  data.set('applicantId', '11111111-1111-4111-8111-111111111111');
  data.set('grantId', 'owned-grant');
  data.set('documentId', 'doc-1');
  return data;
};
const START = { ok: true, message: '' };

beforeEach(() => {
  state.locale = 'en';
});

describe('the sharing screen words each grant refusal in the visitor language', () => {
  it.each(SHARING_KEYS)('%s: the exact English under en, the Bangla under bn', async (key) => {
    state.key = key;
    expect(bn[key]).toMatch(BENGALI);
    expect(await expandGrantScopeAction(START, form())).toEqual({ ok: false, message: en[key] });
    state.locale = 'bn';
    expect(await expandGrantScopeAction(START, form())).toEqual({ ok: false, message: bn[key] });
  });
});
