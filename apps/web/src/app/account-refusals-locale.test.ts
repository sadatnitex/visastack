import { type ServiceError, keyedError, serviceError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account-side refusals in the visitor's language: joining an agency, account deletion, WhatsApp,
 * buying a plan, answering an agency request with an account, and workspace search. Each shows
 * the service's keyed words (checked Bangla where the register has it, the exact English
 * otherwise); an unkeyed refusal keeps the English the service sent. Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const svc = vi.hoisted(() => ({
  acceptOrganizationInvitation: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
  startWhatsAppLink: vi.fn(),
  startPersonCheckout: vi.fn(),
  submitCollectionResponse: vi.fn(),
  searchWorkspaceRecords: vi.fn(),
  requireAccess: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
  travellerPlansEnabled: () => false,
}));
vi.mock('../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.test', self: { accountId: 'acct-1' } }),
}));
vi.mock('../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'not configured',
  tryEstablishStepUp: async () => ({ kind: 'satisfied' }),
  establishStepUpProof: async () => ({ kind: 'proof', proof: {} }),
}));
vi.mock('../lib/whatsapp', () => ({
  readWhatsAppConfig: () => ({ businessNumber: '8801000000000' }),
}));
vi.mock('../lib/jobs', () => ({ triggerAccountExportWorker: vi.fn() }));
vi.mock('./collect/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./collect/load')>()),
  collectSwitchOn: () => true,
}));
vi.mock('./collect/account/link', () => ({ heldCollectionLink: async () => ({ proof: {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { acceptInvitationAction } = await import('./app/invitations/accept/actions');
const { cancelDeletionAction, requestDeletionAction } = await import('./app/privacy/actions');
const { startWhatsAppLinkAction } = await import('./app/account/whatsapp/actions');
const { buyPlanAction } = await import('./app/account/plan/actions');
const { submitResponseAction } = await import('./collect/account/actions');
const { POST: search } = await import('./api/workspace/search/route');

const BENGALI = /[ঀ-৿]/;
const bn = serviceMessages.bn as Readonly<Record<string, string>>;
const INITIAL = { ok: true, message: '' };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
const refused = (error: ServiceError) => ({ ok: false, error });

interface Row {
  readonly name: string;
  readonly key: ServiceMessageKey;
  readonly run: (error: ServiceError) => Promise<string>;
}

const message = async (state: Promise<{ readonly message: string }>) => (await state).message;

const ROWS: readonly Row[] = [
  ...(
    [
      'invitations.invitation_not_found',
      'invitations.already_used_or_revoked',
      'invitations.this_invitation_has_expired',
      'invitations.sent_to_a_different_email',
      'invitations.no_longer_taking_new_members',
    ] as const
  ).map(
    (key): Row => ({
      name: `join an agency: ${key}`,
      key,
      run: (error) => {
        svc.acceptOrganizationInvitation.mockResolvedValue(refused(error));
        return message(acceptInvitationAction(INITIAL, form({ token: 'tok' })));
      },
    }),
  ),
  ...(
    [
      'deletion.only_request_its_own_deletion',
      'deletion.a_deletion_request_is_already_pending',
      'deletion.an_active_legal_hold_blocks_deletion',
    ] as const
  ).map(
    (key): Row => ({
      name: `ask to delete the account: ${key}`,
      key,
      run: (error) => {
        svc.requestAccountDeletion.mockResolvedValue(refused(error));
        return message(requestDeletionAction(INITIAL, form({})));
      },
    }),
  ),
  ...(
    ['deletion.only_cancel_its_own_deletion', 'deletion.no_pending_deletion_request'] as const
  ).map(
    (key): Row => ({
      name: `cancel the deletion: ${key}`,
      key,
      run: (error) => {
        svc.cancelAccountDeletion.mockResolvedValue(refused(error));
        return message(cancelDeletionAction(INITIAL, form({})));
      },
    }),
  ),
  ...(
    [
      'whatsapp_link.agree_to_receive_messages_first',
      'whatsapp_link.whatsapp_is_not_available_yet',
      'whatsapp_link.please_try_again',
    ] as const
  ).map(
    (key): Row => ({
      name: `connect WhatsApp: ${key}`,
      key,
      run: (error) => {
        svc.startWhatsAppLink.mockResolvedValue(refused(error));
        return message(startWhatsAppLinkAction({ ok: true, message: '' }, form({ optIn: 'yes' })));
      },
    }),
  ),
  ...(
    [
      'umpe_collection_response_service.this_page_is_out_of_date',
      'umpe_collection_response_service.this_agency_has_not_been_reviewed',
      'umpe_collection_response_service.agree_to_share_before_you_submit',
    ] as const
  ).map(
    (key): Row => ({
      name: `answer an agency request: ${key}`,
      key,
      run: (error) => {
        svc.requireAccess.mockResolvedValue({ ok: true, value: {} });
        svc.submitCollectionResponse.mockResolvedValue(refused(error));
        return message(
          submitResponseAction(
            { ok: true, message: '' },
            form({ consent: 'on', personId: 'p-1', linkId: 'l-1' }),
          ),
        );
      },
    }),
  ),
  ...(
    [
      'workspace_search.choose_an_available_workspace',
      'workspace_search.use_between_2_and_80_characters',
      'workspace_search.this_traveller_workspace_is_unavailable',
    ] as const
  ).map(
    (key): Row => ({
      name: `search: ${key}`,
      key,
      run: async (error) => {
        svc.searchWorkspaceRecords.mockResolvedValue(refused(error));
        const response = await search(
          new Request('https://synthetic.example.test/api/workspace/search', {
            method: 'POST',
            headers: {
              Origin: 'https://synthetic.example.test',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: 'Synthetic', scope: { kind: 'personal' } }),
          }),
        );
        return ((await response.json()) as { error: string }).error;
      },
    }),
  ),
  {
    name: 'search: a one-letter query, checked before the service',
    key: 'workspace_search.use_between_2_and_80_characters',
    run: async () => {
      const response = await search(
        new Request('https://synthetic.example.test/api/workspace/search', {
          method: 'POST',
          headers: { Origin: 'https://synthetic.example.test', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'S', scope: { kind: 'personal' } }),
        }),
      );
      expect(svc.searchWorkspaceRecords).not.toHaveBeenCalled();
      return ((await response.json()) as { error: string }).error;
    },
  },
];

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.checkRateLimit.mockResolvedValue({ allowed: true });
  loc.locale = 'en';
});

describe('account refusals in the visitor language', () => {
  it.each(ROWS)('en: $name is the exact English', async (row) => {
    const error = keyedError('invalid', row.key);
    expect(await row.run(error)).toBe(error.message);
  });

  it.each(ROWS)(
    'bn: $name is the checked Bangla, or the English when there is none',
    async (row) => {
      loc.locale = 'bn';
      const error = keyedError('invalid', row.key);
      const own = bn[row.key];
      if (own !== undefined) expect(own).toMatch(BENGALI);
      expect(await row.run(error)).toBe(own ?? error.message);
    },
  );

  it('buying a plan: an unkeyed payment refusal keeps the English it was sent', async () => {
    loc.locale = 'bn';
    svc.startPersonCheckout.mockResolvedValue(
      refused(serviceError('rate_limited', 'Wait a minute.')),
    );
    const planId = '11111111-1111-4111-8111-111111111111';
    expect(await message(buyPlanAction({ ok: true, message: '' }, form({ planId })))).toBe(
      'Wait a minute.',
    );
  });
});
