// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';

/** The import panel under Bengali: every state it draws, with a made-up request stand-in. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const removal = vi.hoisted(() => ({ remove: vi.fn(), restore: vi.fn() }));
vi.mock('../documents/manage/delete/actions', () => ({
  deleteDuplicateAction: removal.remove,
  restoreDeletedAction: removal.restore,
}));

const { ImportPanel } = await import('./import-panel');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdImportImportPanel.';
const BENGALI = /[ঀ-৿]/;

class FakeRequest {
  static sent: FakeRequest[] = [];
  headers: Record<string, string> = {};
  body: Blob | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader() {
    return null;
  }
  send(body: Blob) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const text = () => (host.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(() =>
    Promise.resolve(new Uint8Array(32).fill(1).buffer),
  );
  FakeRequest.sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(
  locale: 'en' | 'bn',
  people?: { id: string; name: string }[],
  familyBatch = false,
) {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          familyBatch={familyBatch}
          {...(people ? { people } : {})}
        />
      </I18nProvider>,
    );
  });
}
async function choose(names: string[]) {
  const input = host.querySelector('[data-testid="import-files"]') as HTMLInputElement;
  const files = names.map((n) => new File([new Uint8Array(10)], n, { type: 'image/jpeg' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

const people = [
  { id: 'a-1', name: 'Karim' },
  { id: 'a-2', name: 'Rina' },
];

describe('the import panel under Bengali', () => {
  it('shows the idle panel, the person question and the buttons in Bengali', async () => {
    await mount('bn', people);
    for (const key of [
      'whoAreTheseFilesFor',
      'everyFileYouAddNowIs',
      'dropFilesOrAFolderHere',
      'foldersInsideItAreIncludedYou',
      'addAFolder',
      'yourFiles',
    ])
      expect(text(), key).toContain(bn[`${K}${key}`]);
    expect(text()).toContain('Karim (এই ব্যক্তি)');
    expect(text()).toContain(bn['appApplicant.appApplicantIdDocumentUploader.chooseFiles']);
    const labels = host.innerHTML.match(/aria-label="[^"]*"/g)?.join('|') ?? '';
    expect(labels).toContain(bn[`${K}folderToImport`]);
    expect(labels).toContain(bn[`${K}filesToImport`]);
    // The privacy promise is Bengali since the owner sign-off of 2026-11-12.
    expect(`${K}eachFileIsStoredPrivatelyAnd` in bn).toBe(true);
    expect(text()).toContain(bn[`${K}eachFileIsStoredPrivatelyAnd`]);
    expect(text()).not.toContain(en[`${K}eachFileIsStoredPrivatelyAnd`]);
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('shows the running import: pause, a file line and the English progress words', async () => {
    await mount('bn', people);
    await choose(['a.jpg']);
    expect(text()).toContain(bn[`${K}pause`]);
    expect(text()).toContain('a.jpg');
    // Not yet drafted: English, never a raw key.
    expect(text()).toContain('Stop');
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('shows the finished import with the follow-up lines and the forget button', async () => {
    await mount('bn', people);
    await choose(['a.jpg']);
    await act(async () =>
      FakeRequest.sent[0]?.answer(201, { message: 'Added. It is being checked.', title: 'Photo' }),
    );
    await flush();
    expect(text()).toContain(bn[`${K}forgetEarlierImports`]);
    // It says what automatic reading did and what the person still approves: Bengali since the
    // owner sign-off of 2026-11-12.
    expect(`${K}yourFilesAreSavedAndChecked` in bn).toBe(true);
    expect(text()).toContain(bn[`${K}yourFilesAreSavedAndChecked`]);
    expect(text()).not.toContain('Your files are saved and checked.');
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('offers the not-sure choice for the family route in Bengali', async () => {
    await mount('bn', people, true);
    expect(host.innerHTML).toContain(`>${bn[`${K}notSureHelpMeDecide`]}<`);
  });

  it('says each file waits for one decision when the person is not sure (signed off 2026-11-12)', async () => {
    await mount('bn', people, true);
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '__not_sure';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(text()).toContain(bn[`${K}eachFileWaitsInNeedsOne`]);
    expect(text()).not.toContain(en[`${K}eachFileWaitsInNeedsOne`]);
  });

  it('names the folder a file came from in Bengali', async () => {
    await mount('bn');
    const input = host.querySelector('[data-testid="import-folder"]') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Passports/p.jpg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(text()).toContain('Passports-এ');
  });

  it('words a failed Remove This New Copy from the catalogue, and rewords it when the language is switched', async () => {
    const R = 'appApplicant.appApplicantIdDocumentsManageRemoval.';
    const removeAndRead = async (answer: 'down' | Record<string, unknown>) => {
      if (answer === 'down') removal.remove.mockReset().mockRejectedValue(new Error('offline'));
      else removal.remove.mockReset().mockResolvedValue(answer);
      act(() => root.unmount());
      root = createRoot(host);
      FakeRequest.sent = [];
      window.localStorage.clear();
      await mount('bn', people);
      await choose(['copy.jpg']);
      await act(async () =>
        FakeRequest.sent[0]?.answer(201, {
          message: 'Added. This is an exact copy of a document you already keep.',
          title: 'Scan',
          removableCopyId: '11111111-1111-4111-8111-111111111111',
        }),
      );
      await flush();
      const button = [...host.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.includes('copy.jpg'),
      );
      expect(button, 'Remove This New Copy').toBeTruthy();
      await act(async () => {
        button?.click();
      });
      await flush();
      return host.querySelector('.upload-item [role="alert"], [role="alert"].field-msg-err')
        ?.textContent;
    };
    const handover = `${R}copyKeptHandover`;
    expect(await removeAndRead({ ok: false, message: en[handover], messageKey: handover })).toBe(
      'আপনার আমন্ত্রিত একজন এই কপিটি পাঠিয়েছেন, তাই এটি রাখা আছে। এর বদলে আপনি এটি আর্কাইভ করতে পারেন।',
    );
    // Held: it names Recently Deleted, whose own label is still English on screen.
    const stale = `${R}copyAlreadyRecentlyDeleted`;
    expect(bn[stale]).toBeUndefined();
    expect(await removeAndRead({ ok: false, message: en[stale], messageKey: stale })).toBe(
      'This copy is already in Recently Deleted. Refresh the page.',
    );
    expect(await removeAndRead('down')).toBe(bn[`${R}couldNotRemoveIt`]);
    expect(bn[`${R}couldNotRemoveIt`]).toMatch(BENGALI);
    // The language is switched with the failure still on screen: it is reworded, not frozen.
    await act(async () => {
      root.render(
        <I18nProvider locale="en" pageLang="en">
          <ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" people={people} />
        </I18nProvider>,
      );
    });
    expect(host.querySelector('[role="alert"].field-msg-err')?.textContent).toBe(
      'We could not remove it. Check your connection and try again.',
    );
  });

  it('is the same English as before under English', async () => {
    await mount('en', people);
    expect(text()).not.toMatch(BENGALI);
    expect(text()).toContain('Drop Files or a Folder Here');
    expect(text()).toContain('Karim (This Person)');
  });
});
