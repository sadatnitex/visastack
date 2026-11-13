import { formatNumber } from '@visastack/i18n';
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
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return name === 'Retry-After' ? this.retryAfter : null;
  }
  send(body: Blob) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  retryAfter: string | null = null;
  url = '';
  answer(status: number, body: unknown, retryAfter: string | null = null) {
    this.status = status;
    this.retryAfter = retryAfter;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  drop() {
    this.ontimeout?.();
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

  it('shows the running import: pause, a file line and Stop in Bengali', async () => {
    await mount('bn', people);
    await choose(['a.jpg']);
    expect(text()).toContain(bn[`${K}pause`]);
    expect(text()).toContain('a.jpg');
    expect(text()).toContain(bn[`${K}stop`]);
    expect(text()).not.toContain('Stop');
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

/** Refill 7: the states of the panel the earlier tests did not reach, each under Bengali. */
describe('the import panel under Bengali, every later state', () => {
  const U = 'appApplicant.appApplicantIdDocumentUploader.';
  const photo = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/jpeg' });
  async function chooseFiles(files: File[]) {
    const input = host.querySelector('[data-testid="import-files"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
  }
  async function answer(index: number, status = 201, body: unknown = {}, retryAfter?: string) {
    await act(async () => FakeRequest.sent[index]?.answer(status, body, retryAfter ?? null));
    await flush();
  }
  const line = (name: string) =>
    [...host.querySelectorAll('.upload-list li')].find(
      (row) => row.querySelector('.upload-item-name')?.textContent === name,
    );
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((each) => each.textContent === label);

  it('offers Try Again on a lost file and Send Again after a reload, in Bengali with the file name', async () => {
    await mount('bn');
    await chooseFiles([photo('lost.jpg')]);
    await act(async () => FakeRequest.sent[0]?.drop());
    await flush();
    const retry = line('lost.jpg')?.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent).toBe(bn[`${U}tryAgain`]);
    expect(retry.getAttribute('aria-label')).toBe(
      bn[`${U}tryAgainName`]?.replace('{name}', 'lost.jpg'),
    );
    expect(retry.textContent).not.toBe('Try Again');
    await act(async () => retry.click());
    await flush();
    await answer(1, 201, { message: 'Added.', title: 'Lost' });

    act(() => root.unmount());
    root = createRoot(host);
    FakeRequest.sent = [];
    await mount('bn');
    await chooseFiles([photo('lost.jpg')]);
    expect(FakeRequest.sent).toHaveLength(0);
    const again = line('lost.jpg')?.querySelector('button') as HTMLButtonElement;
    expect(again.textContent).toBe(bn[`${K}sendAgain`]);
    expect(again.getAttribute('aria-label')).toBe(
      bn[`${K}sendAgainName`]?.replace('{name}', 'lost.jpg'),
    );
    expect(text()).not.toContain('Send Again');
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('keeps Try Again for All Paused Files English, as the English line on each paused file names it', async () => {
    await mount('bn');
    await chooseFiles(['h0.jpg', 'h1.jpg', 'h2.jpg'].map(photo));
    await answer(0, 429, { message: 'Too many uploads in a short time.' }, '1800');
    await answer(1);
    // Held (REFILL_LEFTOVERS.md, refill 7): the line below names the button by its English words.
    expect(bn[`${K}tryAgainForAllPausedFiles`]).toBeUndefined();
    expect(button('Try Again for All Paused Files'), 'the held button').toBeTruthy();
    expect(text()).toContain('Use Try Again for All Paused Files once the hour is up.');
  });

  it('turns Pause into Resume in Bengali', async () => {
    await mount('bn');
    await chooseFiles(['p0.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg'].map(photo));
    await act(async () => button(bn[`${K}pause`] ?? '')?.click());
    expect(button(bn[`${K}resume`] ?? ''), 'Resume').toBeTruthy();
    expect(text()).not.toContain('Resume');
  });

  it('shows all lines and fewer again, with the count in Bengali digits', async () => {
    await mount('bn');
    await chooseFiles(Array.from({ length: 51 }, (_, i) => photo(`s${i}.jpg`)));
    const showAll = bn[`${K}showAllLength`]?.replace('{length}', formatNumber(51, 'bn')) ?? '';
    expect(showAll).toMatch(/৫১/);
    const all = button(showAll);
    expect(all, showAll).toBeTruthy();
    await act(async () => all?.click());
    expect(button(bn[`${K}showFewer`] ?? ''), 'Show Fewer').toBeTruthy();
    expect(text()).not.toMatch(/Show (All|Fewer)/);
  });

  it('says most files are sorted on their own and offers See What We Found, in Bengali', async () => {
    await act(async () => {
      root.render(
        <I18nProvider locale="bn" pageLang="bn">
          <ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" readingOn />
        </I18nProvider>,
      );
    });
    await chooseFiles([photo('one.jpg')]);
    await answer(0, 201, {
      message: 'Added.',
      title: 'One',
      documentId: '66666666-6666-4666-8666-666666666666',
    });
    expect(text()).toContain(bn[`${K}mostFilesAreSortedOnTheir`]);
    expect(text()).not.toContain(en[`${K}mostFilesAreSortedOnTheir`]);
    const found = host.querySelector('a.btn-primary');
    expect(found?.textContent).toBe(bn[`${K}seeWhatWeFound`]);
    // The saved count beside it is still English (not in a catalogue yet).
    expect(text()).toContain('1 file is saved.');
  });

  it('says files for several people wait, and offers Choose Which Person, in Bengali', async () => {
    await mount('bn', people, true);
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '__not_sure';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await chooseFiles([photo('f1.jpg')]);
    expect(FakeRequest.sent[0]?.url).toBe('/api/documents/hold?applicantId=a-1');
    await answer(0, 201, { message: 'Added. It waits in Needs One Decision.', title: 'Waiting' });
    expect(text()).toContain(bn[`${K}filesForSeveralPeopleWaitIn`]);
    expect(text()).not.toContain(en[`${K}filesForSeveralPeopleWaitIn`]);
    const links = [...host.querySelectorAll('a')].map((a) => a.textContent);
    expect(links).toContain(bn[`${K}chooseWhichPerson`]);
    expect(links).not.toContain('Choose Which Person');
  });

  it('offers See What We Found for another person by name, in Bengali', async () => {
    await mount('bn', people, true);
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'a-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await chooseFiles([photo('hers.jpg')]);
    await answer(0, 201, { message: 'Added.', documentId: '77777777-7777-4777-8777-777777777777' });
    const links = [...host.querySelectorAll('a.btn-primary')].map((a) => a.textContent);
    expect(links).toEqual([bn[`${K}seeWhatWeFoundForName`]?.replace('{name}', 'Rina')]);
  });

  it('says Removing in Bengali while a new copy is being removed', async () => {
    removal.remove.mockReset().mockReturnValue(new Promise(() => undefined));
    await mount('bn', people);
    await chooseFiles([photo('copy.jpg')]);
    await answer(0, 201, {
      message: 'Added. This is an exact copy of a document you already keep.',
      title: 'Scan',
      removableCopyId: '11111111-1111-4111-8111-111111111111',
    });
    const remove = [...host.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes('copy.jpg'),
    );
    await act(async () => remove?.click());
    await flush();
    expect(remove?.textContent).toBe(bn[`${U}removing`]);
    expect(remove?.getAttribute('aria-label')).toBe(
      bn[`${U}removeThisNewCopyName`]?.replace('{name}', 'copy.jpg'),
    );
    expect(text()).not.toContain('Removing');
  });
});
