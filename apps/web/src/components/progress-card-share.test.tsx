// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_CARD_FILE_NAME } from '../lib/progress-card/file-name';
import {
  DOWNLOAD_PROGRESS_CARD,
  PROGRESS_CARD_BUSY,
  PROGRESS_CARD_FAILED,
  PROGRESS_CARD_MAKING,
  PROGRESS_CARD_SAVED,
  PROGRESS_CARD_TAP_AGAIN,
  ProgressCardShare,
  SHARE_PROGRESS_CARD,
  SHARE_PROGRESS_CARD_NOW,
  canShareImageFiles,
  progressCardHref,
} from './progress-card-share';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CASE = '11111111-2222-4333-8444-555555555555';
let host: HTMLDivElement;
const png = () =>
  new Response(new Uint8Array([0x89, 0x50]), { headers: { 'content-type': 'image/png' } });

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProgressCardShare missionId={CASE} />));
  return root;
}

const FETCH_OPTIONS = {
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  signal: expect.any(AbortSignal),
};
const realObjectUrls = {
  create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
};

/** Replaces only the two static helpers, keeping the real URL class for everything else. */
function stubObjectUrls(create: (blob: Blob) => string, revoke: (url: string) => void) {
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
}

function restoreObjectUrls() {
  for (const [key, descriptor] of [
    ['createObjectURL', realObjectUrls.create],
    ['revokeObjectURL', realObjectUrls.revoke],
  ] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else delete (URL as unknown as Record<string, unknown>)[key];
  }
}

function setShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

beforeEach(() => setShare(undefined, undefined));
afterEach(() => {
  host?.remove();
  restoreObjectUrls();
  vi.unstubAllGlobals();
});

describe('Share Progress Card', () => {
  it('points at the card for this case only', () => {
    expect(progressCardHref(CASE)).toBe(`/api/progress-card/${CASE}`);
    expect(progressCardHref('../x')).toBe('/api/progress-card/..%2Fx');
  });

  it('offers a Download button where the phone cannot share pictures, and saves the checked card', async () => {
    const created: Blob[] = [];
    const revoke = vi.fn();
    stubObjectUrls((blob: Blob) => {
      created.push(blob);
      return 'blob:card';
    }, revoke);
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const fetchMock = vi.fn().mockResolvedValue(png());
    vi.stubGlobal('fetch', fetchMock);
    try {
      await mount();
      expect(host.querySelector('a')).toBeNull();
      const button = host.querySelector('button');
      expect(button?.textContent).toBe(DOWNLOAD_PROGRESS_CARD);
      await act(async () => button?.click());
      expect(fetchMock).toHaveBeenCalledWith(`/api/progress-card/${CASE}`, FETCH_OPTIONS);
      expect(created).toHaveLength(1);
      expect(created[0]?.type).toBe('image/png');
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.getAttribute('href')).toBe('blob:card');
      expect(clicked[0]?.getAttribute('download')).toBe(PROGRESS_CARD_FILE_NAME);
      // The short-lived link is gone at once and its address is let go soon after.
      expect(document.querySelector('a[href="blob:card"]')).toBeNull();
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:card'), { timeout: 3000 });
      expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_SAVED);
    } finally {
      click.mockRestore();
    }
  });

  it('never saves a sign-in page or a not-found page as the card, and says so plainly', async () => {
    const create = vi.fn(() => 'blob:card');
    stubObjectUrls(create, vi.fn());
    // Signed out: the redirect to sign-in is refused, so fetch rejects.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('redirect')));
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
    // Switched off after the page loaded: a 404 body is not a picture.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
    // An HTML page that claims success is not a picture either.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    );
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
    expect(create).not.toHaveBeenCalled();
  });

  it('tells screen readers while the card is being made', async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('button')?.textContent).toBe(PROGRESS_CARD_BUSY);
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_MAKING);
    await act(async () => finish(new Response('not found', { status: 404 })));
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
  });

  it('hands the picture to the phone share sheet where it can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share, () => true);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([0x89, 0x50]), { headers: { 'content-type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    const button = host.querySelector('button');
    expect(button?.textContent).toBe(SHARE_PROGRESS_CARD);
    expect(host.querySelector('a')).toBeNull();
    await act(async () => button?.click());
    expect(fetchMock).toHaveBeenCalledWith(`/api/progress-card/${CASE}`, FETCH_OPTIONS);
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files[0]?.name).toBe(PROGRESS_CARD_FILE_NAME);
    expect(shared.files[0]?.type).toBe('image/png');
    expect(host.querySelector('output')?.textContent).toBe('');
  });

  it('says so plainly when the card could not be made, and stays quiet when the sheet is closed', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    setShare(share, () => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(png()));
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
  });

  it('never shares a page that is not a picture, such as a sign-in page', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share, () => true);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    );
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(share).not.toHaveBeenCalled();
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
  });

  it('keeps the card for one more tap when the phone wants a fresh tap to open its sheet', async () => {
    const share = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('needs a tap', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    setShare(share, () => true);
    const fetchMock = vi.fn().mockResolvedValue(png());
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('button')?.textContent).toBe(SHARE_PROGRESS_CARD_NOW);
    // Screen readers hear that one more tap is needed.
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_TAP_AGAIN);
    await act(async () => host.querySelector('button')?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);
    expect(host.querySelector('button')?.textContent).toBe(SHARE_PROGRESS_CARD);
    expect(host.querySelector('output')?.textContent).toBe('');
  });

  it('never shares a card kept for one case after the page moves to another case', async () => {
    const share = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('needs a tap', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    setShare(share, () => true);
    const fetchMock = vi.fn().mockResolvedValue(png());
    vi.stubGlobal('fetch', fetchMock);
    const root = await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('button')?.textContent).toBe(SHARE_PROGRESS_CARD_NOW);
    const other = '99999999-2222-4333-8444-555555555555';
    await act(async () => root.render(<ProgressCardShare missionId={other} />));
    expect(host.querySelector('button')?.textContent).toBe(SHARE_PROGRESS_CARD);
    expect(host.querySelector('output')?.textContent).toBe('');
    await act(async () => host.querySelector('button')?.click());
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/progress-card/${other}`, FETCH_OPTIONS);
  });

  it('treats a browser that cannot say, or throws, as one that cannot share', () => {
    expect(canShareImageFiles(undefined)).toBe(false);
    const throwing = {
      share: () => Promise.resolve(),
      canShare: () => {
        throw new Error('no');
      },
    } as unknown as Navigator;
    expect(canShareImageFiles(throwing)).toBe(false);
  });
});
