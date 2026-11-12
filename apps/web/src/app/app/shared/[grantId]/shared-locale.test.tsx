import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  workspace: null as unknown,
  offer: 'none',
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getRecipientWorkspace: async () => state.workspace,
}));
vi.mock('../../../../lib/photo-sizes', () => ({ mayUseVisaPhotoSizes: async () => false }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { db: true }, accountId: 'agent-1', email: 'agent@example.com' }),
}));
vi.mock('../../../../components/visa-photo-sizes', () => ({
  VisaPhotoSizes: stub('VisaPhotoSizes'),
}));
vi.mock('../../../../lib/safe-copy', () => ({
  safeCopyOffers: async (_db: unknown, _account: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, state.offer])),
  safeCopiesAvailable: () => true,
}));
vi.mock('../../../../components/safe-copy-download', () => ({
  SafeCopyDownload: stub('SafeCopyDownload'),
}));

import { appSharedCatalog } from '../../../../i18n/app-shared';

const { default: SharedWorkspacePage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = appSharedCatalog.bn as Record<string, string>;
const en = appSharedCatalog.en as Record<string, string>;
const key = (name: string) => `appShared.appSharedGrantidPage.${name}`;

function workspace(over: { documents?: unknown[]; fields?: unknown[]; scope?: boolean }) {
  return {
    ok: true,
    value: {
      applicantId: 'app-1',
      applicantDisplayName: 'Synthetic Traveller',
      grant: {
        id: 'grant-1',
        purpose: 'visa-application',
        expiryAt: null,
        actions: ['VIEW_METADATA', 'PREVIEW'],
        recipientOrganizationId: null,
      },
      fields: over.fields ?? [],
      documents: over.documents ?? [],
      missionScopeUnavailable: over.scope ?? false,
    },
  };
}

async function render(locale: 'en' | 'bn', ws: unknown) {
  state.locale = locale;
  state.generation += 1;
  state.workspace = ws;
  return textOf(
    await renderServer(SharedWorkspacePage({ params: Promise.resolve({ grantId: 'grant-1' }) })),
  );
}

beforeEach(() => {
  state.workspace = null;
  state.offer = 'none';
});

describe('shared workspace under Bengali', () => {
  it('nothing shared: labels in Bengali, the sentences about what was shared stay English', async () => {
    const shown = await render('bn', workspace({}));
    for (const k of ['sharedWithYou', 'sharedWorkspace', 'sharedFields', 'documentVault']) {
      expect(shown).toContain(bn[key(k)]);
    }
    expect(shown).toContain(en[key('noProfileDetailsShared')]);
    expect(shown).toContain(en[key('thisPersonHasNotSharedAny')]);
    expect(shown).toContain(en[key('noDocumentsShared')]);
    expect(shown).toContain(en[key('thisPersonHasNotSharedAnyb926f7')]);
    expect(shown).toContain(en[key('everyItemBelowIsReChecked')]);
    expect(shown).toMatch(BENGALI);
  });

  it('documents and fields shared: the list headings are Bengali, safe-copy wording stays English', async () => {
    state.offer = 'not_prepared';
    const shown = await render(
      'bn',
      workspace({
        documents: [{ id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' }],
        fields: [{ key: 'given_name', label: 'Given name', value: 'Sam' }],
      }),
    );
    expect(shown).toContain(bn[key('sharedDocuments')]);
    expect(shown).toContain('cert.pdf');
    expect(shown).toContain(en[key('safeCopyNotPreparedYet')]);
    expect(shown).toContain(en[key('otherDocumentsCannotBePreviewedHere')]);
  });

  it('a file with no safe copy available keeps its badge in English', async () => {
    state.offer = 'not_available';
    const shown = await render(
      'bn',
      workspace({
        documents: [{ id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' }],
      }),
    );
    expect(shown).toContain(en[key('safeCopyNotAvailableForThis')]);
  });

  it('a case-limited grant keeps the access notice in English', async () => {
    const shown = await render('bn', workspace({ scope: true }));
    expect(shown).toContain(en[key('thisAccessIsLimitedToA')]);
    expect(shown).toContain(bn[key('sharedWorkspace')]);
  });

  it('English is unchanged', async () => {
    state.offer = 'not_prepared';
    const shown = await render(
      'en',
      workspace({
        documents: [{ id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' }],
      }),
    );
    expect(shown).not.toMatch(BENGALI);
    expect(shown).toContain('Shared Workspace');
    expect(shown).toContain('Shared Documents');
    expect(shown).toContain('Safe Copy: Not Prepared Yet');
  });
});
