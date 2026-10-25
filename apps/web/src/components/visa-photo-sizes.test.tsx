// @vitest-environment jsdom
import { PHOTO_SPECS } from '@visastack/core/photo-specs';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTitleCase } from '../lib/title-case';
import { VisaPhotoSizes, describeCrop, formatCheckedOn } from './visa-photo-sizes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const documentId = '00000000-0000-4000-8000-000000000001';
const checkBody = {
  sourceWidth: 1200,
  sourceHeight: 1500,
  findings: [{ id: 'too_dark', title: 'Too dark', detail: 'Take the photo again in even light.' }],
  preview: { width: 384, height: 480, jpegBase64: 'AQID' },
};

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mount(props: Partial<Parameters<typeof VisaPhotoSizes>[0]> = {}) {
  await act(async () => {
    root.render(
      <VisaPhotoSizes documentId={documentId} returnTo="/app/applicant/a/documents" {...props} />,
    );
  });
}

/** Opens the disclosure, the only thing that starts the photo check. */
async function open() {
  const details = container.querySelector('details');
  if (!details) throw new Error('missing disclosure');
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function render(props: Partial<Parameters<typeof VisaPhotoSizes>[0]> = {}) {
  await mount(props);
  await open();
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`missing button ${name}`);
  return found;
}

function liveText(): string {
  return [...container.querySelectorAll('output')].map((o) => o.textContent).join(' | ');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn(async () => jsonResponse(checkBody));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Visa Photo Sizes section', () => {
  it('checks nothing until the person opens the section, and checks once', async () => {
    await mount();
    expect(container.querySelector('summary')?.textContent).toBe('Visa Photo Sizes');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await open();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const details = container.querySelector('details');
    if (!details) throw new Error('details');
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the checks in plain words, never claiming acceptance', async () => {
    await render();
    expect(container.textContent).toContain('Too dark');
    expect(container.textContent).toContain('cannot tell you whether the photo will be accepted');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/documents/photo-check');
    expect(JSON.parse(String(init.body))).toEqual({
      documentId,
      returnTo: '/app/applicant/a/documents',
    });
  });

  it('names every control in Title Case and labels the size list', async () => {
    await render();
    for (const name of [
      'Move Up',
      'Move Down',
      'Move Left',
      'Move Right',
      'Zoom In',
      'Zoom Out',
      'Reset Crop',
      'Download This Size',
    ]) {
      expect(isTitleCase(name), name).toBe(true);
      expect(button(name).type).toBe('button');
    }
    const select = container.querySelector('select');
    const label = container.querySelector(`label[for="${select?.id}"]`);
    expect(label?.textContent).toBe('Photo Size');
    expect(select?.options.length).toBe(PHOTO_SPECS.length);
    expect(container.querySelector('legend')?.textContent).toBe('Move and Zoom');
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('35 x 45 mm');
  });

  it('moves and zooms with ordinary buttons and says where the crop is', async () => {
    await render();
    expect(liveText()).toContain('Zoom 1.0 times. Centred.');
    expect(button('Zoom Out').disabled).toBe(true);
    await act(async () => {
      button('Zoom In').click();
      button('Zoom In').click();
      button('Move Up').click();
      button('Move Left').click();
    });
    expect(liveText()).toContain('Zoom 1.2 times. Moved 10% left. Moved 10% up.');
    // A button is reachable and works from the keyboard like any button.
    const reset = button('Reset Crop');
    reset.focus();
    expect(document.activeElement).toBe(reset);
    await act(async () => {
      reset.click();
    });
    expect(liveText()).toContain('Centred.');
  });

  it('shows the published source, checked date and the reminder under the button', async () => {
    await render();
    const spec = PHOTO_SPECS[0];
    if (!spec) throw new Error('spec');
    const source = container.querySelector('.visa-photo-source')?.textContent ?? '';
    expect(source).toContain(
      `Sized to the published rule (checked ${formatCheckedOn(spec.checkedOn)}, ${spec.sourceTitle}). Check the current rule before submitting.`,
    );
    const link = container.querySelector<HTMLAnchorElement>('.visa-photo-source a');
    expect(link?.href).toBe(spec.sourceUrl);
    expect(link?.rel).toContain('noopener');
  });

  it('downloads the chosen size with the crop, and passes the agency relationship', async () => {
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const created = vi.fn(() => 'blob:photo');
    const revoked = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }),
    );
    await render({ actingFor: 'individual' });
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0xff, 0xd8]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'x-photo-size-within-limits': 'yes' },
      }),
    );
    const select = container.querySelector('select');
    if (!select) throw new Error('select');
    await act(async () => {
      select.value = 'us-2x2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      button('Zoom In').click();
    });
    await act(async () => {
      button('Download This Size').click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/documents/photo-size');
    expect(JSON.parse(String(init.body))).toEqual({
      documentId,
      returnTo: '/app/applicant/a/documents',
      actingFor: 'individual',
      specId: 'us-2x2',
      offsetX: 0,
      offsetY: 0,
      zoom: 1.1,
    });
    expect(created).toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledWith('blob:photo');
    clicked.mockRestore();
    expect(liveText()).toContain('Downloaded United States, 2 x 2 inches.');
  });

  it('offers identity confirmation when the server asks for it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: 'Confirm it is you to use this photo.', reauthUrl: '/auth/reauth' },
        401,
      ),
    );
    await render();
    const link = container.querySelector<HTMLAnchorElement>('[role="alert"] a');
    expect(link?.textContent).toBe('Confirm It Is You');
    expect(link?.getAttribute('href')).toBe('/auth/reauth');
  });
});

describe('wording helpers', () => {
  it('formats the checked date the same everywhere', () => {
    expect(formatCheckedOn('2026-10-25')).toBe('25 Oct 2026');
    expect(formatCheckedOn('nonsense')).toBe('nonsense');
  });

  it('describes the crop in plain words', () => {
    expect(describeCrop({ offsetX: 0.3, offsetY: 0.5, zoom: 2 })).toBe(
      'Zoom 2.0 times. Moved 30% right. Moved 50% down.',
    );
  });
});
