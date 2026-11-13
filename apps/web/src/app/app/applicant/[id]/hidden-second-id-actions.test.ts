import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Actions that prove the caller owns the traveller in the form and then act on a SECOND id (a
 * suggestion, a naming proposal, a flag). The services answer `not_found` for a made-up id and
 * `forbidden` for a real one that belongs to someone else; a signed-in stranger who owns some
 * traveller of their own could use that to learn which ids are real. Both must read the same.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  approveDocumentTypeProposal: vi.fn(),
  rejectDocumentTypeProposal: vi.fn(),
  decideDocumentName: vi.fn(),
  acknowledgeInconsistencyFlag: vi.fn(),
  dismissInconsistencyFlag: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  approveProposal: mocks.approveProposal,
  rejectProposal: mocks.rejectProposal,
  approveDocumentTypeProposal: mocks.approveDocumentTypeProposal,
  rejectDocumentTypeProposal: mocks.rejectDocumentTypeProposal,
  decideDocumentName: mocks.decideDocumentName,
  acknowledgeInconsistencyFlag: mocks.acknowledgeInconsistencyFlag,
  dismissInconsistencyFlag: mocks.dismissInconsistencyFlag,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/providers-media', () => ({ createPreviewRenderer: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));

const {
  decideClassificationProposalAction,
  decideDocumentNameAction,
  decideInconsistencyFlagAction,
  decideProposalAction,
} = await import('./actions');

const initial = { ok: true, message: '' };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const FORBIDDEN = { code: 'forbidden', message: 'not authorized to decide this thing' };
const NOT_FOUND = { code: 'not_found', message: 'thing not found' };
const INVALID = { code: 'invalid', message: 'this was already decided' };

type Case = {
  name: string;
  run: () => Promise<unknown>;
  service: ReturnType<typeof vi.fn>;
  line: string;
};

const cases: Case[] = [
  {
    name: 'approving a reading (proposal)',
    run: () =>
      decideProposalAction(
        initial,
        form({ proposalId: 'p-1', proposalAction: 'approve', resolution: 'use_document' }),
      ),
    service: mocks.approveProposal,
    line: 'This suggestion is not available to you.',
  },
  {
    name: 'rejecting a reading (proposal)',
    run: () => decideProposalAction(initial, form({ proposalId: 'p-1', proposalAction: 'reject' })),
    service: mocks.rejectProposal,
    line: 'This suggestion is not available to you.',
  },
  {
    name: 'keeping the current value (proposal)',
    run: () =>
      decideProposalAction(
        initial,
        form({ proposalId: 'p-1', proposalAction: 'approve', resolution: 'keep' }),
      ),
    service: mocks.rejectProposal,
    line: 'This suggestion is not available to you.',
  },
  {
    name: 'approving a document kind suggestion',
    run: () =>
      decideClassificationProposalAction(
        initial,
        form({ proposalId: 'p-1', proposalAction: 'approve' }),
      ),
    service: mocks.approveDocumentTypeProposal,
    line: 'This suggestion is not available to you.',
  },
  {
    name: 'rejecting a document kind suggestion',
    run: () =>
      decideClassificationProposalAction(
        initial,
        form({ proposalId: 'p-1', proposalAction: 'reject' }),
      ),
    service: mocks.rejectDocumentTypeProposal,
    line: 'This suggestion is not available to you.',
  },
  {
    name: 'accepting a naming proposal',
    run: () =>
      decideDocumentNameAction(
        initial,
        form({
          nameVersionId: 'n-1',
          nameAction: 'accept',
          finalName: 'Passport',
          originalProposal: 'Passport',
        }),
      ),
    service: mocks.decideDocumentName,
    line: 'This naming proposal is not available to you.',
  },
  {
    name: 'rejecting a naming proposal',
    run: () =>
      decideDocumentNameAction(initial, form({ nameVersionId: 'n-1', nameAction: 'reject' })),
    service: mocks.decideDocumentName,
    line: 'This naming proposal is not available to you.',
  },
  {
    name: 'acknowledging an inconsistency flag',
    run: () =>
      decideInconsistencyFlagAction(initial, form({ flagId: 'f-1', flagAction: 'acknowledge' })),
    service: mocks.acknowledgeInconsistencyFlag,
    line: 'This item is not available to you.',
  },
  {
    name: 'dismissing an inconsistency flag',
    run: () =>
      decideInconsistencyFlagAction(initial, form({ flagId: 'f-1', flagAction: 'dismiss' })),
    service: mocks.dismissInconsistencyFlag,
    line: 'This item is not available to you.',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // The caller owns the traveller named in the form; only the second id is foreign.
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
});

describe.each(cases)('$name', (c) => {
  it('answers a real id that is not theirs exactly as it answers a made-up id', async () => {
    c.service.mockResolvedValueOnce({ ok: false, error: FORBIDDEN });
    const real = await c.run();
    c.service.mockResolvedValueOnce({ ok: false, error: NOT_FOUND });
    const madeUp = await c.run();
    expect(real).toEqual(madeUp);
    expect(real).toEqual({ ok: false, message: c.line });
  });

  it('still says plainly why when the person’s own item cannot be decided', async () => {
    c.service.mockResolvedValueOnce({ ok: false, error: INVALID });
    expect(await c.run()).toEqual({ ok: false, message: 'this was already decided' });
  });
});
