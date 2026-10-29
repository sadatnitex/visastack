// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTitleCase } from '../lib/title-case';
import { SAFE_COPY_STATE_LABELS, SafeCopyEditor, boxKeyAction } from './safe-copy-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const documentId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000101';
const REVISION = '00000000-0000-4000-8000-0000000000ee';

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let calls: {
  path: string;
  body: { readonly page?: unknown; readonly maskRevision?: unknown } & Record<string, unknown>;
}[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let failingPages: Set<number>;

function respond(editor: Record<string, unknown> = {}) {
  return async (path: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { readonly page?: unknown } & Record<string, unknown>;
    calls.push({ path, body });
    if (path === '/api/documents/redaction-editor') {
      return json({
        versionId,
        pageCount: 2,
        state: 'NOT_PREPARED',
        savedPages: null,
        canSave: true,
        ...editor,
      });
    }
    if (path === '/api/documents/redaction-page') {
      if (failingPages.has(Number(body.page))) return json({ message: 'Try again soon.' }, 503);
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    if (path === '/api/documents/safe-copy-prepare') {
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
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(
  initialState: 'NOT_PREPARED' | 'PREPARING' | 'MASKED' = 'NOT_PREPARED',
  available = true,
) {
  await act(async () => {
    root.render(
      <SafeCopyEditor
        documentId={documentId}
        versionId={versionId}
        returnTo="/app/applicant/a/documents"
        initialState={initialState}
        available={available}
      />,
    );
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`missing button ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
  await settle();
}

function boxes(): SVGRectElement[] {
  return [...container.querySelectorAll<SVGRectElement>('rect[role="button"]')];
}

async function key(target: Element, keyName: string, shiftKey = false) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey, bubbles: true }));
  });
  await settle();
}

function status(): string {
  return container.querySelector('output.safe-copy-status')?.textContent ?? '';
}

function listed(): string[] {
  return [...container.querySelectorAll('.safe-copy-list li > span:first-child')].map(
    (item) => item.textContent ?? '',
  );
}

async function openEditor() {
  await mount();
  await click('Prepare Safe Copy');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  calls = [];
  fetchMock = vi.fn(respond());
  vi.stubGlobal('fetch', fetchMock);
  failingPages = new Set();
  window.sessionStorage.clear();
  // Pages are decoded into bitmaps and painted on a canvas: no image address is ever made.
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
});

describe('safe copy editor: keyboard', () => {
  it('maps keys exactly: arrows move, Shift with an arrow resizes, Delete and Backspace remove', () => {
    expect(boxKeyAction('ArrowRight', false)).toEqual({ kind: 'move', dx: 0.01, dy: 0 });
    expect(boxKeyAction('ArrowUp', false)).toEqual({ kind: 'move', dx: 0, dy: -0.01 });
    expect(boxKeyAction('ArrowDown', true)).toEqual({ kind: 'resize', dw: 0, dh: 0.01 });
    expect(boxKeyAction('ArrowLeft', true)).toEqual({ kind: 'resize', dw: -0.01, dh: 0 });
    expect(boxKeyAction('Delete', false)).toEqual({ kind: 'remove' });
    expect(boxKeyAction('Backspace', false)).toEqual({ kind: 'remove' });
    expect(boxKeyAction('a', false)).toEqual({ kind: 'none' });
  });

  it('adds a box by keyboard, focuses it, moves, resizes and removes it, announcing each change', async () => {
    await openEditor();
    expect(container.textContent).toContain('Page 1 of 2');
    expect(container.textContent).toContain('Check every page. Only the black boxes are hidden.');
    await click('Add Box');
    const [box] = boxes();
    if (!box) throw new Error('a box expected');
    // Focus moves to the new box, which is a labelled, focusable control.
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toContain(
      'Box 1 on page 1: 35% from the left, 47% from the top, 30% wide and 6% tall.',
    );
    expect(status()).toContain('Box 1 added');
    expect(listed()).toEqual([
      'Box 1 on page 1: 35% from the left, 47% from the top, 30% wide and 6% tall.',
    ]);

    await key(box, 'ArrowRight');
    expect(status()).toBe(
      'Box 1 moved: 36% from the left, 47% from the top, 30% wide and 6% tall.',
    );
    await key(boxes()[0] as Element, 'ArrowDown');
    expect(status()).toContain('48% from the top');
    await key(boxes()[0] as Element, 'ArrowRight', true);
    expect(status()).toBe(
      'Box 1 resized: 36% from the left, 48% from the top, 31% wide and 6% tall.',
    );
    await key(boxes()[0] as Element, 'ArrowUp', true);
    expect(status()).toContain('5% tall');
    expect(listed()[0]).toContain('36% from the left, 48% from the top, 31% wide and 5% tall');

    await key(boxes()[0] as Element, 'Delete');
    expect(boxes()).toHaveLength(0);
    expect(status()).toBe('Box 1 removed. 0 left on this page.');
    // Focus returns to Add Box, never lost to the page.
    expect(document.activeElement).toBe(button('Add Box'));
  });

  it('offers the same moves as buttons for the selected box', async () => {
    await openEditor();
    await click('Add Box');
    await click('Move Left');
    expect(status()).toContain('34% from the left');
    await click('Make Taller');
    expect(status()).toContain('7% tall');
    await click('Remove Box');
    expect(boxes()).toHaveLength(0);
  });

  it('keeps every page and the pager in reach, and names pages', async () => {
    await openEditor();
    await click('Next Page');
    expect(status()).toBe('Page 2 of 2.');
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe('Page 2 of 2');
    expect(container.querySelector('img')).toBeNull();
    expect(
      calls.filter((c) => c.path === '/api/documents/redaction-page').map((c) => c.body.page),
    ).toEqual([1, 2]);
  });
});

describe('safe copy editor: suggestions, review and saving', () => {
  it('marks suggestions as not accepted, and refuses review until each is accepted', async () => {
    await openEditor();
    await click('Suggest Boxes');
    expect(status()).toBe('1 suggested box added on 1 page. Accept or remove each one.');
    expect(listed()[0]).toContain('Suggested for passport lines, not accepted yet.');
    expect(boxes()[0]?.getAttribute('class')).toContain('safe-copy-box-suggested');
    await click('Review Pages');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Accept or remove every suggested box first.',
    );
    await click('Accept');
    expect(listed()[0]).toContain('accepted.');
    await click('Review Pages');
    expect(container.textContent).toContain('Check Every Page');
    expect(container.textContent).toContain('Page 1 of 2: 1 box hidden.');
    expect(container.textContent).toContain('Page 2 of 2: nothing hidden.');
    await click('Save Safe Copy');
    const save = calls.find((c) => c.path === '/api/documents/redaction-masks');
    expect(save?.body).toMatchObject({
      versionId,
      nothingToHide: false,
      pages: [
        { boxes: [{ x: 0.02, y: 0.78, w: 0.96, h: 0.2 }], acceptedSuggestions: 1 },
        { boxes: [], acceptedSuggestions: 0 },
      ],
    });
    // Each page is then prepared once, in order, for the saved revision.
    expect(
      calls
        .filter((c) => c.path === '/api/documents/safe-copy-prepare')
        .map((c) => [c.body.page, c.body.maskRevision]),
    ).toEqual([
      [1, REVISION],
      [2, REVISION],
    ]);
    expect(status()).toBe(
      'Safe copy ready. People you share safe copies with can now download it.',
    );
    expect(container.textContent).toContain(SAFE_COPY_STATE_LABELS.MASKED);
    expect(button('Download Safe Copy')).toBeTruthy();
  });

  it('needs boxes or the explicit Nothing to Hide choice, and saves that choice', async () => {
    await openEditor();
    await click('Review Pages');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Add a box, or choose Nothing to Hide on This Document.',
    );
    await click('Nothing to Hide on This Document');
    expect(container.textContent).toContain('You chose Nothing to Hide on This Document.');
    await click('Save Safe Copy');
    const save = calls.find((c) => c.path === '/api/documents/redaction-masks');
    expect(save?.body).toMatchObject({ nothingToHide: true });
  });

  it('opens from a link to its section', async () => {
    window.location.hash = `#safe-copy-${documentId}`;
    await mount();
    expect(container.querySelector('details')?.open).toBe(true);
    window.location.hash = '';
  });

  it('names every control in Title Case and gives every state a plain label', async () => {
    await openEditor();
    await click('Add Box');
    for (const control of container.querySelectorAll('button, summary, legend, h3')) {
      const text = control.textContent ?? '';
      if (text.split(' ').length > 1) expect(isTitleCase(text)).toBe(true);
    }
    for (const label of Object.values(SAFE_COPY_STATE_LABELS)) {
      expect(label.startsWith('Safe Copy: ')).toBe(true);
    }
    // A status line for every change, read politely.
    expect(container.querySelector('output.safe-copy-status')?.getAttribute('aria-live')).toBe(
      'polite',
    );
  });

  it('keeps unsaved boxes for this tab, so a fresh identity check never loses them', async () => {
    await openEditor();
    await click('Add Box');
    await click('Move Right');
    expect(window.sessionStorage.length).toBe(1);
    const kept = window.sessionStorage.getItem(window.sessionStorage.key(0) ?? '') ?? '';
    // Positions and page numbers only.
    expect(JSON.parse(kept)).toEqual({
      pageCount: 2,
      pages: [[{ box: { x: 0.36, y: 0.47, w: 0.3, h: 0.06 } }], []],
    });
    act(() => root.unmount());
    root = createRoot(container);
    await openEditor();
    expect(status()).toContain('Your unsaved boxes were restored.');
    expect(listed()[0]).toContain('36% from the left');
    await click('Cancel Editing');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('loads review pages one at a time, offers Try Again, and saves only once every page shows', async () => {
    failingPages = new Set([2]);
    await openEditor();
    await click('Add Box');
    await click('Review Pages');
    const pageCalls = () =>
      calls.filter((c) => c.path === '/api/documents/redaction-page').map((c) => c.body.page);
    expect(pageCalls()).toEqual([1, 2]);
    expect(button('Save Safe Copy').getAttribute('aria-disabled')).toBe('true');
    expect(container.textContent).toContain(
      'Every page must show before the safe copy can be saved.',
    );
    await click('Save Safe Copy');
    expect(calls.some((c) => c.path === '/api/documents/redaction-masks')).toBe(false);
    failingPages = new Set();
    await click('Try Again');
    expect(pageCalls()).toEqual([1, 2, 2]);
    expect(button('Save Safe Copy').getAttribute('aria-disabled')).toBeNull();
  });

  it('carries on preparing a saved copy, and removes a copy without opening the editor', async () => {
    fetchMock.mockImplementation(respond({ state: 'PREPARING', maskRevision: REVISION }));
    await mount('PREPARING');
    expect(container.textContent).toContain(SAFE_COPY_STATE_LABELS.PREPARING);
    await click('Continue Preparing');
    expect(calls.filter((c) => c.path === '/api/documents/safe-copy-prepare')).toHaveLength(2);
    expect(status()).toContain('Safe copy ready.');
    calls = [];
    await click('Remove Safe Copy');
    expect(calls.map((c) => c.path)).toEqual(['/api/documents/redaction-masks']);
    expect(calls[0]?.body).toMatchObject({ versionId, clear: true });
    expect(container.textContent).toContain(SAFE_COPY_STATE_LABELS.NOT_PREPARED);
  });

  it('says plainly when safe copies are off here, and offers nothing', async () => {
    await mount('MASKED', false);
    expect(container.textContent).toContain('Safe copies are not available here yet.');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
