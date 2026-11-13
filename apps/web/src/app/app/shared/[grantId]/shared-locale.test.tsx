import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../../../../lib/bengali-marked.test-support';
import { formatTimestampDate } from '../../../../lib/format-date';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  workspace: null as unknown,
  offer: 'none',
  safeCopiesOn: true,
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
  safeCopiesAvailable: () => state.safeCopiesOn,
}));
vi.mock('../../../../components/safe-copy-download', () => ({
  SafeCopyDownload: stub('SafeCopyDownload'),
}));

import { appSharedCatalog } from '../../../../i18n/app-shared';

const { default: SharedWorkspacePage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = appSharedCatalog.bn as Record<string, string>;
const key = (name: string) => `appShared.appSharedGrantidPage.${name}`;

function workspace(over: {
  documents?: unknown[];
  fields?: unknown[];
  scope?: boolean;
  expiryAt?: Date;
}) {
  return {
    ok: true,
    value: {
      applicantId: 'app-1',
      applicantDisplayName: 'Synthetic Traveller',
      grant: {
        id: 'grant-1',
        purpose: 'visa-application',
        expiryAt: over.expiryAt ?? null,
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
  state.safeCopiesOn = true;
});

describe('shared workspace under Bengali', () => {
  it('nothing shared: labels and the sentences about what was shared are Bengali (signed off 2026-11-12)', async () => {
    const shown = await render('bn', workspace({}));
    for (const k of ['sharedWithYou', 'sharedWorkspace', 'sharedFields', 'documentVault']) {
      expect(shown).toContain(bn[key(k)]);
    }
    expect(shown).toContain(bn[key('noProfileDetailsShared')]);
    expect(shown).toContain(bn[key('thisPersonHasNotSharedAny')]);
    expect(shown).toContain(bn[key('noDocumentsShared')]);
    expect(shown).toContain(bn[key('thisPersonHasNotSharedAnyb926f7')]);
    expect(shown).toContain(bn[key('everyItemBelowIsReChecked')]);
    expect(shown).toMatch(BENGALI);
  });

  it('documents and fields shared: the list headings and the safe-copy wording are Bengali', async () => {
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
    expect(shown).toContain(bn[key('safeCopyNotPreparedYet')]);
    expect(shown).toContain(bn[key('otherDocumentsCannotBePreviewedHere')]);
  });

  it('a file with no safe copy available shows its badge in Bengali', async () => {
    state.offer = 'not_available';
    const shown = await render(
      'bn',
      workspace({
        documents: [{ id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' }],
      }),
    );
    expect(shown).toContain(bn[key('safeCopyNotAvailableForThis')]);
  });

  it('says safe copies are not available here yet in Bengali when they are switched off (refill 7)', async () => {
    state.safeCopiesOn = false;
    const shared = workspace({
      documents: [{ id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' }],
    }) as { value: { grant: { actions: string[] } } };
    shared.value.grant.actions = ['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED'];
    const shown = await render('bn', shared);
    expect(shown).toContain(bn[key('safeCopiesAreNotAvailableHere')]);
    expect(shown).not.toContain('Safe copies are not available here yet.');
    expect(await render('en', shared)).toContain('Safe copies are not available here yet.');
  });

  it('a case-limited grant shows the access notice in Bengali', async () => {
    const shown = await render('bn', workspace({ scope: true }));
    expect(shown).toContain(bn[key('thisAccessIsLimitedToA')]);
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

describe('the day shared access ends', () => {
  // A far, fixed moment at midday, so a viewer within about twelve hours of UTC keeps the day (the checks run on UTC machines).
  const EXPIRY_AT = new Date('2099-11-01T12:00:00Z');
  // The purpose and the expiry share one line: take the line from the purpose to the year.
  const expiryLine = (shown: string) =>
    shown.match(/visa-application( · [^·]*?(?:2099|২০৯৯))/)?.[1];

  it('is written in Bengali with a Bengali date', async () => {
    const shown = await render('bn', workspace({ expiryAt: EXPIRY_AT }));
    const line = expiryLine(shown);
    expect(line).toBe(
      (bn[key('expiresFormattimestampdate')] ?? '').replace(
        '{formatTimestampDate}',
        formatTimestampDate(EXPIRY_AT, 'bn'),
      ),
    );
    expect(line).toBe(' · মেয়াদ শেষ ১ নভে, ২০৯৯');
    expect(line).toContain('২০৯৯');
    expect(line).not.toMatch(/[0-9]/);
    expect(line).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    expect(shown).not.toContain('expires');
    expect(shown).not.toMatch(/appShared\./);
  });

  it('reads exactly as it did in English', async () => {
    const shown = await render('en', workspace({ expiryAt: EXPIRY_AT }));
    expect(shown).toContain('visa-application · expires 1 Nov 2099');
    expect(expiryLine(shown)).toBe(' · expires 1 Nov 2099');
    expect(shown).not.toMatch(BENGALI);
    expect(shown).not.toMatch(/appShared\./);
  });
});

describe('shared workspace, language of parts', () => {
  it('marks the Bengali on an English page lang="bn"', async () => {
    state.locale = 'bn';
    state.generation += 1;
    state.workspace = workspace({});
    const r = bengaliMarking(
      await renderServer(SharedWorkspacePage({ params: Promise.resolve({ grantId: 'grant-1' }) })),
    );
    // Text handed to a component prop stays unmarked for now (skipped item component_prop).
    expect(r.marked).toBeGreaterThan(0);
  });
});
