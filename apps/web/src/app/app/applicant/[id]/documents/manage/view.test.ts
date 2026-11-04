import { DOCUMENT_ACTIONS, availableDocumentActions } from '@visastack/services';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selfDeleteOn: vi.fn(),
  requestsOn: vi.fn(),
  hasHold: vi.fn(),
  documentHold: vi.fn(),
  pending: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../../../../../lib/env', () => ({
  documentSelfDeleteOn: mocks.selfDeleteOn,
  documentRemovalRequestsOn: mocks.requestsOn,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  hasActiveLegalHold: mocks.hasHold,
  documentBlockedByLegalHold: mocks.documentHold,
  pendingRemovalRequests: mocks.pending,
}));

import { removalRequestFacts } from './request/facts';
import { documentActionView } from './view';

const lifecycle = {
  state: 'CURRENT',
  replaced: false,
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  deletePath: null,
} as const;

afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('what the Manage menu offers for a copy under another person', () => {
  it('stays hidden unless the page says the document belongs to two people and there is someone else', () => {
    expect(availableDocumentActions(documentActionView(lifecycle))).not.toContain(
      'KEEP_COPY_FOR_PERSON',
    );
    expect(
      availableDocumentActions(documentActionView(lifecycle, { keepCopyForOthers: true })),
    ).toContain('KEEP_COPY_FOR_PERSON');
    expect(DOCUMENT_ACTIONS.indexOf('KEEP_COPY_FOR_PERSON')).toBeLessThan(
      DOCUMENT_ACTIONS.indexOf('DELETE_MY_FILE'),
    );
  });
});

describe('what the Manage menu offers for Delete My File', () => {
  it('stays hidden unless the page says the switch is on', () => {
    expect(DOCUMENT_ACTIONS.at(-1)).toBe('DELETE_MY_FILE');
    expect(availableDocumentActions(documentActionView(lifecycle))).not.toContain('DELETE_MY_FILE');
    expect(
      availableDocumentActions(documentActionView(lifecycle, { selfDeleteSwitchOn: true })).at(-1),
    ).toBe('DELETE_MY_FILE');
  });

  it('reads the switch and the hold for each document, and nothing about holds while both switches are off', async () => {
    mocks.pending.mockResolvedValue(new Map());
    mocks.requestsOn.mockReturnValue(false);
    mocks.selfDeleteOn.mockReturnValue(false);
    const off = await removalRequestFacts({} as never, {} as never, 'a1', ['d1']);
    expect(off.get('d1')).toEqual({
      pendingRequest: false,
      legalHold: false,
      requestsSwitchOn: false,
      selfDeleteSwitchOn: false,
    });
    expect(mocks.hasHold).not.toHaveBeenCalled();

    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.hasHold.mockResolvedValue(true);
    mocks.documentHold.mockImplementation(async (_db, input) => input.documentId === 'd2');
    const on = await removalRequestFacts({} as never, {} as never, 'a1', ['d1', 'd2']);
    expect(on.get('d1')).toMatchObject({ selfDeleteSwitchOn: true, legalHold: false });
    expect(on.get('d2')).toMatchObject({ selfDeleteSwitchOn: true, legalHold: true });
    expect(
      availableDocumentActions(documentActionView(lifecycle, on.get('d2'))).includes(
        'DELETE_MY_FILE',
      ),
    ).toBe(false);
  });
});
