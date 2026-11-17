// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../lib/axe.test-support';
import { isTitleCase } from '../../../lib/title-case';

/**
 * WP-PIC11: the shared files panel in a DOM, with the service worker's answers and the upload
 * stood in by hand. Every file and person here is made up.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../applicant/[id]/documents/manage/delete/actions', () => ({
  deleteDuplicateAction: vi.fn(),
  restoreDeletedAction: vi.fn(),
}));
const sent = vi.hoisted(
  () => [] as { applicantId: string; fileName: string; contentType: string }[],
);
vi.mock('../../../lib/import/import-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/import/import-queue')>()),
  sendThroughUploadRoute: vi.fn(
    async (request: { applicantId: string; fileName: string; contentType: string }) => {
      sent.push({
        applicantId: request.applicantId,
        fileName: request.fileName,
        contentType: request.contentType,
      });
      return {
        kind: 'added',
        status: 201,
        message: 'Added and sent for checking.',
        title: request.fileName,
        documentId: `d-${sent.length}`,
        duplicate: false,
        removableCopyId: null,
      };
    },
  ),
}));

const { IncomingPanel } = await import('./incoming-panel');
const { ImportQueue } = await import('../../../lib/import/import-queue');

const KEY = 'owner-key-a';
const PEOPLE = [
  { id: 'p1', name: 'Rahim Example' },
  { id: 'p2', name: 'Nadia Example' },
];
const INBOX = {
  files: [
    { n: 0, name: 'passport.jpg', type: 'image/jpeg', size: 4 },
    { n: 1, name: 'bank.pdf', type: 'application/pdf', size: 4 },
  ],
  dropped: 1,
  at: Date.UTC(2026, 10, 17, 9, 0, 0),
  token: 'ab'.repeat(16),
};
const TOKEN = INBOX.token;

let calls: { url: string; method: string; key: string | null }[] = [];
// The share token each clear named.
let clearTokens: (string | null)[] = [];
let clearStatus = 200;
let container: HTMLDivElement;
let root: Root;

function serviceWorker(controller: boolean) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: controller ? {} : null },
  });
}

beforeEach(() => {
  sent.length = 0;
  calls = [];
  clearTokens = [];
  clearStatus = 200;
  serviceWorker(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        key: new Headers(init?.headers).get('x-visastack-share-key'),
      });
      if (url.startsWith('/share-target/list')) return Response.json(INBOX);
      if (url.startsWith('/share-target/file/0'))
        return new Response(new Uint8Array([255, 216, 255, 0]));
      if (url.startsWith('/share-target/file/1'))
        return new Response(new TextEncoder().encode('%PDF'));
      if (url === '/share-target/clear') {
        clearTokens.push(new Headers(init?.headers).get('x-visastack-share-token'));
        return Response.json({}, { status: clearStatus });
      }
      return new Response('unexpected', { status: 500 });
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function show(props: Partial<Parameters<typeof IncomingPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <IncomingPanel
        ownerKey={KEY}
        notice={null}
        people={PEOPLE}
        limitBytes={4 * 1024 * 1024}
        limitLabel="4 MB"
        pdfAccepted
        retryUnknown
        {...props}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found as HTMLButtonElement;
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

describe('WP-PIC11 shared files waiting on the phone', () => {
  it('shows them as pictures from the phone, and sends nothing yet', async () => {
    await show();
    expect(container.querySelector('h2')?.textContent).toBe('Shared Just Now');
    const images = [...container.querySelectorAll('img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      `/share-target/file/0?t=${TOKEN}`,
    ]);
    expect(container.innerHTML).not.toMatch(/(src|href)="(data|blob):/);
    expect(container.textContent).toContain('bank.pdf');
    expect(container.textContent).toContain('nothing is sent until you choose Add These Files');
    expect(container.textContent).toContain('1 file not kept');
    expect(container.textContent).not.toMatch(/Uploaded/);
    expect(sent).toEqual([]);
    expect(calls).toEqual([{ url: '/share-target/list', method: 'GET', key: KEY }]);
  });

  it('adds them for the chosen person through the normal upload, then clears the phone copy', async () => {
    await show();
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'p2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(sent).toEqual([
      { applicantId: 'p2', fileName: 'passport.jpg', contentType: 'image/jpeg' },
      { applicantId: 'p2', fileName: 'bank.pdf', contentType: 'application/pdf' },
    ]);
    expect(calls.some((c) => c.url === '/share-target/clear' && c.method === 'POST')).toBe(true);
    expect(container.textContent).toContain('Finished: 2 added');
    // The account key never appears in any address the page asked for.
    expect(calls.every((c) => !c.url.includes(KEY))).toBe(true);
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/app/applicant/p2/documents');
  });

  it('names this share when clearing after hand-off, so an older tab never empties a newer one', async () => {
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(clearTokens).toEqual([TOKEN]);
  });

  it('names this share when Cancel clears it', async () => {
    await show();
    await act(async () => {
      button('Cancel').click();
    });
    await settle();
    expect(clearTokens).toEqual([TOKEN]);
  });

  it('says the phone copies are removed only once the phone confirms it', async () => {
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(container.textContent).toContain('The shared copies kept on this phone are removed');
  });

  it('says nothing about removal when the phone could not remove them', async () => {
    clearStatus = 409;
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(container.textContent).toContain('Finished: 2 added');
    expect(container.textContent).not.toMatch(/removed/);
  });

  it('when adding stops part way, offers Try Again and Cancel with a plain line', async () => {
    vi.spyOn(ImportQueue.prototype, 'add').mockRejectedValueOnce(new Error('stopped'));
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(container.textContent).toContain('Adding stopped before it finished');
    expect(container.textContent).not.toContain('Please keep this page open');
    expect(button('Cancel').disabled).toBe(false);
    await act(async () => {
      button('Try Again').click();
    });
    await settle();
    expect(sent.map((s) => s.fileName)).toEqual(['passport.jpg', 'bank.pdf']);
    expect(container.textContent).toContain('Finished: 2 added');
  });

  it('Cancel removes them from the phone and sends nothing', async () => {
    await show();
    await act(async () => {
      button('Cancel').click();
    });
    await settle();
    expect(sent).toEqual([]);
    expect(calls.some((c) => c.url === '/share-target/clear')).toBe(true);
    expect(container.querySelector('h2')?.textContent).toBe('Shared Files Removed');
  });

  it('reads nothing without the service worker or an account key', async () => {
    serviceWorker(false);
    await show();
    expect(container.querySelector('h2')?.textContent).toBe('Nothing Waiting');
    expect(calls).toEqual([]);
    serviceWorker(true);
    await show({ ownerKey: null });
    expect(calls).toEqual([]);
  });

  it('says plainly when a share did not come through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ files: [], dropped: 0, at: 0 })),
    );
    await show({ notice: 'missed' });
    expect(container.querySelector('h2')?.textContent).toBe('That Share Did Not Come Through');
  });

  it('says which files it takes when the share held none it can use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ files: [], dropped: 0, at: 0 })),
    );
    await show({ notice: 'none' });
    expect(container.querySelector('h2')?.textContent).toBe('Nothing VisaStack Can Take');
  });

  it('finishes and clears the phone copy even when no file could be read back', async () => {
    const base = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url.startsWith('/share-target/file/')
          ? new Response('gone', { status: 404 })
          : base(url, init),
      ),
    );
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(sent).toEqual([]);
    expect(container.textContent).toContain('2 files could no longer be read');
    expect(container.textContent).toContain('Finished: 0 added');
    expect(calls.some((c) => c.url === '/share-target/clear')).toBe(true);
  });

  it('keeps two shared files with the same name and size apart', async () => {
    const twins = {
      files: [
        { n: 0, name: 'document.pdf', type: 'application/pdf', size: 4 },
        { n: 1, name: 'document.pdf', type: 'application/pdf', size: 4 },
      ],
      dropped: 0,
      at: INBOX.at,
      token: TOKEN,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', key: null });
        if (url.startsWith('/share-target/list')) return Response.json(twins);
        if (url.startsWith('/share-target/file/'))
          return new Response(new TextEncoder().encode('%PDF'));
        return Response.json({});
      }),
    );
    await show();
    await act(async () => {
      button('Add These Files').click();
    });
    await settle();
    expect(sent.map((s) => s.fileName)).toEqual(['document.pdf', 'document.pdf']);
  });

  it('uses Title Case names and passes the accessibility check', async () => {
    await show();
    for (const name of ['Shared Just Now', 'Who Are These For?', 'Add These Files', 'Cancel']) {
      expect(isTitleCase(name.replace('?', ''))).toBe(true);
    }
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
