// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_PROGRESS_CARD,
  PROGRESS_CARD_FAILED,
  ProgressCardShare,
  SHARE_PROGRESS_CARD,
  canShareImageFiles,
  progressCardHref,
} from './progress-card-share';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CASE = '11111111-2222-4333-8444-555555555555';
let host: HTMLDivElement;

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
    });
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files[0]?.name).toBe('progress-card.png');
    expect(shared.files[0]?.type).toBe('image/png');
    expect(host.querySelector('output')?.textContent).toBe('');
  });

  it('says so plainly when the card could not be made, and stays quiet when the sheet is closed', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    setShare(share, () => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
    await mount();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toBe(PROGRESS_CARD_FAILED);
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
