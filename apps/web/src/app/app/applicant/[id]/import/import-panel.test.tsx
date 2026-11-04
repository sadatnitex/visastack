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

const { ImportPanel, LINES_SHOWN_FIRST, BUSY_LINE, HELD_LINE } = await import('./import-panel');
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

/**
 * A stand-in for Web Crypto's digest that answers within the same turn. The real one works on a
 * background thread and, on a busy machine, can outlast the one timer tick these tests wait for,
 * which made the order of sends a matter of luck. Distinct text still gives a distinct result
 * (eight FNV-1a words with different seeds), so repeat detection stays real.
 */
function quickDigest(_algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new DataView(new ArrayBuffer(32));
  for (let word = 0; word < 8; word += 1) {
    let hash = (0x811c9dc5 ^ (word * 0x9e3779b1)) >>> 0;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    out.setUint32(word * 4, hash);
  }
  return Promise.resolve(out.buffer);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
    quickDigest as typeof globalThis.crypto.subtle.digest,
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
  refresh.mockClear();
});

async function mount() {
  await act(async () => {
    root.render(<ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" />);
  });
}

const photo = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified: 7 });

async function choose(chosen: File[]) {
  const input = host.querySelector('[data-testid="import-files"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: chosen, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
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
const counts = () => host.querySelector('.import-counts')?.textContent ?? '';
const spoken = () => host.querySelector('output')?.textContent ?? '';
const buttons = () => Array.from(host.querySelectorAll('button'));
const button = (label: string) => buttons().find((each) => each.textContent === label);
const line = (name: string) =>
  rows().find((row) => row.querySelector('.upload-item-name')?.textContent === name);
const said = (name: string) => line(name)?.querySelector('.upload-item-status')?.textContent;
const sendsOf = (name: string) =>
  FakeRequest.sent.filter((request) => (request.body as File).name === name).length;
const added = { message: 'Added. It is being checked.', title: 'Photo' };

async function answer(index: number, status = 201, body: unknown = added, retryAfter?: string) {
  await act(async () => FakeRequest.sent[index]?.answer(status, body, retryAfter ?? null));
  await flush();
}

describe('the import panel before anything is chosen', () => {
  const html = renderToStaticMarkup(<ImportPanel applicantId="a-1" limitLabel="4 MB" />);

  it('says the limits and offers a folder, many files and a drop area', () => {
    const text = textOf(html);
    expect(text).toContain('Up to 4 MB per file; JPG, PNG, HEIC, Word or text files.');
    expect(text).toContain('Up to 200 files in one import.');
    expect(text).toContain('Drop Files or a Folder Here');
    expect(html).toContain('>Add a Folder</button>');
    expect(html).toContain('>Choose Files</button>');
    expect(html).toContain('<output class="sr-only import-announce">');
    // The hidden inputs are reached through the buttons, never by Tab.
    expect(html.match(/<input[^>]*tabindex="-1"/g)).toHaveLength(2);
  });

  it('has no structural accessibility problems', async () => {
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('importing many files', () => {
  it('takes 85 files, sends two at a time, draws the first 50 lines, and loses none', async () => {
    await mount();
    const heard: string[] = [];
    const listen = () => {
      const now = spoken();
      if (now && heard.at(-1) !== now) heard.push(now);
    };
    await choose(Array.from({ length: 85 }, (_, i) => photo(`scan-${i + 1}.jpg`)));
    listen();
    expect(FakeRequest.sent).toHaveLength(2);
    expect(counts()).toBe('Importing: 85 Waiting.');
    expect(rows()).toHaveLength(LINES_SHOWN_FIRST);
    // UMPE P3: the file's own name and its upload id travel with it; the folder path never does.
    const headers = FakeRequest.sent[0]?.headers ?? {};
    expect(Object.keys(headers)).toEqual(['Content-Type', 'X-Upload-Id', 'X-File-Name']);
    expect(decodeURIComponent(headers['X-File-Name'] ?? '')).toMatch(/^scan-\d+\.jpg$/);
    expect(headers['X-Upload-Id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    for (let index = 0; index < 85; index++) {
      await answer(index);
      listen();
    }
    expect(FakeRequest.sent).toHaveLength(85);
    expect(counts()).toBe('Import finished: 85 Added.');
    expect(refresh).toHaveBeenCalled();
    // The read-out speaks at the start, each quarter and the end, and at no other time.
    expect(heard).toEqual([
      'Import started: 85 files to send.',
      'Import 25% done: 22 of 85 files.',
      'Import 50% done: 43 of 85 files.',
      'Import 75% done: 64 of 85 files.',
      'Import finished: 85 added.',
    ]);

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
    await choose([
      photo('lost.jpg'),
      photo('refused.jpg'),
      photo('busy.jpg'),
      photo('huge.jpg', 5000),
    ]);
    await act(async () => FakeRequest.sent[0]?.drop());
    await answer(1, 415, { message: 'This file type cannot be safely processed.' });
    // Busy three times with a short wait: sent three times in all, then not added.
    for (let attempt = 0; attempt < 3; attempt++) await answer(2 + attempt, 503, {}, '0');
    expect(FakeRequest.sent).toHaveLength(5);

    expect(said('lost.jpg')).toBe(`Not confirmed. ${UPLOAD_UNKNOWN_OUTCOME}`);
    expect(said('refused.jpg')).toBe('Not added. This file type cannot be safely processed.');
    expect(said('busy.jpg')).toBe(`Not added. ${BUSY_LINE}`);
    expect(said('huge.jpg')).toContain('Not added. This file is larger than 1 KB.');
    expect(counts()).toBe('Import finished: 3 Need a Look, 1 Not Supported.');

    const retry = (name: string) =>
      line(name)?.querySelector<HTMLButtonElement>('button[aria-label^="Try Again"]');
    expect(retry('huge.jpg')).toBeFalsy();
    expect(sendsOf('lost.jpg')).toBe(1);
    expect(retry('refused.jpg')).toBeTruthy();
    await act(async () => retry('lost.jpg')?.click());
    await flush();
    expect(sendsOf('lost.jpg')).toBe(2);
  });

  it('holds every waiting file at the hourly limit and sends them again on one button', async () => {
    await mount();
    await choose(Array.from({ length: 5 }, (_, i) => photo(`h${i}.jpg`)));
    await answer(0, 429, { message: 'Too many uploads in a short time.' }, '1800');
    await answer(1);
    expect(FakeRequest.sent).toHaveLength(2);
    expect(said('h0.jpg')).toBe(`Paused by the Hourly Limit. ${HELD_LINE}`);
    expect(said('h4.jpg')).toBe(`Paused by the Hourly Limit. ${HELD_LINE}`);
    expect(counts()).toBe('Import finished: 1 Added, 4 Paused by the Hourly Limit.');
    expect(spoken()).toBe(
      'Import paused by the hourly limit: 1 added, 4 paused by the hourly limit.',
    );

    const again = button('Try Again for All Paused Files') as HTMLButtonElement;
    again.focus();
    await act(async () => again.click());
    await flush();
    expect(FakeRequest.sent).toHaveLength(4);
    expect(button('Try Again for All Paused Files')).toBeUndefined();
    expect(document.activeElement?.textContent).toBe('Your Files');
  });

  it('pauses, resumes and stops with buttons that are never disabled, and says so', async () => {
    await mount();
    await choose(Array.from({ length: 6 }, (_, i) => photo(`p${i}.jpg`)));
    const pause = button('Pause') as HTMLButtonElement;
    pause.focus();
    await act(async () => pause.click());
    expect(document.activeElement?.textContent).toBe('Resume');
    expect(counts()).toBe('Paused: 6 Waiting.');
    expect(spoken()).toBe('Import paused. Files already on their way will finish.');
    await answer(0);
    await answer(1);
    expect(FakeRequest.sent).toHaveLength(2);

    await act(async () => (button('Resume') as HTMLButtonElement).click());
    await flush();
    expect(FakeRequest.sent).toHaveLength(4);
    const stop = button('Stop') as HTMLButtonElement;
    stop.focus();
    await act(async () => stop.click());
    expect(document.activeElement?.textContent).toBe('Your Files');
    await answer(2);
    await answer(3);
    expect(FakeRequest.sent).toHaveLength(4);
    expect(counts()).toBe('Import finished: 4 Added, 2 Left Out.');
    expect(spoken()).toBe('Import stopped: 4 added, 2 left out.');
    expect(said('p5.jpg')).toBe('Not added. The import was stopped before this file was sent.');
    expect(buttons().every((each) => !each.hasAttribute('disabled'))).toBe(true);
  });

  it('asks before leaving only while a file is on its way', async () => {
    await mount();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await choose([photo('a.jpg')]);
    expect(leave()).toBe(true);
    await answer(0);
    expect(leave()).toBe(false);
  });

  it('lists the same file added twice in one visit as already in this import', async () => {
    await mount();
    await choose([photo('a.jpg')]);
    await choose([photo('a.jpg'), photo('b.jpg')]);
    expect(FakeRequest.sent.map((request) => (request.body as File).name)).toEqual([
      'a.jpg',
      'b.jpg',
    ]);
    expect(rows()[1]?.querySelector('.upload-item-status')?.textContent).toBe(
      'Left out. Already in this import, so it was not sent twice.',
    );
  });
});

describe('keyboard focus when a button goes away', () => {
  it('Try Again and Send Again leave the focus on their own line', async () => {
    await mount();
    await choose([photo('lost.jpg')]);
    await act(async () => FakeRequest.sent[0]?.drop());
    await flush();
    const retry = line('lost.jpg')?.querySelector('button') as HTMLButtonElement;
    retry.focus();
    // Enter on a focused button activates it; the stand-in for the key is the click it fires.
    await act(async () => retry.click());
    await flush();
    expect(line('lost.jpg')?.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(line('lost.jpg')?.querySelector('.upload-item-status'));
    await answer(1);

    // After a reload, the same file is shown as added before, with Send Again.
    act(() => root.unmount());
    root = createRoot(host);
    FakeRequest.sent = [];
    await mount();
    await choose([photo('lost.jpg')]);
    expect(FakeRequest.sent).toHaveLength(0);
    const sendAgain = line('lost.jpg')?.querySelector('button') as HTMLButtonElement;
    expect(sendAgain.textContent).toBe('Send Again');
    sendAgain.focus();
    await act(async () => sendAgain.click());
    await flush();
    expect(FakeRequest.sent).toHaveLength(1);
    expect(document.activeElement).toBe(line('lost.jpg')?.querySelector('.upload-item-status'));
  });
});

describe('after a reload', () => {
  it('sends only the files not already added, keeps a file that was on its way not confirmed, and Forget clears it', async () => {
    await mount();
    await choose([photo('one.jpg'), photo('two.jpg')]);
    await answer(0);
    // The page goes while two.jpg is still on its way.
    act(() => root.unmount());
    const saved = window.localStorage.getItem('visastack.import.v2.a-1') ?? '';
    expect(saved).not.toContain('one.jpg');

    root = createRoot(host);
    FakeRequest.sent = [];
    await mount();
    expect(textOf(host.innerHTML)).toContain('This browser remembers which files earlier imports');
    await choose([photo('one.jpg'), photo('two.jpg'), photo('three.jpg')]);
    expect(FakeRequest.sent.map((request) => (request.body as File).name)).toEqual(['three.jpg']);
    expect(said('one.jpg')).toBe('Already added in an earlier import, so it was not sent again.');
    expect(said('two.jpg')).toContain('Not confirmed. ');
    expect(said('two.jpg')).toContain('This is from an earlier import, so it was not sent again.');

    await act(async () => (button('Forget Earlier Imports') as HTMLButtonElement).click());
    expect(window.localStorage.getItem('visastack.import.v2.a-1')).toBeNull();
    expect(button('Forget Earlier Imports')).toBeUndefined();
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
    await choose(Array.from({ length: LINES_SHOWN_FIRST + 2 }, (_, i) => photo(`n${i}.jpg`)));
    await act(async () => FakeRequest.sent[0]?.drop());
    await answer(1, 429, { message: 'Too many uploads.' }, '1800');
    const names = buttons().map((each) => each.textContent ?? '');
    expect(names).toContain('Try Again');
    expect(names).toContain('Try Again for All Paused Files');
    for (const name of names) expect(isTitleCase(name), name).toBe(true);
  });
});

describe('after an import, and files for several people (UMPE G1)', () => {
  it('links the finished import to Needs One Decision and the details waiting for approval', async () => {
    await mount();
    await choose([photo('passport.jpg')]);
    await answer(0);
    const next = host.querySelector('nav[aria-label="After This Import"]');
    const links = Array.from(next?.querySelectorAll('a') ?? []).map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Open Needs One Decision', '/app/applicant/a-1/documents#needs-decision'],
      ['Review Suggested Details', '/app/applicant/a-1'],
    ]);
    expect(await axeViolations(host.innerHTML)).toEqual([]);
  });

  it('never says files were sorted on their own when automatic reading is off', async () => {
    await act(async () => {
      root.render(
        <ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" readingOn={false} />,
      );
    });
    await choose([photo('one.jpg')]);
    await answer(0, 201, { message: 'Added.', title: 'One' });
    expect(host.textContent).toContain('Automatic reading is off, so nothing was read');
    expect(host.textContent).not.toContain('sorted on their own');
  });

  it('never claims reading unless the page says it is on', async () => {
    await act(async () => {
      root.render(<ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" />);
    });
    await choose([photo('one.jpg')]);
    await answer(0, 201, { message: 'Added.', title: 'One' });
    expect(host.textContent).not.toContain('sorted on their own');
  });

  it('keeps the earlier wording when reading is on', async () => {
    await act(async () => {
      root.render(<ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" readingOn />);
    });
    await choose([photo('one.jpg')]);
    await answer(0, 201, { message: 'Added.', title: 'One' });
    expect(host.textContent).toContain('Most files are sorted on their own');
  });

  it('keeps the hint but drops both buttons when the page has its own next step', async () => {
    await act(async () => {
      root.render(
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          showNext={false}
          readingOn
        />,
      );
    });
    await choose([photo('passport.jpg')]);
    await answer(0);
    const next = host.querySelector('nav[aria-label="After This Import"]');
    expect(next?.textContent).toContain('Most files are sorted on their own');
    expect(next?.querySelectorAll('a')).toHaveLength(0);
  });

  it('sends files marked "not sure" to the holding route and says where they wait', async () => {
    await act(async () => {
      root.render(
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          familyBatch
          people={[
            { id: 'a-1', name: 'Rahim Uddin' },
            { id: 'a-2', name: 'Sara Uddin' },
          ]}
        />,
      );
    });
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '__not_sure';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose([photo('family-1.jpg'), photo('family-2.jpg')]);
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/documents/hold?applicantId=a-1',
      '/api/documents/hold?applicantId=a-1',
    ]);
    await answer(0, 201, { message: 'Added. It waits in Needs One Decision.', title: 'Waiting' });
    await answer(1, 201, { message: 'Added. It waits in Needs One Decision.', title: 'Waiting' });
    expect(button('Choose Which Person') ?? host.querySelector('a.btn-primary')?.textContent).toBe(
      'Choose Which Person',
    );
    expect(await axeViolations(host.innerHTML)).toEqual([]);
  });

  it('asks who the files are for and files them straight under that person', async () => {
    const people = [
      { id: 'a-1', name: 'Rahim Uddin' },
      { id: 'a-2', name: 'Sara Uddin' },
    ];
    await act(async () => {
      root.render(
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          familyBatch
          people={people}
        />,
      );
    });
    const select = host.querySelector('select') as HTMLSelectElement;
    expect(host.querySelector(`label[for="${select.id}"]`)?.textContent).toBe(
      'Who Are These Files For?',
    );
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Rahim Uddin (This Person)',
      'Sara Uddin',
      'Not Sure, Help Me Decide',
    ]);
    // The page's own person is chosen to begin with: a file goes there and nowhere else.
    expect(select.value).toBe('a-1');
    await act(async () => {
      select.value = 'a-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose([photo('marriage-1.jpg')]);
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/documents/upload?applicantId=a-2',
    ]);
    await answer(0, 201, { message: 'Added.', title: 'Marriage Certificate' });
    expect(host.textContent).toContain('Files for Sara Uddin were saved under Sara Uddin.');
    expect(host.querySelector('a[href="/app/applicant/a-2/documents"]')?.textContent).toBe(
      "Open Sara Uddin's Documents",
    );
    expect(await axeViolations(host.innerHTML)).toEqual([]);
  });

  it('sends "not sure" to the family route and keeps one person to the ordinary route', async () => {
    const people = [
      { id: 'a-1', name: 'Rahim Uddin' },
      { id: 'a-2', name: 'Sara Uddin' },
    ];
    await act(async () => {
      root.render(
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          familyBatch
          people={people}
        />,
      );
    });
    const select = host.querySelector('select') as HTMLSelectElement;
    await choose([photo('own.jpg')]);
    await answer(0, 201, { message: 'Added.', title: 'Own' });
    await act(async () => {
      select.value = '__not_sure';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose([photo('either.jpg')]);
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/documents/upload?applicantId=a-1',
      '/api/documents/hold?applicantId=a-1',
    ]);
  });

  it('does not report a file chosen again for another person as already added', async () => {
    const people = [
      { id: 'a-1', name: 'Rahim Uddin' },
      { id: 'a-2', name: 'Sara Uddin' },
    ];
    await act(async () => {
      root.render(
        <ImportPanel applicantId="a-1" limitBytes={1000} limitLabel="1 KB" people={people} />,
      );
    });
    const select = host.querySelector('select') as HTMLSelectElement;
    const same = photo('marriage.jpg');
    await choose([same]);
    await answer(0, 201, { message: 'Added.', title: 'Marriage Certificate' });
    await act(async () => {
      select.value = 'a-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose([same]);
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/documents/upload?applicantId=a-1',
      '/api/documents/upload?applicantId=a-2',
    ]);
  });

  it('asks nothing when the account keeps a record for one person only', async () => {
    await act(async () => {
      root.render(
        <ImportPanel
          applicantId="a-1"
          limitBytes={1000}
          limitLabel="1 KB"
          familyBatch
          people={[{ id: 'a-1', name: 'Rahim Uddin' }]}
        />,
      );
    });
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('fieldset.umpe-g1-import-for')).toBeNull();
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(host.textContent).not.toContain('Who Are These Files For?');
    await choose([photo('only-me.jpg')]);
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/documents/upload?applicantId=a-1',
    ]);
  });

  it('offers no choice of people when the family batch is not available', async () => {
    await mount();
    expect(host.querySelector('fieldset.umpe-g1-import-for')).toBeNull();
  });
});
