// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_PROGRESS_CARD,
  PROGRESS_CARD_FAILED,
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

function setShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

beforeEach(() => setShare(undefined, undefined));
afterEach(() => {
  host?.remove();
  vi.unstubAllGlobals();
});

describe('Share Progress Card', () => {
  it('points at the card for this case only', () => {
    expect(progressCardHref(CASE)).toBe(`/api/progress-card/${CASE}`);
    expect(progressCardHref('../x')).toBe('/api/progress-card/..%2Fx');
  });

  it('offers a plain Download link where the phone cannot share pictures', async () => {
    await mount();
    expect(host.querySelector('button')).toBeNull();
    const link = host.querySelector('a');
    expect(link?.textContent).toBe(DOWNLOAD_PROGRESS_CARD);
    expect(link?.getAttribute('href')).toBe(`/api/progress-card/${CASE}`);
    expect(link?.getAttribute('download')).toBe('progress-card.png');
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
    expect(fetchMock).toHaveBeenCalledWith(`/api/progress-card/${CASE}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files[0]?.name).toBe('progress-card.png');
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
    expect(host.querySelector('output')?.textContent).toBe('');
    await act(async () => host.querySelector('button')?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);
    expect(host.querySelector('button')?.textContent).toBe(SHARE_PROGRESS_CARD);
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
