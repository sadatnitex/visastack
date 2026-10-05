import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localeState } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
  enqueueAccountExportJob: vi.fn(),
  tryEstablishStepUp: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  requestAccountDeletion: mocks.requestAccountDeletion,
  cancelAccountDeletion: mocks.cancelAccountDeletion,
  enqueueAccountExportJob: mocks.enqueueAccountExportJob,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));
vi.mock('../../../lib/jobs', () => ({ triggerAccountExportWorker: vi.fn() }));
vi.mock('../../../lib/step-up', () => ({ tryEstablishStepUp: mocks.tryEstablishStepUp }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { cancelDeletionAction, requestDeletionAction, requestLargeExportAction } = await import(
  './actions'
);

const INITIAL = { ok: true, message: '' };
const empty = new FormData();

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.requestAccountDeletion.mockResolvedValue({
    ok: true,
    value: { scheduledFor: new Date('2026-10-12T00:00:00Z') },
  });
  mocks.cancelAccountDeletion.mockResolvedValue({ ok: true, value: {} });
  mocks.enqueueAccountExportJob.mockResolvedValue(undefined);
});

describe('requestDeletionAction', () => {
  it('confirms the date in English as a spelled-out day-first date', async () => {
    expect(await requestDeletionAction(INITIAL, empty)).toEqual({
      ok: true,
      message: 'Deletion scheduled for 12 October 2026. You can cancel any time before then.',
    });
  });

  it('confirms the date in Bangla, in Bengali digits', async () => {
    localeState.value = 'bn';
    expect(await requestDeletionAction(INITIAL, empty)).toEqual({
      ok: true,
      message:
        'মুছে ফেলার তারিখ নির্ধারিত হয়েছে: ১২ অক্টোবর, ২০২৬। তার আগে যেকোনো সময় আপনি এটি বাতিল করতে পারেন।',
    });
  });

  it('explains a blocking legal hold in the readers language, not in raw service wording', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'an active legal hold blocks deletion',
        key: 'privacy.error.holdBlocks',
      },
    });
    expect(await requestDeletionAction(INITIAL, empty)).toEqual({
      ok: false,
      message: 'An active legal hold blocks deletion.',
    });
    localeState.value = 'bn';
    expect(await requestDeletionAction(INITIAL, empty)).toEqual({
      ok: false,
      message: 'একটি সক্রিয় আইনি সংরক্ষণ আদেশের কারণে মুছে ফেলা আটকে আছে।',
    });
  });

  it('says in Bangla when step-up is not set up', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    localeState.value = 'bn';
    expect(await requestDeletionAction(INITIAL, empty)).toEqual({
      ok: false,
      message: 'এই কাজের জন্য স্টেপ-আপ যাচাই প্রয়োজন, যা এই পরিবেশে চালু করা নেই।',
    });
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();
  });
});

describe('cancelDeletionAction', () => {
  it('confirms the cancellation in each language', async () => {
    expect(await cancelDeletionAction(INITIAL, empty)).toEqual({
      ok: true,
      message: 'Deletion request cancelled.',
    });
    localeState.value = 'bn';
    expect(await cancelDeletionAction(INITIAL, empty)).toEqual({
      ok: true,
      message: 'মুছে ফেলার অনুরোধ বাতিল করা হয়েছে।',
    });
  });

  it('says in the readers language when there is nothing to cancel', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue({
      ok: false,
      error: {
        code: 'not_found',
        message: 'no pending deletion request',
        key: 'privacy.error.noPending',
      },
    });
    localeState.value = 'bn';
    expect(await cancelDeletionAction(INITIAL, empty)).toEqual({
      ok: false,
      message: 'মুছে ফেলার কোনো অপেক্ষমাণ অনুরোধ নেই।',
    });
  });
});

describe('requestLargeExportAction', () => {
  it('says the export is being prepared, in each language', async () => {
    expect(await requestLargeExportAction(INITIAL, empty)).toEqual({
      ok: true,
      message: 'Preparing your export. This can take a few minutes.',
    });
    localeState.value = 'bn';
    expect(await requestLargeExportAction(INITIAL, empty)).toEqual({
      ok: true,
      message: 'আপনার এক্সপোর্ট তৈরি হচ্ছে। এতে কয়েক মিনিট লাগতে পারে।',
    });
  });
});
