// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./profile-photo/photo-canvas', () => ({
  decodePhoto: async () => ({ source: {}, width: 900, height: 1200, close: () => undefined }),
}));
const { CapturePreview } = await import('./capture-preview');
const { CaptureFrameGuide, isPassportKind, CAPTURE_GUIDE_HINT } = await import(
  './capture-frame-guide'
);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => undefined }) as never,
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const photo = new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' });
async function show(documentKind?: string) {
  const onUse = vi.fn();
  const onRetake = vi.fn();
  await act(async () =>
    root.render(
      <CapturePreview
        file={photo}
        onUse={onUse}
        onRetake={onRetake}
        {...(documentKind === undefined ? {} : { documentKind })}
      />,
    ),
  );
  return { onUse, onRetake };
}

describe('isPassportKind', () => {
  it('is true only for the passport kind', () => {
    expect(isPassportKind('passport')).toBe(true);
    expect(isPassportKind('PASSPORT')).toBe(true);
    for (const kind of [
      'SPOUSE_PASSPORT',
      'PARTNER_PASSPORT',
      'HOST_PASSPORT',
      'SPONSOR_PASSPORT',
    ]) {
      expect(isPassportKind(kind), kind).toBe(true);
    }
    expect(isPassportKind('nid')).toBe(false);
    expect(isPassportKind('NATIONAL_ID')).toBe(false);
    expect(isPassportKind('NOT_A_REAL_KIND')).toBe(false);
    expect(isPassportKind('')).toBe(false);
    expect(isPassportKind(undefined)).toBe(false);
  });
});

describe('CaptureFrameGuide', () => {
  it('draws a passport outline with four corner marks that ignores taps and hides from readers', async () => {
    await act(async () => root.render(<CaptureFrameGuide />));
    const guide = host.querySelector('[data-capture-guide="passport"]') as HTMLElement;
    expect(guide).not.toBeNull();
    expect(guide.getAttribute('aria-hidden')).toBe('true');
    expect(guide.querySelectorAll('.capture-guide-corner')).toHaveLength(8);
    expect(guide.querySelector('img, svg image')).toBeNull();
    expect(host.innerHTML).not.toMatch(/data:|blob:/);
  });
  it('has the one-line hint', () => {
    expect(CAPTURE_GUIDE_HINT).toBe('Fit the passport inside the lines');
  });
});

describe('CapturePreview with a passport', () => {
  it('shows the passport guide and hint instead of the plain outline', async () => {
    await show('PASSPORT');
    expect(host.querySelector('[data-capture-guide="passport"]')).not.toBeNull();
    expect(host.querySelector('.capture-outline')).toBeNull();
    expect(host.textContent).toContain('Fit the passport inside the lines');
    expect(host.querySelector('.capture-guide-hint')?.getAttribute('aria-hidden')).toBeNull();
    expect(host.querySelector('.capture-guide-hint')?.getAttribute('lang')).toBe('en');
  });
  it('keeps Use This and Retake exactly as before', async () => {
    const { onUse, onRetake } = await show('passport');
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Use This', 'Retake']);
    act(() => buttons[0]?.click());
    expect(onUse).toHaveBeenCalledWith(photo);
    act(() => buttons[1]?.click());
    expect(onRetake).toHaveBeenCalled();
  });
  it("keeps today's frame for other kinds and for no kind", async () => {
    await show('nid');
    expect(host.querySelector('.capture-outline')).not.toBeNull();
    expect(host.querySelector('[data-capture-guide]')).toBeNull();
    expect(host.textContent).not.toContain('Fit the passport');
    await show();
    expect(host.querySelector('.capture-outline')).not.toBeNull();
  });
});
