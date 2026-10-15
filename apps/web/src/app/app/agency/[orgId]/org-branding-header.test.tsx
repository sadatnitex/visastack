// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { agencyBrand } from '../../../../lib/agency-brand';
import { AgencyBrandScope, AgencyMark } from './org-branding-header';

const LOGO = '/api/branding/logo/00000000-0000-4000-8000-000000000001?v=abc';

async function mount(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return host;
}

describe('AgencyMark', () => {
  it('shows the logo when there is one', async () => {
    const brand = agencyBrand({ name: 'Skyline Visa', accentColor: '#1f4e79', logoUrl: LOGO });
    const host = await mount(<AgencyMark brand={brand} />);
    const image = host.querySelector('img');
    expect(image?.getAttribute('src')).toBe(LOGO);
    expect(image?.getAttribute('alt')).toBe('Skyline Visa logo');
    expect(host.querySelector('[data-kind="logo"]')).not.toBeNull();
  });

  it('shows the initials when there is no logo', async () => {
    const brand = agencyBrand({ name: 'Travel Router', accentColor: null, logoUrl: null });
    const host = await mount(<AgencyMark brand={brand} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('TR');
    expect(host.querySelector('[data-kind="letters"]')).not.toBeNull();
  });

  it('falls back to the initials when the logo cannot be loaded, never a broken picture', async () => {
    const brand = agencyBrand({ name: 'Skyline Visa', accentColor: null, logoUrl: LOGO });
    const host = await mount(<AgencyMark brand={brand} />);
    const image = host.querySelector('img');
    expect(image).not.toBeNull();
    await act(async () => {
      image?.dispatchEvent(new Event('error'));
    });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('SV');
  });
});

describe('AgencyBrandScope', () => {
  it('hands the accent, its readable text colour and a tint to everything inside', async () => {
    const brand = agencyBrand({ name: 'Skyline', accentColor: '#1f4e79', logoUrl: null });
    const host = await mount(
      <AgencyBrandScope brand={brand} className="agency-hero">
        <span>inside</span>
      </AgencyBrandScope>,
    );
    const scope = host.firstElementChild as HTMLElement;
    expect(scope.className).toBe('agency-hero');
    expect(scope.style.getPropertyValue('--agency-accent')).toBe('#1f4e79');
    expect(scope.style.getPropertyValue('--agency-on-accent')).toBe('#ffffff');
    expect(scope.style.getPropertyValue('--agency-tint')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('sets nothing when the agency has no accent, so the product colours apply', async () => {
    const brand = agencyBrand({ name: 'Skyline', accentColor: null, logoUrl: null });
    const host = await mount(
      <AgencyBrandScope brand={brand}>
        <span>inside</span>
      </AgencyBrandScope>,
    );
    expect((host.firstElementChild as HTMLElement).getAttribute('style')).toBeNull();
  });
});
