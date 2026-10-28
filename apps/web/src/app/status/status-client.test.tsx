// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusClient } from './status-client';

const NOTICE = {
  label: 'VisaStack Public Beta',
  detail: 'Free to use at your own risk.',
  short: 'Free, at your own risk.',
};
const READY = {
  status: 'ready',
  platform: { authentication: 'available', documentUpload: 'available', payments: 'unconfigured' },
};

let root: Root;
let container: HTMLDivElement;
let scrolled: string[];
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      Response.json(path.endsWith('/ready') ? READY : { status: 'ok' }),
    ),
  );
  scrolled = [];
  // The test page has no layout, so it records where the page was asked to scroll to.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

async function mountAndLoad() {
  await act(async () => {
    root.render(<StatusClient versionNotice={NOTICE} />);
  });
  // Let both checks answer and the feature list render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('a link to a place on the status page (footer "About This Version")', () => {
  it('brings the linked place back into view once the feature list has pushed it down', async () => {
    window.history.replaceState(null, '', '/status#about-this-version');
    await mountAndLoad();
    expect(container.querySelector('#about-this-version')).not.toBeNull();
    expect(container.textContent).toContain('You Can Use Now');
    expect(scrolled).toEqual(['about-this-version']);
  });

  it('moves nothing when the page was opened without a place to go to', async () => {
    window.history.replaceState(null, '', '/status');
    await mountAndLoad();
    expect(scrolled).toEqual([]);
  });
});
