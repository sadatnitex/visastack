// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The upload form running in a DOM: several files at once, each with its own line, progress and
 * result, the camera as its own control, and drag and drop. The network is a stand-in for
 * XMLHttpRequest that the test answers by hand.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { DocumentUploader, UPLOAD_UNKNOWN_OUTCOME } = await import('./document-uploader');

class FakeRequest {
  static sent: FakeRequest[] = [];
  method = '';
  url = '';
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
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: Blob) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeRequest.sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
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

const groups = [
  { key: 'identity', label: 'Identity', choices: [{ key: 'PASSPORT', label: 'Passport' }] },
];

async function mount() {
  await act(async () => {
    root.render(
      <DocumentUploader
        applicantId="a-1"
        limitBytes={1000}
        limitLabel="1 KB"
        kindGroups={groups}
      />,
    );
  });
}

const file = (name: string, size: number, type: string) =>
  new File([new Uint8Array(size)], name, { type });

async function choose(input: HTMLInputElement, chosen: File[]) {
  Object.defineProperty(input, 'files', { value: chosen, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const rows = () => Array.from(host.querySelectorAll('.upload-list li'));
const picker = () => host.querySelector('[data-testid="document-files"]') as HTMLInputElement;
const summary = () => host.querySelector('output.upload-summary')?.textContent;

describe('the camera control', () => {
  it('is its own photo input that opens the back camera, apart from the file picker', async () => {
    await mount();
    const camera = host.querySelector('[data-testid="camera-photo"]') as HTMLInputElement;
    expect(camera.getAttribute('accept')).toBe('image/*');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(picker().hasAttribute('capture')).toBe(false);
    expect(picker().multiple).toBe(true);

    const opened: string[] = [];
    camera.addEventListener('click', () => opened.push('camera'));
    picker().addEventListener('click', () => opened.push('picker'));
    const button = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label);
    await act(async () => button('Take a Photo')?.click());
    await act(async () => button('Choose Files')?.click());
    expect(opened).toEqual(['camera', 'picker']);
  });
});

describe('a file refused for storage (ADR 0025 section 12.2)', () => {
  it('shows the upgrade line after the refusal only when the server sends it, and drops it on Try Again', async () => {
    await mount();
    await choose(picker(), [file('one.png', 10, 'image/png'), file('two.png', 10, 'image/png')]);
    const refusal = 'This account has reached its 100 MB evidence limit.';
    await act(async () =>
      (FakeRequest.sent[0] as FakeRequest).answer(400, { message: refusal, upgrade: 'storage' }),
    );
    await act(async () => (FakeRequest.sent[1] as FakeRequest).answer(400, { message: refusal }));
    const [offered, plain] = rows();
    const status = offered?.querySelector('.upload-item-status');
    expect(status?.textContent).toBe(
      `Not added. ${refusal} A paid plan gives you more room. See Plan & Usage.`,
    );
    const link = status?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/app/account/plan');
    expect(link?.textContent).toBe('A paid plan gives you more room. See Plan & Usage.');
    expect(plain?.querySelector('.upload-item-status')?.textContent).toBe(`Not added. ${refusal}`);
    expect(plain?.querySelector('a')).toBeNull();

    await act(async () => (offered?.querySelector('button') as HTMLButtonElement).click());
    expect(offered?.querySelector('a')).toBeNull();
  });
});

describe('adding several files at once', () => {
  it('gives each file its own line, sends them one at a time, and shows each result', async () => {
    await mount();
    const select = host.querySelector('select[name="docType"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'PASSPORT';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose(picker(), [
      file('MHM.png', 100, 'image/png'),
      file('IMG_2041.HEIC', 200, ''),
      file('notes.exe', 50, 'application/x-msdownload'),
      file('big.jpg', 5000, 'image/jpeg'),
    ]);

    expect(rows()).toHaveLength(4);
    // The two that cannot go are refused on the spot, each with its own reason.
    expect(rows()[2]?.textContent).toContain('This kind of file cannot be added');
    expect(rows()[3]?.textContent).toContain('larger than 1 KB');
    // Only one request at a time.
    expect(FakeRequest.sent).toHaveLength(1);
    const first = FakeRequest.sent[0] as FakeRequest;
    expect(first.url).toBe('/api/documents/upload?applicantId=a-1');
    expect(first.headers['Content-Type']).toBe('image/png');
    expect(first.headers['X-Document-Kind']).toBe('PASSPORT');
    expect(summary()).toBe('Uploading 1 of 2: MHM.png.');

    await act(async () => first.progress(50, 100));
    expect(rows()[0]?.querySelector('progress')?.getAttribute('value')).toBe('50');
    expect(rows()[0]?.textContent).toContain('50% sent');
    await act(async () => first.progress(100, 100));
    expect(rows()[0]?.textContent).toContain('Checking the file');

    await act(async () =>
      first.answer(201, { message: 'Passport added.', title: 'Passport, Nazmus' }),
    );
    expect(rows()[0]?.textContent).toContain('Added as Passport, Nazmus');
    // The kind chosen applied to that batch, and the iPhone photo goes as HEIC.
    const second = FakeRequest.sent[1] as FakeRequest;
    expect(second.headers['Content-Type']).toBe('image/heic');
    expect(second.headers['X-Document-Kind']).toBe('PASSPORT');
    expect(select.value).toBe('');
    expect(refresh).not.toHaveBeenCalled();

    await act(async () =>
      second.answer(400, { message: 'This account has reached its 100 MB evidence limit.' }),
    );
    const failed = rows()[1];
    expect(failed?.textContent).toContain('Not added.');
    expect(failed?.textContent).toContain('100 MB evidence limit');
    expect(summary()).toBe('1 file added. 3 files not added; the list says why.');
    // The list of documents is refreshed once the batch is over.
    expect(refresh).toHaveBeenCalledTimes(1);

    // A refused file can be tried again, on its own line.
    const retry = failed?.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent).toBe('Try Again');
    await act(async () => retry.click());
    expect(FakeRequest.sent).toHaveLength(3);
    await act(async () => (FakeRequest.sent[2] as FakeRequest).answer(201, { message: 'Added.' }));
    expect(summary()).toBe('2 files added. 2 files not added; the list says why.');
  });

  it('says the outcome is not known when no answer comes, and never that it failed', async () => {
    await mount();
    await choose(picker(), [file('scan.jpg', 10, 'image/jpeg')]);
    await act(async () => (FakeRequest.sent[0] as FakeRequest).onerror?.());
    const row = rows()[0];
    expect(row?.textContent).toContain('Not confirmed.');
    expect(row?.textContent).toContain(UPLOAD_UNKNOWN_OUTCOME);
    expect(row?.textContent?.toLowerCase()).not.toContain('failed');
    // A sign-in page or host error page instead of an answer is not taken as a result either.
    await choose(picker(), [file('scan2.jpg', 10, 'image/jpeg')]);
    const second = FakeRequest.sent[1] as FakeRequest;
    await act(async () => {
      second.status = 200;
      second.responseText = '<html>Sign in</html>';
      second.onload?.();
    });
    expect(rows()[1]?.textContent).toContain('Not confirmed.');
  });

  it('takes files dropped on the drop area, and shows the area is ready while dragging', async () => {
    await mount();
    const zone = host.querySelector('section.upload-drop') as HTMLElement;
    const dropped = [file('a.png', 10, 'image/png'), file('b.png', 10, 'image/png')];
    const transfer = { types: ['Files'], files: dropped, dropEffect: 'none' };
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      return event;
    };
    await act(async () => {
      zone.dispatchEvent(drag('dragover'));
    });
    expect(zone.getAttribute('data-dragging')).toBe('true');
    await act(async () => {
      zone.dispatchEvent(drag('drop'));
    });
    expect(zone.hasAttribute('data-dragging')).toBe(false);
    expect(rows().map((row) => row.querySelector('.upload-item-name')?.textContent)).toEqual([
      'a.png',
      'b.png',
    ]);
    expect(FakeRequest.sent).toHaveLength(1);
  });

  it('takes no more than the limit in one go, and says so on the extra lines', async () => {
    await mount();
    await choose(
      picker(),
      Array.from({ length: 21 }, (_, i) => file(`p${i}.png`, 10, 'image/png')),
    );
    expect(rows()).toHaveLength(21);
    expect(rows()[20]?.textContent).toContain('Add up to 20 files at a time');
  });
});
