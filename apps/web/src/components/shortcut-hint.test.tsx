// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHint, isApplePlatform, shortcutLabel } from './shortcut-hint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMMAND = String.fromCodePoint(0x2318);

describe('which keyboard the shortcut is written for', () => {
  it.each([
    [{ userAgentData: { platform: 'macOS' } }, true],
    [{ platform: 'MacIntel' }, true],
    [{ platform: 'iPhone' }, true],
    [{ platform: 'iPad' }, true],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }, true],
    [{ userAgentData: { platform: 'Windows' }, platform: 'Win32' }, false],
    [{ platform: 'Win32' }, false],
    [{ platform: 'Linux x86_64' }, false],
    [{ userAgentData: { platform: 'Chrome OS' } }, false],
    [{ userAgentData: { platform: 'Android' } }, false],
    [{}, false],
  ])('%j is Apple: %s', (hints, apple) => {
    expect(isApplePlatform(hints)).toBe(apple);
  });

  it('writes Ctrl on Windows and Linux, and the Command symbol only on Apple devices', () => {
    expect(shortcutLabel(false, 'K')).toBe('Ctrl K');
    expect(shortcutLabel(true, 'K')).toBe(`${COMMAND} K`);
  });
});

describe('the hint beside a search box', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('names no key on the server, where the device is unknown, and keeps its space', () => {
    const html = renderToString(<ShortcutHint keyName="K" />);
    expect(html).toContain('class="shortcut-hint-pending"');
    expect(html).not.toContain(COMMAND);
  });

  it.each([
    ['Win32', 'Ctrl K'],
    ['Linux x86_64', 'Ctrl K'],
    ['MacIntel', `${COMMAND} K`],
  ])(
    'on %s it shows %s once the page is running, with no hydration mismatch',
    (platform, shown) => {
      vi.stubGlobal('navigator', { platform, userAgent: '' });
      const container = document.createElement('div');
      container.innerHTML = renderToString(<ShortcutHint keyName="K" className="finder-key" />);
      document.body.append(container);
      const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const recoverable: unknown[] = [];
      act(() => {
        hydrateRoot(container, <ShortcutHint keyName="K" className="finder-key" />, {
          onRecoverableError: (error) => recoverable.push(error),
        });
      });
      const kbd = container.querySelector('kbd');
      expect(kbd?.textContent).toBe(shown);
      expect((kbd as HTMLElement | null)?.style.visibility).toBe('');
      expect(kbd?.className).toBe('finder-key');
      expect(recoverable).toEqual([]);
      expect(problems).not.toHaveBeenCalled();
      problems.mockRestore();
    },
  );
});

describe('the search boxes in the workspace', () => {
  it('use the hint instead of a Command symbol written into the page', () => {
    for (const file of ['workspace-record-toolbar.tsx', 'app-nav.tsx']) {
      const source = readFileSync(join(__dirname, '..', 'app', 'app', file), 'utf8');
      expect(source, file).toContain('<ShortcutHint keyName="K"');
      expect(source, file).not.toContain(COMMAND);
    }
  });
});
