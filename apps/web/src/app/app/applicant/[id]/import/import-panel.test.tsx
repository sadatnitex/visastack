// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { isTitleCase } from '../../../../../lib/title-case';

/**
 * The batch and folder import panel running in a DOM, with a stand-in for XMLHttpRequest that
 * the test answers by hand. Every file is made up here.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const actions = vi.hoisted(() => ({ remove: vi.fn(), restore: vi.fn() }));
vi.mock('../documents/manage/delete/actions', () => ({
  deleteDuplicateAction: actions.remove,
  restoreDeletedAction: actions.restore,
}));

const { ImportPanel, LINES_SHOWN_FIRST, BUSY_LINE } = await import('./import-panel');
const { UPLOAD_UNKNOWN_OUTCOME } = await import('../document-uploader');

class FakeRequest {
  static sent: FakeRequest[] = [];
  url = '';
  headers: Record<string, string> = {};
  body: Blob | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  retryAfter: string | null = null;
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
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  drop() {
    this.ontimeout?.();
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  refresh.mockClear();
});

async function mount() {
  await act(async () => {
    root.render(<ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" />);
  });
}

const photo = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified: 7 });

async function choose(testId: string, chosen: File[]) {
  const input = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: chosen, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** The visible text of some markup, spaces squeezed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim();
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const rows = () => Array.from(host.querySelectorAll('.upload-list li'));
const summary = () => host.querySelector('output.upload-summary')?.textContent ?? '';
const buttons = () => Array.from(host.querySelectorAll('button'));
const button = (label: string) => buttons().find((each) => each.textContent === label);
const added = { message: 'Added. It is being checked.', title: 'Photo' };

describe('the import panel before anything is chosen', () => {
  const html = renderToStaticMarkup(<ImportPanel applicantId="a-1" limitLabel="4 MB" />);

  it('says the limits and offers a folder, many files and a drop area', () => {
    const text = textOf(html);
    expect(text).toContain('Up to 4 MB per file; JPG, PNG, HEIC, Word or text files.');
    expect(text).toContain('Up to 500 files in one import.');
    expect(text).toContain('Drop a Folder or Many Files Here');
    expect(html).toContain('>Add a Folder</button>');
    expect(html).toContain('>Choose Many Files</button>');
    expect(html).toContain('<output class="upload-summary">');
    // The hidden inputs are reached through the buttons, never by Tab.
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('has no structural accessibility problems', async () => {
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('importing many files', () => {
  it('takes 85 files, sends two at a time, draws the first 50 lines, and loses none', async () => {
    await mount();
    const chosen = Array.from({ length: 85 }, (_, i) => photo(`scan-${i + 1}.jpg`));
    await choose('import-files', chosen);
    expect(FakeRequest.sent).toHaveLength(2);
    expect(summary()).toBe('Importing: 85 Waiting.');
    expect(rows()).toHaveLength(LINES_SHOWN_FIRST);
    // No name or folder path travels with a file.
    expect(Object.keys(FakeRequest.sent[0]?.headers ?? {})).toEqual(['Content-Type']);

    for (let answered = 0; answered < 85; answered++) {
      await act(async () => FakeRequest.sent[answered]?.answer(201, added));
      await flush();
    }
    expect(FakeRequest.sent).toHaveLength(85);
    expect(summary()).toBe('Import finished: 85 Added.');
    expect(refresh).toHaveBeenCalled();

    const showAll = button('Show All 85');
    expect(showAll?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => showAll?.click());
    expect(rows()).toHaveLength(85);
    expect(rows()[20]?.getAttribute('data-state')).toBe('added');
    expect(rows()[84]?.getAttribute('data-state')).toBe('added');
    expect(await axeViolations(host.innerHTML)).toEqual([]);
  });

  it('shows each honest ending and offers Try Again only where another try is safe', async () => {
    await mount();
    await choose('import-files', [
      photo('lost.jpg'),
      photo('refused.jpg'),
      photo('busy.jpg'),
      photo('huge.jpg', 5000),
    ]);
    await act(async () => FakeRequest.sent[0]?.drop());
    await act(async () =>
      FakeRequest.sent[1]?.answer(415, { message: 'This file type cannot be safely processed.' }),
    );
    await flush();
    // Busy three times: sent three times in all, then not added because the service was busy.
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = FakeRequest.sent[2 + attempt];
      if (request) request.retryAfter = '0';
      await act(async () => request?.answer(503, { message: 'Busy.' }));
      await flush();
    }
    expect(FakeRequest.sent).toHaveLength(5);

    const line = (name: string) =>
      rows().find((row) => row.querySelector('.upload-item-name')?.textContent === name);
    const said = (name: string) => line(name)?.querySelector('.upload-item-status')?.textContent;
    expect(said('lost.jpg')).toBe(`Not confirmed. ${UPLOAD_UNKNOWN_OUTCOME}`);
    expect(said('refused.jpg')).toBe('Not added. This file type cannot be safely processed.');
    expect(said('busy.jpg')).toBe(`Not added. ${BUSY_LINE}`);
    expect(said('huge.jpg')).toContain('Not added. This file is larger than 1 KB.');
    expect(summary()).toBe('Import finished: 3 Need a Look, 1 Not Supported.');

    const retry = (name: string) =>
      line(name)?.querySelector<HTMLButtonElement>('button[aria-label^="Try Again"]');
    expect(retry('huge.jpg')).toBeFalsy();
    // The unknown file was not sent again on its own.
    const sendsOf = (name: string) =>
      FakeRequest.sent.filter((request) => (request.body as File).name === name).length;
    expect(sendsOf('lost.jpg')).toBe(1);
    expect(retry('lost.jpg')).toBeTruthy();
    expect(retry('refused.jpg')).toBeTruthy();
    await act(async () => retry('lost.jpg')?.click());
    expect(sendsOf('lost.jpg')).toBe(2);
  });

  it('pauses, resumes and stops with buttons that are never disabled', async () => {
    await mount();
    await choose(
      'import-files',
      Array.from({ length: 6 }, (_, i) => photo(`p${i}.jpg`)),
    );
    const pause = button('Pause') as HTMLButtonElement;
    expect(pause.hasAttribute('disabled')).toBe(false);
    pause.focus();
    await act(async () => pause.click());
    expect(document.activeElement?.textContent).toBe('Resume');
    expect(summary()).toBe('Paused: 6 Waiting.');
    await act(async () => FakeRequest.sent[0]?.answer(201, added));
    await act(async () => FakeRequest.sent[1]?.answer(201, added));
    await flush();
    expect(FakeRequest.sent).toHaveLength(2);

    await act(async () => (button('Resume') as HTMLButtonElement).click());
    expect(FakeRequest.sent).toHaveLength(4);
    await act(async () => (button('Stop') as HTMLButtonElement).click());
    await act(async () => FakeRequest.sent[2]?.answer(201, added));
    await act(async () => FakeRequest.sent[3]?.answer(201, added));
    await flush();
    expect(FakeRequest.sent).toHaveLength(4);
    expect(summary()).toBe('Import finished: 4 Added, 2 Left Out.');
    expect(rows()[5]?.querySelector('.upload-item-status')?.textContent).toBe(
      'Not added. The import was stopped before this file was sent.',
    );
    expect(buttons().every((each) => !each.hasAttribute('disabled'))).toBe(true);
  });

  it('remembers added files, so the same folder chosen after a reload sends only the rest', async () => {
    await mount();
    await choose('import-files', [photo('one.jpg'), photo('two.jpg')]);
    await act(async () => FakeRequest.sent[0]?.answer(201, added));
    await act(async () => FakeRequest.sent[1]?.drop());
    await flush();

    act(() => root.unmount());
    root = createRoot(host);
    FakeRequest.sent = [];
    await mount();
    expect(textOf(host.innerHTML)).toContain('Your last import here added 1 file.');
    await choose('import-files', [photo('one.jpg'), photo('two.jpg'), photo('three.jpg')]);
    expect(FakeRequest.sent).toHaveLength(1);
    const said = rows().map((row) => row.querySelector('.upload-item-status')?.textContent);
    expect(said[0]).toBe('Already added in an earlier import, so it was not sent again.');
    expect(said[1]).toContain('Not confirmed. ');
    expect(said[1]).toContain('This is from an earlier import, so it was not sent again.');
  });
});

describe('dropping a folder', () => {
  it('walks the folder and lists hidden files as left out', async () => {
    await mount();
    const entry = (name: string, fullPath: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file: (ok: (file: File) => void) => ok(photo(name)),
    });
    let read = false;
    const folder = {
      isFile: false,
      isDirectory: true,
      name: 'Trip',
      fullPath: '/Trip',
      createReader: () => ({
        readEntries: (ok: (entries: unknown[]) => void) => {
          ok(
            read
              ? []
              : [
                  entry('passport.jpg', '/Trip/passport.jpg'),
                  entry('.DS_Store', '/Trip/.DS_Store'),
                ],
          );
          read = true;
        },
      }),
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        types: ['Files'],
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => folder, getAsFile: () => null }],
      },
    });
    await act(async () => host.querySelector('.upload-drop')?.dispatchEvent(drop));
    await flush();
    expect(FakeRequest.sent).toHaveLength(1);
    const [passport, hidden] = rows();
    expect(passport?.querySelector('.import-item-path')?.textContent).toBe('In Trip');
    expect(hidden?.querySelector('.upload-item-status')?.textContent).toBe(
      'Left out. Hidden and system files are left out.',
    );
  });
});

describe('the words on the panel', () => {
  it('names every button in Title Case', async () => {
    await mount();
    await choose(
      'import-files',
      Array.from({ length: LINES_SHOWN_FIRST + 2 }, (_, i) => photo(`n${i}.jpg`)),
    );
    await act(async () => FakeRequest.sent[0]?.drop());
    await flush();
    const names = buttons().map((each) => each.textContent ?? '');
    expect(names).toContain('Try Again');
    for (const name of names) expect(isTitleCase(name), name).toBe(true);
  });
});
