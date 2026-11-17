// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./profile-photo/photo-canvas', () => ({
  decodePhoto: (file: File) =>
    file.name === 'bad.jpg'
      ? Promise.reject(new Error('no'))
      : Promise.resolve({ source: {}, width: 100, height: 140, close: () => undefined }),
}));
const { CapturePreview } = await import('./capture-preview');

let host: HTMLDivElement;
let root: Root;
const release = vi.fn(async () => undefined);
const request = vi.fn(async () => ({ release }));
const vibrate = vi.fn(() => true);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  request.mockClear();
  release.mockClear();
  vibrate.mockClear();
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => undefined }) as never,
  );
});
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
  Reflect.deleteProperty(navigator, 'vibrate');
});

const photo = (name = 'p.jpg') => new File([new Uint8Array(4)], name, { type: 'image/jpeg' });
const show = (kind: string | undefined, file = photo()) =>
  act(async () =>
    root.render(
      <CapturePreview
        file={file}
        documentKind={kind}
        onUse={() => undefined}
        onRetake={() => undefined}
      />,
    ),
  );

describe('photo check toolbox', () => {
  it('keeps the screen awake while the passport outline is open and lets go on close', async () => {
    await show('PASSPORT');
    expect(request).toHaveBeenCalledWith('screen');
    await act(async () => root.unmount());
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('asks for no wake lock when it is not a passport', async () => {
    await show('VISA');
    expect(request).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it('taps once when the photo is ready', async () => {
    await show('PASSPORT');
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
  it('taps once for the same photo even when the preview draws again', async () => {
    const same = photo();
    await show('PASSPORT', same);
    await show('PASSPORT', same);
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
  it('does not tap for a replacement photo that turns out unreadable', async () => {
    await show('PASSPORT', photo('good.jpg'));
    expect(vibrate).toHaveBeenCalledTimes(1);
    await show('PASSPORT', photo('bad.jpg'));
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
  it('never taps for a photo that cannot be shown', async () => {
    await show('PASSPORT', photo('bad.jpg'));
    expect(vibrate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
