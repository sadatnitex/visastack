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
const notice = () => container.querySelector('section.pilot-banner');

describe('the notice about this version folds away after the first page', () => {
  it('shows in full on the first page and remembers that it has been seen', () => {
    mount();
    expect(notice()?.textContent).toContain('VisaStack Public Beta');
    expect(written).toEqual(['visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax']);
  });

  it('folds away when the visitor moves to another page in the same visit', () => {
    mount();
    route.pathname = '/trust';
    mount();
    expect(notice()).toBeNull();
  });

  it('Hide This Notice puts it away at once, and remembers that too', () => {
    mount();
    const hide = container.querySelector<HTMLButtonElement>('button.pilot-banner-hide');
    expect(hide?.getAttribute('type')).toBe('button');
    expect(hide?.getAttribute('aria-label')).toBe('Hide This Notice');
    written = [];
    act(() => hide?.click());
    expect(notice()).toBeNull();
    expect(written).toEqual(['visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax']);
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
  it('renders nothing once this device has seen it', () => {
    expect(
      renderToStaticMarkup(<PilotBanner mode="controlled_pilot" registrationOpen seen />),
    ).toBe('');
    expect(renderToStaticMarkup(<PilotBanner mode="development" seen />)).toBe('');
  });

  it('names its icon-only Hide button and passes the automated accessibility rules', async () => {
    const html = renderToStaticMarkup(<PilotBanner mode="controlled_pilot" registrationOpen />);
    expect(html).toContain('aria-label="Hide This Notice"');
    expect(await axeViolations(html)).toEqual([]);
  });
});
