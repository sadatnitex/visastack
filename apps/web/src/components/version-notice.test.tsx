// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
const { VersionNotice } = await import('./version-notice');
const { PilotBanner } = await import('./pilot-banner');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COPY = {
  label: 'VisaStack Public Beta',
  detail: 'Free to use at your own risk.',
  short: 'Free, at your own risk.',
} as const;

let root: Root;
let container: HTMLDivElement;
let written: string[];
beforeEach(() => {
  route.pathname = '/';
  written = [];
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
    written.push(value);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const mount = () => act(() => root.render(<VersionNotice copy={COPY} />));
const notice = () => container.querySelector<HTMLElement>('section.pilot-banner');
/** The slim label: the version name and the link, nothing else. */
function expectSlim() {
  const slim = notice();
  expect(slim?.classList.contains('pilot-banner-slim')).toBe(true);
  expect(slim?.getAttribute('aria-label')).toBe('About this version');
  expect(slim?.querySelector('.pilot-banner-label')?.textContent).toBe('VisaStack Public Beta');
  expect(slim?.querySelector('a')?.getAttribute('href')).toBe('/status');
  expect(slim?.querySelector('a')?.textContent).toBe('What Works Today');
  expect(slim?.querySelector('.pilot-banner-detail, .pilot-banner-short, button')).toBeNull();
  expect(slim?.textContent).not.toContain('at your own risk');
}

describe('the notice about this version shows in full once, then as a slim label', () => {
  it('shows in full on the first page and remembers that it has been seen', () => {
    mount();
    expect(notice()?.classList.contains('pilot-banner-slim')).toBe(false);
    expect(notice()?.textContent).toContain('Free, at your own risk.');
    expect(written).toEqual(['visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax']);
  });

  it('folds to the slim label on the next page, and stays folded back on the first page', () => {
    mount();
    route.pathname = '/trust';
    mount();
    expectSlim();
    route.pathname = '/';
    mount();
    expectSlim();
  });

  it('Hide This Notice folds it at once to the label, never removes it, and remembers', () => {
    mount();
    const hide = container.querySelector<HTMLButtonElement>('button.pilot-banner-hide');
    expect(hide?.getAttribute('type')).toBe('button');
    expect(hide?.getAttribute('aria-label')).toBe('Hide This Notice');
    written = [];
    act(() => hide?.click());
    expectSlim();
    expect(written).toEqual(['visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax']);
  });

  it('starts as the slim label when this device has seen it, without writing again', () => {
    act(() => root.render(<VersionNotice copy={COPY} folded />));
    expectSlim();
    expect(written).toEqual([]);
  });

  it('still shows, and nothing breaks, when the cookie store is blocked', () => {
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount();
    expect(notice()).not.toBeNull();
  });
});

describe('the banner the root layout renders', () => {
  it('is the slim label once this device has seen it, in every mode that has a notice', () => {
    for (const html of [
      renderToStaticMarkup(<PilotBanner mode="controlled_pilot" registrationOpen seen />),
      renderToStaticMarkup(<PilotBanner mode="controlled_pilot" seen />),
      renderToStaticMarkup(<PilotBanner mode="development" seen />),
    ]) {
      expect(html).toContain(
        '<section class="pilot-banner pilot-banner-slim" aria-label="About this version">',
      );
      expect(html).toContain('href="/status"');
      expect(html).not.toContain('pilot-banner-hide');
    }
    expect(renderToStaticMarkup(<PilotBanner mode="development" seen />)).toContain(
      'VisaStack Test Build',
    );
    expect(renderToStaticMarkup(<PilotBanner mode="commercial" seen />)).toBe('');
  });

  it('names its icon-only Hide button and passes the automated accessibility rules', async () => {
    const full = renderToStaticMarkup(<PilotBanner mode="controlled_pilot" registrationOpen />);
    expect(full).toContain('aria-label="Hide This Notice"');
    expect(await axeViolations(full)).toEqual([]);
    const slim = renderToStaticMarkup(<PilotBanner mode="controlled_pilot" seen />);
    expect(await axeViolations(slim)).toEqual([]);
  });
});
