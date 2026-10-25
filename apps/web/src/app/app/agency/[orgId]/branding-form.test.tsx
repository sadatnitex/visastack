// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { contrast } from '../../../../lib/agency-brand';

vi.mock('./actions', () => ({
  updateBrandingAction: vi.fn(),
  uploadLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
}));

const { ACCENT_PRESETS, BrandingForm } = await import('./branding-form');

const LOGO = '/api/branding/logo/00000000-0000-4000-8000-000000000001?v=abc';

async function mount(props: { accentColor: string | null; logoUrl: string | null }) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<BrandingForm organizationId="o1" name="Skyline Visa" {...props} />),
  );
  return host;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ready-made accents', () => {
  it('are all easy to read on white', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(contrast(preset.hex, '#ffffff'), preset.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('BrandingForm', () => {
  it('previews the agency with its initials when there is no logo', async () => {
    const host = await mount({ accentColor: null, logoUrl: null });
    const preview = host.querySelector('.brand-preview') as HTMLElement;
    expect(preview.textContent).toContain('Skyline Visa');
    expect(preview.textContent).toContain('SV');
    expect(preview.textContent).toContain('Powered by VisaStack');
    expect(host.querySelector('.brand-logo')?.textContent).toContain('No logo yet');
  });

  it('shows the uploaded logo in the preview and offers to remove it', async () => {
    const host = await mount({ accentColor: '#1f4e79', logoUrl: LOGO });
    expect(host.querySelector('.brand-preview img')?.getAttribute('src')).toBe(LOGO);
    expect(host.textContent).toContain('Remove Logo');
    expect(host.textContent).toContain('Replace');
  });

  it('picking a ready-made colour fills the code and updates the preview', async () => {
    const host = await mount({ accentColor: null, logoUrl: null });
    const plum = host.querySelector<HTMLButtonElement>('button[data-hex="#7a2f6b"]');
    await act(async () => plum?.click());
    const code = host.querySelector<HTMLInputElement>('input[name="accentColor"]');
    expect(code?.value).toBe('#7a2f6b');
    expect(plum?.getAttribute('aria-pressed')).toBe('true');
    const scope = host.querySelector<HTMLElement>('.agency-hero-preview');
    expect(scope?.style.getPropertyValue('--agency-accent')).toBe('#7a2f6b');
  });

  it('says in words when a typed colour is too light to read, and when it is fine', async () => {
    const host = await mount({ accentColor: null, logoUrl: null });
    const code = host.querySelector<HTMLInputElement>('input[name="accentColor"]');
    await act(async () => type(code as HTMLInputElement, '#ffee99'));
    expect(host.querySelector('output')?.textContent).toContain('Too light to read');
    await act(async () => type(code as HTMLInputElement, '#1f4e79'));
    expect(host.querySelector('output')?.textContent).toContain('Readable on white');
  });

  it('follows the name as it is typed', async () => {
    const host = await mount({ accentColor: null, logoUrl: null });
    const name = host.querySelector<HTMLInputElement>('#brand-name');
    await act(async () => type(name as HTMLInputElement, 'Blue Harbour Travel'));
    expect(host.querySelector('.agency-preview-name')?.textContent).toBe('Blue Harbour Travel');
    expect(host.querySelector('.brand-preview')?.textContent).toContain('BH');
  });
});
