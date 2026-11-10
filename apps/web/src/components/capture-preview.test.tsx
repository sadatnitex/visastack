// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapturePreview } from './capture-preview';

let host: HTMLDivElement;
let root: Root;
const made: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  URL.createObjectURL = () => {
    const url = `blob:test/${made.length}`;
    made.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  made.length = 0;
  revoked.length = 0;
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
  it('shows the photo with an outline, moves focus to its heading, and sends nothing by itself', async () => {
    const { onUse, onRetake } = await show();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:test/0');
    expect(document.activeElement).toBe(host.querySelector('h3'));
    expect(host.querySelector('h3')?.textContent).toBe('Check Your Photo');
    expect(onUse).not.toHaveBeenCalled();
    expect(onRetake).not.toHaveBeenCalled();
  });

  it('Use This hands over the very same photo; Retake does not', async () => {
    const { onUse, onRetake } = await show();
    await act(async () => button('Use This')?.click());
    expect(onUse).toHaveBeenCalledWith(photo);
    expect(onRetake).not.toHaveBeenCalled();
    await act(async () => button('Retake')?.click());
    expect(onRetake).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('draws the outline over the photo without ever taking a tap or being read out', async () => {
    await show();
    const outline = host.querySelector('.capture-outline') as HTMLElement;
    expect(outline.getAttribute('aria-hidden')).toBe('true');
    expect(outline.querySelector('button, a, input')).toBeNull();
    const css = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../app/globals.css'),
      'utf8',
    );
    const block = css.slice(
      css.indexOf('.capture-outline {'),
      css.indexOf('}', css.indexOf('.capture-outline {')),
    );
    expect(block).toContain('pointer-events: none');
    expect(block).not.toMatch(/background/);
  });

  it('still lets the person use a photo this device cannot preview', async () => {
    const { onUse } = await show();
    const img = host.querySelector('img') as HTMLImageElement;
    await act(async () => img.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.capture-outline')).toBeNull();
    expect(host.textContent).toContain('cannot show a preview');
    await act(async () => button('Use This')?.click());
    expect(onUse).toHaveBeenCalledWith(photo);
  });

  it('chooses the page outline for a tall photo, and gives the temporary address back', async () => {
    await show();
    const img = host.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 600 });
    Object.defineProperty(img, 'naturalHeight', { value: 900 });
    await act(async () => img.dispatchEvent(new Event('load')));
    expect(host.querySelector('.capture-frame')?.getAttribute('data-shape')).toBe('page');
    await act(async () => root.render(<div />));
    expect(revoked).toContain('blob:test/0');
  });

  it('never promises the photo will be accepted', async () => {
    await show();
    expect(host.textContent).toMatch(/can still be turned away/);
    expect(host.textContent).not.toMatch(/valid|approved|accepted\./i);
  });
});
