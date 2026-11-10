// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const decode = vi.hoisted(() => ({
  next: null as null | (() => Promise<unknown>),
  closed: 0,
}));
vi.mock('./profile-photo/photo-canvas', () => ({
  decodePhoto: () => (decode.next ? decode.next() : Promise.reject(new Error('no decoder'))),
}));
const { CapturePreview } = await import('./capture-preview');

let host: HTMLDivElement;
let root: Root;
const drawn: Array<[number, number]> = [];

function readyPhoto(width: number, height: number) {
  decode.next = async () => ({
    source: {},
    width,
    height,
    close: () => {
      decode.closed += 1;
    },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  decode.closed = 0;
  drawn.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: (_s: unknown, _x: number, _y: number, w: number, h: number) =>
          drawn.push([w, h]),
      }) as never,
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const photo = new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' });
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label);

async function show(onUse = vi.fn(), onRetake = vi.fn()) {
  await act(async () =>
    root.render(<CapturePreview file={photo} onUse={onUse} onRetake={onRetake} />),
  );
  return { onUse, onRetake };
}

describe('CapturePreview', () => {
  it('draws the photo on a canvas, never as an image address the page policy would refuse', async () => {
    readyPhoto(1600, 1000);
    await show();
    expect(host.querySelector('img')).toBeNull();
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toMatch(/Preview of what you just captured/);
    // Cut to 1280 on its longest side, in proportion.
    expect(drawn).toEqual([[1280, 800]]);
    expect(host.querySelector('.capture-frame')?.getAttribute('data-shape')).toBe('card');
  });

  it('moves focus to its heading and sends nothing by itself', async () => {
    readyPhoto(800, 600);
    const { onUse, onRetake } = await show();
    expect(document.activeElement).toBe(host.querySelector('h3'));
    expect(host.querySelector('h3')?.textContent).toBe('Check Your Photo');
    expect(onUse).not.toHaveBeenCalled();
    expect(onRetake).not.toHaveBeenCalled();
  });

  it('Use This hands over the very same photo; Retake does not', async () => {
    readyPhoto(800, 600);
    const { onUse, onRetake } = await show();
    await act(async () => button('Use This')?.click());
    expect(onUse).toHaveBeenCalledWith(photo);
    expect(onRetake).not.toHaveBeenCalled();
    await act(async () => button('Retake')?.click());
    expect(onRetake).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('draws the outline over the photo without ever taking a tap or being read out', async () => {
    readyPhoto(800, 600);
    await show();
    const outline = host.querySelector('.capture-outline') as HTMLElement;
    expect(outline.getAttribute('aria-hidden')).toBe('true');
    expect(outline.querySelector('button, a, input')).toBeNull();
    const fs = await import('node:fs');
    const css = fs.readFileSync(
      (await import('node:path')).resolve(__dirname, '../app/globals.css'),
      'utf8',
    );
    const start = css.indexOf('.capture-outline {');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('pointer-events: none');
    expect(block).not.toMatch(/background/);
  });

  it('chooses the page outline for a tall photo, and lets go of the decoded photo', async () => {
    readyPhoto(600, 900);
    await show();
    expect(host.querySelector('.capture-frame')?.getAttribute('data-shape')).toBe('page');
    expect(decode.closed).toBeGreaterThan(0);
  });

  it('still lets the person use a photo this device cannot decode, and says so instead of showing an outline', async () => {
    decode.next = null;
    const { onUse } = await show();
    expect(host.querySelector('.capture-frame')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('.capture-outline')).toBeNull();
    expect(host.querySelector('.capture-hint')?.textContent).toMatch(/cannot show the photo here/);
    expect(host.querySelector('.capture-hint')?.textContent).not.toMatch(/outline/);
    await act(async () => button('Use This')?.click());
    expect(onUse).toHaveBeenCalledWith(photo);
  });

  it('never promises the photo will be accepted', async () => {
    readyPhoto(800, 600);
    await show();
    expect(host.textContent).toMatch(/can still be turned away/);
    expect(host.textContent).not.toMatch(/valid|approved|accepted\./i);
  });

  it('never shows the photo through an image address, which the page security policy refuses', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      (await import('node:path')).resolve(__dirname, 'capture-preview.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/createObjectURL|<img\b|data:image/);
  });
});
