// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  decode: vi.fn(),
  draw: vi.fn(),
  exportJpeg: vi.fn(),
}));
vi.mock('../../app/app/profile-photo-actions', () => ({
  saveProfilePhotoAction: mocks.save,
  removeProfilePhotoAction: mocks.remove,
}));
vi.mock('./photo-canvas', () => ({
  decodePhoto: mocks.decode,
  drawPreview: mocks.draw,
  exportSquareJpeg: mocks.exportJpeg,
}));

const { ProfilePhotoControl, MAX_ORIGINAL_BYTES, MAX_PHOTO_BYTES } = await import(
  './profile-photo-control'
);

const APPLICANT = '11111111-2222-4333-8444-555555555555';
const PHOTO = `/api/photos/applicant/${APPLICANT}?v=aaaa`;
const NEW_PHOTO = `/api/photos/applicant/${APPLICANT}?v=bbbb`;

let root: Root | undefined;
let host: HTMLElement;

async function mount(photoUrl: string | null) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <ProfilePhotoControl
        applicantId={APPLICANT}
        initials="RA"
        photoUrl={photoUrl}
        avatarClassName="profile-identity-avatar"
      />,
    ),
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

const hasButton = (name: string) =>
  [...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === name);

async function choose(file: File) {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

const jpeg = (size = 1000) => new File([new Uint8Array(size)], 'me.jpg', { type: 'image/jpeg' });

async function key(target: Element, keyName: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
  });
}

const lastCrop = () => mocks.draw.mock.calls.at(-1)?.[2] as { x: number; zoom: number };
const status = () => host.querySelector('output.field-msg')?.textContent ?? '';
const position = () => host.querySelector('output.profile-photo-position')?.textContent ?? '';
const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decode.mockResolvedValue({ source: {}, width: 1200, height: 800, close: vi.fn() });
  mocks.exportJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
});

describe('ProfilePhotoControl', () => {
  it('shows initials and an Add Photo button when there is no photo', async () => {
    await mount(null);
    const avatar = host.querySelector('.profile-identity-avatar') as HTMLElement;
    expect(avatar.textContent).toBe('RA');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.querySelector('img')).toBeNull();
    expect(hasButton('Add Photo')).toBe(true);
    expect(hasButton('Remove Photo')).toBe(false);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('image/heic');
    expect(input.tabIndex).toBe(-1);
  });

  it('shows the photo, offers Replace and Remove, and falls back to initials if it cannot load', async () => {
    await mount(PHOTO);
    const img = host.querySelector('.profile-identity-avatar img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PHOTO);
    expect(img.getAttribute('alt')).toBe('');
    expect(hasButton('Replace Photo')).toBe(true);
    expect(hasButton('Remove Photo')).toBe(true);
    await act(async () => {
      img.dispatchEvent(new Event('error'));
    });
    expect(host.querySelector('.profile-identity-avatar')?.textContent).toBe('RA');
  });

  it('opens a large phone photo for cropping, and refuses one over 40 MB at once', async () => {
    await mount(null);
    await choose(jpeg(MAX_PHOTO_BYTES * 3));
    expect(mocks.decode).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.profile-photo-crop')).not.toBeNull();
    await key(button('Photo Position'), 'Escape');
    await choose(jpeg(MAX_ORIGINAL_BYTES + 1));
    expect(mocks.decode).toHaveBeenCalledTimes(1);
    expect(alertText()).toBe('Choose a photo smaller than 40 MB.');
  });

  it('refuses to send a cropped photo over 5 MB', async () => {
    mocks.exportJpeg.mockResolvedValue(new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]));
    await mount(null);
    await choose(jpeg());
    await act(async () => {
      button('Save Photo').click();
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(alertText()).toContain('larger than 5 MB');
    expect(hasButton('Save Photo')).toBe(true);
  });

  it('says so plainly when the browser cannot open the photo', async () => {
    mocks.decode.mockRejectedValue(new Error('cannot decode'));
    await mount(null);
    await choose(new File([new Uint8Array(10)], 'IMG_0001.HEIC', { type: 'image/heic' }));
    expect(alertText()).toContain('cannot be opened in this browser');
    expect(host.querySelector('.profile-photo-crop')).toBeNull();
  });

  it('opens a labelled crop step that moves and zooms with the keyboard, and Escape cancels it', async () => {
    await mount(null);
    await choose(jpeg());
    const section = host.querySelector('.profile-photo-crop') as HTMLElement;
    const heading = section.querySelector('h3') as HTMLElement;
    expect(heading.textContent).toBe('Crop Your Photo');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    const area = button('Photo Position');
    expect(document.activeElement).toBe(area);
    const help = document.getElementById(area.getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toContain('arrow keys');
    const zoom = section.querySelector('input[type="range"]') as HTMLInputElement;
    expect(section.querySelector(`label[for="${zoom.id}"]`)?.textContent).toBe('Zoom');

    expect(lastCrop()).toMatchObject({ x: -60, zoom: 1 });
    expect(position()).toBe('Showing 50% from the left and the full height, zoom 1.0 times.');
    await key(area, 'ArrowLeft');
    expect(lastCrop().x).toBe(-72);
    await key(area, 'ArrowRight');
    await key(area, 'ArrowRight');
    expect(lastCrop().x).toBe(-48);
    expect(position()).toBe('Showing 40% from the left and the full height, zoom 1.0 times.');
    await key(area, '+');
    expect(lastCrop().zoom).toBeCloseTo(1.1);
    await key(area, '-');
    expect(lastCrop().zoom).toBeCloseTo(1);

    await key(area, 'Escape');
    expect(host.querySelector('.profile-photo-crop')).toBeNull();
    expect(document.activeElement).toBe(button('Add Photo'));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('offers visible move buttons that move the photo and say where it is', async () => {
    await mount(null);
    await choose(jpeg());
    await act(async () => {
      button('Move Left').click();
    });
    expect(lastCrop().x).toBe(-84);
    await act(async () => {
      button('Move Right').click();
      button('Move Right').click();
    });
    await act(async () => {
      button('Move Right').click();
    });
    expect(lastCrop().x).toBe(-12);
    expect(position()).toBe('Showing 10% from the left and the full height, zoom 1.0 times.');
    for (const name of ['Move Up', 'Move Down']) {
      expect(button(name).getAttribute('type')).toBe('button');
    }
  });

  it('saves the cropped square JPEG, announces progress and success, and shows the new photo', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount(null);
    await choose(jpeg());
    await act(async () => {
      button('Save Photo').click();
    });
    expect(status()).toBe('Saving your photo.');
    expect(button('Saving Photo').getAttribute('aria-disabled')).toBe('true');
    const form = mocks.save.mock.calls[0]?.[0] as FormData;
    expect(form.get('applicantId')).toBe(APPLICANT);
    const sent = form.get('photo') as File;
    expect(sent.type).toBe('image/jpeg');
    expect(mocks.exportJpeg).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true, message: 'Photo saved.', photoUrl: NEW_PHOTO }));
    expect(status()).toBe('Photo saved.');
    expect(host.querySelector('.profile-photo-crop')).toBeNull();
    expect(host.querySelector('.profile-identity-avatar img')?.getAttribute('src')).toBe(NEW_PHOTO);
    expect(document.activeElement).toBe(button('Replace Photo'));
  });

  it('keeps the crop step open and reads out the reason when the server refuses the photo', async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: 'This photo did not pass the safety check.',
    });
    await mount(null);
    await choose(jpeg());
    await act(async () => {
      button('Save Photo').click();
    });
    expect(alertText()).toBe('This photo did not pass the safety check.');
    expect(host.querySelector('.profile-photo-crop')).not.toBeNull();
    expect(hasButton('Save Photo')).toBe(true);
  });

  it('removes the photo and shows the initials again', async () => {
    mocks.remove.mockResolvedValue({ ok: true, message: 'Photo removed.', photoUrl: null });
    await mount(PHOTO);
    await act(async () => {
      button('Remove Photo').click();
    });
    expect((mocks.remove.mock.calls[0]?.[0] as FormData).get('applicantId')).toBe(APPLICANT);
    expect(status()).toBe('Photo removed.');
    expect(host.querySelector('.profile-identity-avatar img')).toBeNull();
    expect(host.querySelector('.profile-identity-avatar')?.textContent).toBe('RA');
    expect(hasButton('Add Photo')).toBe(true);
  });
});
