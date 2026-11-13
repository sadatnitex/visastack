// @vitest-environment jsdom
import { type ReactElement, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A logger around the lookup: which Bengali messages did a render really use?
const used = vi.hoisted(() => new Set<string>());
vi.mock('../lib/language-parts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/language-parts')>();
  return {
    ...real,
    partsTranslator: (catalog: { bn: Record<string, string> }, locale: string, pageLang: never) => {
      const inner = real.partsTranslator(
        catalog as never,
        locale as never,
        pageLang,
      ) as unknown as {
        (key: string, params?: never): string;
        node(key: string, params?: never): unknown;
        lang(key: string): unknown;
      };
      const seen = (key: string) => {
        if (locale === 'bn' && key in catalog.bn) used.add(key);
      };
      return Object.assign(
        (key: string, params?: never) => {
          seen(key);
          return inner(key, params);
        },
        {
          node: (key: string, params?: never) => {
            seen(key);
            return inner.node(key, params);
          },
          lang: (key: string) => inner.lang(key),
        },
      );
    },
  };
});
vi.mock('server-only', () => ({}));
const current = vi.hoisted(() => ({ locale: 'bn' as 'en' | 'bn' }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('../app/app/profile-photo-actions', () => ({
  saveProfilePhotoAction: vi.fn(),
  removeProfilePhotoAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/start',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import type { DestinationSource } from '@visastack/core/destinations';
import type { Readiness } from '@visastack/services';
import { componentsMoreCatalog } from '../i18n/components-more';
import { renderServer } from '../lib/next-mocks.test-support';
import { CaseListRow } from './case-list-row';
import { CasePreparationSummary, CaseStageTracker } from './case-preparation-summary';
import { AccessEndsNote } from './grant-expiry/access-ends-note';
import { I18nProvider } from './i18n-provider';
import { RemovalRecordList } from './lifecycle/removal-record-list';
import { AccountPhotoCard } from './profile-photo/account-photo-card';
import { RequestThread } from './request-thread/request-thread';
import type { Thread, ThreadMessage } from './request-thread/thread-model';
import { SafeCopyDownload } from './safe-copy-download';
import { SafeCopyEditor } from './safe-copy-editor';
import { SourceNote } from './source-note';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BN = componentsMoreCatalog.bn as Record<string, string>;
const EN = componentsMoreCatalog.en as Record<string, string>;
const bn = (key: string) => BN[`componentsMore.${key}`] as string;
const BENGALI = /[ঀ-৿]/;
const RAW_KEY = /componentsMore\./;

beforeEach(() => {
  current.locale = 'bn';
});

async function text(node: ReactElement): Promise<string> {
  return (await renderServer(node)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

const readiness: Readiness = {
  total: 2,
  requiredCount: 2,
  satisfiedRequired: 1,
  missing: [],
  ready: false,
  overallState: 'NEEDS_ACTION',
  requirementResults: [
    { packRequirementId: '1', kind: 'DOCUMENT', key: '1', optional: false, state: 'SATISFIED' },
    { packRequirementId: '2', kind: 'DOCUMENT', key: '2', optional: false, state: 'CRITICAL_GAP' },
  ],
};

describe('server components under Bengali', () => {
  it('case row: the next-step line has no Bengali draft, so it stays English and is not a raw key', async () => {
    const html = await renderServer(
      <CaseListRow
        id="c1"
        title="Japan visitor visa"
        state="INTAKE"
        past={false}
        destination="Japan"
        iso2="JP"
        purpose="Tourism"
        progress={{ kind: 'counted', done: 6, total: 8 }}
        nextStep="Add Passport"
        href="/app/mission/c1"
      />,
    );
    expect(html).toContain('Next: Add Passport');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('case progress: Bengali headings, held English lines stay, no raw keys', async () => {
    const out = await text(<CasePreparationSummary readiness={readiness} />);
    expect(out).toContain(bn('casePreparationSummary.evidenceProgress'));
    expect(out).toContain(bn('casePreparationSummary.howThisIsCounted'));
    // The three explanatory lines are Bengali (owner sign-off of 2026-11-12). The progress bar's name
    // is a template with a number in it: it stays one English message.
    expect(out).toContain(bn('casePreparationSummary.readinessIsCompletenessOnlyNeverAn'));
    expect(out).toContain(bn('casePreparationSummary.completenessIsNotAnApprovalProbability'));
    expect(out).toContain(bn('casePreparationSummary.theBarCountsRequiredItemsThat'));
    expect(out).toContain('1 of 2');
    expect(out).not.toMatch(RAW_KEY);
    const html = await renderServer(<CasePreparationSummary readiness={readiness} />);
    expect(html).toContain(
      `aria-label="${bn('casePreparationSummary.evidencePreparationCompleteness')}`,
    );
  });

  it('stage tracker: the actual-state label is Bengali, stage names stay as given', async () => {
    const html = await renderServer(
      <CaseStageTracker
        state="UNDER_REVIEW"
        labels={{ UNDER_REVIEW: 'Under Review', READY_TO_EXPORT: 'Ready to Export' }}
        nextStates={['READY_TO_EXPORT']}
      />,
    );
    expect(html).toContain(bn('casePreparationSummary.actualCaseWorkflowState'));
    expect(html).toContain('Under Review');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('source note: the copied-words heading is Bengali only when there are copied words', async () => {
    const source: DestinationSource = {
      url: 'https://example.gov/visa',
      title: 'Visa page',
      publisher: 'Example Ministry',
      type: null,
      language: null,
      checkedOn: '2026-10-14',
      exactWords: 'You must apply before travel.',
      translation: null,
      where: null,
      confidence: null,
      needsCheck: false,
      note: null,
    };
    const withWords = await text(<SourceNote source={source} />);
    expect(withWords).toContain(bn('sourceNote.wordsCopiedFromTheSource'));
    expect(withWords).toContain('You must apply before travel.');
    expect(withWords).toContain('Checked on');
    const without = await text(<SourceNote source={{ ...source, exactWords: null }} />);
    expect(without).not.toContain(bn('sourceNote.wordsCopiedFromTheSource'));
    expect(BENGALI.test(without)).toBe(false);
  });

  it('access end note: no Bengali draft yet, so the sentence stays English; nothing without a date', async () => {
    const out = await text(<AccessEndsNote endsAt="2026-12-05T00:00:00.000Z" />);
    expect(out).toContain('Access ends on 5 Dec 2026. The traveller can extend it.');
    expect(out).not.toMatch(RAW_KEY);
    expect(await renderServer(<AccessEndsNote endsAt={null} />)).toBe('');
  });

  it('removal records: the empty state is Bengali; ten or more rows keep the English Show More', async () => {
    const empty = await text(<RemovalRecordList records={[]} />);
    expect(empty).toContain(bn('lifecycleRemovalRecordList.nothingHasBeenRemovedFromThis'));
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      subjectKind: 'DOCUMENT' as const,
      subjectCode: 'D-7K2Q9M',
      documentKind: 'PASSPORT',
      scheduledFor: null,
      verifiedGoneAt: null,
      requestedAt: '2026-10-01T09:00:00Z',
      status: 'REMOVED' as const,
      effects: {},
    }));
    const many = await text(
      <RemovalRecordList records={rows} now={new Date('2026-11-01T09:00:00Z')} />,
    );
    expect(many).toContain('আরও দেখান (২)');
    expect(many).not.toContain('Show More (2)');
    expect(many).not.toContain(bn('lifecycleRemovalRecordList.nothingHasBeenRemovedFromThis'));
    expect(many).not.toMatch(RAW_KEY);
  });

  it('photo card: Bengali heading, kicker, privacy sentence and add link', async () => {
    const self = await text(
      <AccountPhotoCard photo={{ self: { id: 'p1', name: 'Rahima Akter', photoUrl: null } }} />,
    );
    expect(self).toContain(bn('profilePhotoAccountPhotoCard.profilePhoto'));
    expect(self).toContain(bn('profilePhotoAccountPhotoCard.yourPhoto'));
    expect(self).toContain(bn('profilePhotoAccountPhotoCard.shownBesideYourNameInYour'));
    expect(self).not.toContain('Only you can see it');
    const none = await text(<AccountPhotoCard photo={{ self: null }} />);
    expect(none).toContain(bn('profilePhotoAccountPhotoCard.profilePhoto'));
    expect(none).toContain(bn('profilePhotoAccountPhotoCard.addYourselfAsATravellerFirst'));
    expect(none).toContain(bn('profilePhotoAccountPhotoCard.addYourself'));
    expect(none).not.toContain('Add Yourself');
    expect(none).not.toMatch(RAW_KEY);
  });
});

describe('request conversation under Bengali', () => {
  const at = (day: number) => new Date(Date.UTC(2027, 0, day, 10));
  const message = (over: Partial<ThreadMessage>): ThreadMessage => ({
    id: 'm',
    side: 'agency',
    text: 'Please send your bank statement.',
    at: at(1),
    word: 'Sent',
    wordAt: null,
    ...over,
  });
  const thread = (over: Partial<Thread>): Thread => ({
    messages: [message({})],
    olderSends: 0,
    note: null,
    ...over,
  });
  const show = (value: Thread) => (
    <RequestThread thread={value} viewer="traveller" timeZone="Asia/Dhaka" heading="Conversation" />
  );

  it('older sends: the note is Bengali, and absent when there are none', async () => {
    const some = await text(show(thread({ olderSends: 2 })));
    expect(some).toContain(bn('requestThreadRequestThread.olderSendsAreNotShownHere'));
    expect(some).toContain('Please send your bank statement.');
    const none = await text(show(thread({})));
    expect(none).not.toContain(bn('requestThreadRequestThread.olderSendsAreNotShownHere'));
  });

  it('a send with no time says so in Bengali; the review lines stay English beside their English dates', async () => {
    const out = await text(
      show(
        thread({
          messages: [
            message({ side: 'traveller', at: null, word: 'Reviewed', wordAt: at(3) }),
            message({ id: 'n', side: 'agency', word: 'Sent Back for a Fix', wordAt: at(4) }),
          ],
        }),
      ),
    );
    expect(out).toContain(bn('requestThreadRequestThread.timeNotKept'));
    expect(out).toContain('Reviewed');
    expect(out).toContain('Sent back');
    expect(out).not.toContain(BN['componentsMore.requestThreadRequestThread.reviewed'] ?? '\u0000');
    expect(out).not.toMatch(RAW_KEY);
  });

  it('under English the same screens read exactly as before', async () => {
    current.locale = 'en';
    const out = await text(
      show(
        thread({
          olderSends: 1,
          messages: [message({ side: 'traveller', at: null, word: 'Reviewed', wordAt: at(3) })],
        }),
      ),
    );
    expect(out).toContain('Time not kept');
    expect(out).toContain('Older sends are not shown here.');
    expect(BENGALI.test(out)).toBe(false);
  });
});

describe('safe copy download under Bengali', () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const mountDownload = () =>
    act(() =>
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          <SafeCopyDownload documentId="d1" returnTo="/app/shared/g" />
        </I18nProvider>,
      ),
    );

  it('idle: the button is Bengali', () => {
    mountDownload();
    expect(host.querySelector('button')?.textContent).toBe(bn('safeCopyDownload.downloadSafeCopy'));
  });

  it('working then done: both status lines are Bengali', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    mountDownload();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(
      bn('safeCopyDownload.makingYourSafeCopyThisCan'),
    );
    await act(async () => {
      release(new Response(new Blob(['x']), { headers: { 'content-type': 'application/pdf' } }));
    });
    for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
    expect(host.querySelector('output')?.textContent).toBe(
      bn('safeCopyDownload.safeCopyDownloaded'),
    );
  });

  it('reauth: the server message and the English link stay as they are', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ message: 'Please confirm.', reauthUrl: '/auth/again' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );
    mountDownload();
    await act(async () => host.querySelector('button')?.click());
    for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Please confirm.');
    expect(host.querySelector('a')?.textContent).toBe('Confirm It Is You');
  });
});

describe('safe copy editor under Bengali', () => {
  const documentId = '00000000-0000-4000-8000-000000000001';
  const versionId = '00000000-0000-4000-8000-000000000101';
  const REVISION = '00000000-0000-4000-8000-0000000000ee';
  let root: Root;
  let container: HTMLDivElement;
  let failingPages: Set<number>;
  let canSave: boolean;
  let hold: Promise<void> | null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    failingPages = new Set();
    canSave = true;
    hold = null;
    window.sessionStorage.clear();
    vi.stubGlobal('fetch', async (path: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { page?: unknown; clear?: unknown };
      if (path === '/api/documents/redaction-editor') {
        return json({ versionId, pageCount: 2, state: 'NOT_PREPARED', savedPages: null, canSave });
      }
      if (path === '/api/documents/redaction-page') {
        if (failingPages.has(Number(body.page))) return json({ message: 'Try again soon.' }, 503);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (path === '/api/documents/safe-copy-prepare') {
        await hold;
        const page = Number(body.page);
        return json({
          page,
          pageCount: 2,
          preparedPages: page,
          state: page === 2 ? 'MASKED' : 'PREPARING',
        });
      }
      if (path === '/api/documents/redaction-suggestions') {
        return json({
          suggestions: [{ page: 1, box: { x: 0.02, y: 0.78, w: 0.96, h: 0.2 }, reason: 'mrz' }],
        });
      }
      if (path === '/api/documents/redaction-masks') {
        return body.clear
          ? json({ state: 'NOT_PREPARED' })
          : json({ state: 'PREPARING', pageCount: 2, boxCount: 1, maskRevision: REVISION });
      }
      return json({ message: 'unexpected' }, 500);
    });
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 10,
      height: 14,
      close: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
  }
  async function mount(
    initialState:
      | 'NOT_PREPARED'
      | 'PREPARING'
      | 'MASKED'
      | 'TOO_LARGE'
      | 'UNSUPPORTED' = 'NOT_PREPARED',
    available = true,
  ) {
    await act(async () => {
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          <SafeCopyEditor
            documentId={documentId}
            versionId={versionId}
            returnTo="/app/applicant/a/documents"
            initialState={initialState}
            available={available}
          />
        </I18nProvider>,
      );
    });
  }
  const button = (name: string) => {
    const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
    if (!found) throw new Error(`missing button ${name}`);
    return found;
  };
  const has = (name: string) =>
    [...container.querySelectorAll('button')].some((b) => b.textContent === name);
  async function click(name: string) {
    await act(async () => button(name).click());
    await settle();
  }

  it('closed section: heading, start button and the long note are Bengali, the state label stays English', async () => {
    await mount();
    expect(container.querySelector('summary')?.textContent).toBe(bn('safeCopyEditor.safeCopy'));
    expect(has(bn('safeCopyEditor.prepareSafeCopy'))).toBe(true);
    expect(container.textContent).toContain(bn('safeCopyEditor.aSafeCopyIsANew'));
    expect(container.textContent).not.toContain('A safe copy is a new picture of each page');
    expect(container.textContent).not.toMatch(RAW_KEY);
  });

  it('a finished safe copy offers Change and Remove in Bengali', async () => {
    await mount('MASKED');
    expect(has(bn('safeCopyEditor.changeSafeCopy'))).toBe(true);
    expect(has(bn('safeCopyEditor.removeSafeCopy'))).toBe(true);
    expect(has(bn('safeCopyEditor.prepareSafeCopy'))).toBe(false);
  });

  it('too large, unsupported and unavailable are Bengali', async () => {
    await mount('TOO_LARGE');
    expect(container.textContent).toContain(bn('safeCopyEditor.thisDocumentIsTooLargeFor'));
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount('UNSUPPORTED');
    expect(container.textContent).toContain(bn('safeCopyEditor.safeCopiesCanBeMadeFrom'));
    expect(container.textContent).not.toContain(bn('safeCopyEditor.thisDocumentIsTooLargeFor'));
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount('NOT_PREPARED', false);
    expect(container.textContent).toContain(bn('safeCopyEditor.safeCopiesAreNotAvailableHere'));
  });

  it('editing: pager and box controls; box words use বক্স; row buttons and their aria names stay English together', async () => {
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    expect(has(bn('safeCopyEditor.previousPage'))).toBe(true);
    await click(bn('safeCopyEditor.addBox'));
    // The selected box's controls: the box words use the one agreed term.
    expect(has(bn('safeCopyEditor.removeBox'))).toBe(true);
    expect(bn('safeCopyEditor.removeBox')).toContain('বক্স');
    expect(bn('safeCopyEditor.acceptBox')).toContain('বক্স');
    expect(`${bn('safeCopyEditor.removeBox')}${bn('safeCopyEditor.acceptBox')}`).not.toContain(
      'বাক্স',
    );
    // Row buttons keep their English text AND their English screen-reader names (label in name).
    const row = container.querySelector('.safe-copy-list li');
    const names = [...(row?.querySelectorAll('button') ?? [])].map((b) => [
      b.textContent,
      b.getAttribute('aria-label'),
    ]);
    expect(names).toEqual([
      ['Select', 'Select box 1'],
      ['Remove', 'Remove box 1'],
    ]);
    await click(bn('safeCopyEditor.removeBox'));
    expect(container.querySelectorAll('rect[role="button"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(RAW_KEY);
  });

  it('a suggested box offers Accept Box in Bengali', async () => {
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    await click(bn('safeCopyEditor.suggestBoxes'));
    await click('Select');
    expect(has(bn('safeCopyEditor.acceptBox'))).toBe(true);
    const row = container.querySelector('.safe-copy-list li');
    expect(
      [...(row?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Select box 1', 'Accept box 1', 'Remove box 1']);
    await click(bn('safeCopyEditor.acceptBox'));
    expect(has(bn('safeCopyEditor.acceptBox'))).toBe(false);
  });

  it('review: Save and the review line are Bengali; the drawing notice stays English', async () => {
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    await click(bn('safeCopyEditor.addBox'));
    await click(bn('safeCopyEditor.reviewPages'));
    expect(has(bn('safeCopyEditor.saveSafeCopy'))).toBe(true);
    expect(container.textContent).toContain(bn('safeCopyEditor.checkEveryPage'));
    let release: () => void = () => undefined;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await click(bn('safeCopyEditor.saveSafeCopy'));
    expect(container.querySelector('h3')?.textContent).toBe(
      bn('safeCopyEditor.preparingTheSafeCopy'),
    );
    // It names Continue Preparing, which is still English, so this line stays English too.
    expect(container.textContent).toContain('Each page is drawn once with its black boxes.');
    release();
    await settle();
  });

  it('review after Nothing to Hide: the line that says so is Bengali', async () => {
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    await click(bn('safeCopyEditor.nothingToHideOnThisDocument'));
    expect(container.textContent).toContain(bn('safeCopyEditor.youChoseNothingToHideOn'));
    expect(container.textContent).not.toContain('You chose Nothing to Hide on This Document.');
    expect(container.textContent).not.toMatch(RAW_KEY);
  });

  it('review with a page that did not show: the waiting line is Bengali with the counts', async () => {
    failingPages = new Set([2]);
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    await click(bn('safeCopyEditor.addBox'));
    await click(bn('safeCopyEditor.reviewPages'));
    const line = [...container.querySelectorAll('p.safe-copy-note')].find((p) =>
      p.textContent?.includes('টির মধ্যে'),
    );
    expect(line?.textContent).toContain('২টির মধ্যে ১টি');
    expect(line?.textContent).not.toMatch(RAW_KEY);
  });

  it('safe copies not ready: the notice is Bengali', async () => {
    canSave = false;
    await mount();
    await click(bn('safeCopyEditor.prepareSafeCopy'));
    await click(bn('safeCopyEditor.addBox'));
    await click(bn('safeCopyEditor.reviewPages'));
    expect(container.textContent).toContain(bn('safeCopyEditor.safeCopiesAreNotReadyYet'));
  });

  it('under English every one of those lines is exactly the old English', async () => {
    current.locale = 'en';
    await act(async () => {
      root.render(
        <SafeCopyEditor
          documentId={documentId}
          versionId={versionId}
          returnTo="/x"
          initialState="MASKED"
          available
        />,
      );
    });
    expect(container.querySelector('summary')?.textContent).toBe('Safe Copy');
    expect(has('Change Safe Copy')).toBe(true);
    expect(has('Remove Safe Copy')).toBe(true);
  });
});

describe('coverage of the live Bengali messages', () => {
  it('every live bn key of this surface was shown by a test above', () => {
    const live = Object.keys(BN);
    const missing = live.filter((key) => !used.has(key));
    expect(
      missing,
      `bn keys live: ${live.length}, rendered in tests: ${live.length - missing.length}`,
    ).toEqual([]);
    expect(Object.keys(EN).length).toBeGreaterThan(live.length);
  });
});
