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
};

let calls: { url: string; method: string }[] = [];
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
  serviceWorker(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.startsWith('/share-target/list')) return Response.json(INBOX);
      if (url.startsWith('/share-target/file/0'))
        return new Response(new Uint8Array([255, 216, 255, 0]));
      if (url.startsWith('/share-target/file/1'))
        return new Response(new TextEncoder().encode('%PDF'));
      if (url === '/share-target/clear') return Response.json({});
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
});

async function show(props: Partial<Parameters<typeof IncomingPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <IncomingPanel
        ownerKey={KEY}
        missed={false}
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
    expect(images.map((img) => img.getAttribute('src'))).toEqual([`/share-target/file/0?k=${KEY}`]);
    expect(container.innerHTML).not.toMatch(/(src|href)="(data|blob):/);
    expect(container.textContent).toContain('bank.pdf');
    expect(container.textContent).toContain('nothing is sent until you choose Add These Files');
    expect(container.textContent).toContain('1 file not kept');
    expect(container.textContent).not.toMatch(/Uploaded/);
    expect(sent).toEqual([]);
    expect(calls.map((c) => c.url)).toEqual([`/share-target/list?k=${KEY}`]);
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
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/app/applicant/p2/documents');
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
    await show({ missed: true });
    expect(container.querySelector('h2')?.textContent).toBe('That Share Did Not Come Through');
  });

  it('uses Title Case names and passes the accessibility check', async () => {
    await show();
    for (const name of ['Shared Just Now', 'Who Are These For?', 'Add These Files', 'Cancel']) {
      expect(isTitleCase(name.replace('?', ''))).toBe(true);
    }
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
