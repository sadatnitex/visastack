// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { type Root, createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { CountryFlag } from '../country-flag';
import { AVAILABLE_FLAG_CODES } from './available-flags';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Vitest runs from apps/web.
const flagsDir = join(process.cwd(), 'public', 'flags');
const countryCodes = (
  JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'packages',
        'core',
        'src',
        'destinations',
        'country-codes.json',
      ),
      'utf8',
    ),
  ) as { codes: [string, string][] }
).codes.map(([iso2]) => iso2.toLowerCase());

/**
 * Codes that are allowed to have no flag file. Empty on purpose: every place with an ISO code has
 * a flag. Add a code here, with the reason beside it, only if a flag file is deliberately not
 * shipped for it (it then shows the emoji, the letters badge or the globe like before).
 */
const NO_FLAG_FILE_ON_PURPOSE: readonly string[] = [];

const jp = String.fromCodePoint(0x1f1ef, 0x1f1f5);

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe('the flag files', () => {
  const files = readdirSync(flagsDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort();

  it('has a file for every country code, or the code is on the explicit exception list', () => {
    const missing = countryCodes.filter(
      (c) => !files.includes(c) && !NO_FLAG_FILE_ON_PURPOSE.includes(c),
    );
    expect(missing).toEqual([]);
  });

  it('lists exactly the files that exist', () => {
    expect([...AVAILABLE_FLAG_CODES].sort()).toEqual(files);
  });

  it('keeps the licence beside the pictures', () => {
    expect(readFileSync(join(flagsDir, 'LICENSE'), 'utf8')).toContain('MIT License');
  });

  it('holds only plain pictures: no script, no embedded data address, no em dash', () => {
    const emDash = String.fromCodePoint(0x2014);
    for (const f of files) {
      const text = readFileSync(join(flagsDir, `${f}.svg`), 'utf8');
      expect(text, f).not.toMatch(/<script|data:|javascript:/i);
      expect(text, f).not.toContain(emDash);
    }
  });
});

describe('CountryFlag with a picture', () => {
  it('draws the same-origin flag picture, named by the country, over the emoji', () => {
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="JP" name="Japan" />));
    const flag = container.querySelector('.country-flag');
    const img = flag?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/flags/jp.svg');
    expect(img?.getAttribute('alt')).toBe('');
    expect(flag?.getAttribute('role')).toBe('img');
    expect(flag?.getAttribute('aria-label')).toBe('Japan');
    expect(flag?.textContent).toBe(jp);
  });

  it('is hidden from a screen reader when decorative or nameless', () => {
    root = createRoot(container);
    act(() =>
      root?.render(
        <div>
          <CountryFlag iso2="JP" name="Japan" decorative />
          <CountryFlag iso2="BD" />
        </div>,
      ),
    );
    for (const flag of container.querySelectorAll('.country-flag')) {
      expect(flag.getAttribute('aria-hidden')).toBe('true');
      expect(flag.getAttribute('aria-label')).toBeNull();
      expect(flag.querySelector('img')).not.toBeNull();
    }
  });

  it('never writes a data: or blob: address into the markup', () => {
    const html = renderToString(
      <div>
        <CountryFlag iso2="BD" name="Bangladesh" />
        <CountryFlag iso2="jp" name="Japan" size="lg" />
        <CountryFlag iso2="??" name="Somewhere" />
      </div>,
    );
    expect(html).toContain('src="/flags/bd.svg"');
    expect(html).not.toMatch(/(data|blob):/);
  });

  it('draws the plain globe for a bad code, with no picture', () => {
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="Narnia" name="Somewhere" />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.classList.contains('country-flag-unknown')).toBe(true);
    expect(flag?.querySelector('img')).toBeNull();
    expect(flag?.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the emoji when the picture fails to load', () => {
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="JP" name="Japan" />));
    const img = container.querySelector('.country-flag img');
    expect(img).not.toBeNull();
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    const flag = container.querySelector('.country-flag');
    expect(flag?.querySelector('img')).toBeNull();
    expect(flag?.getAttribute('data-flag-kind')).toBe('emoji');
    expect(flag?.textContent).toBe(jp);
    expect(flag?.getAttribute('aria-label')).toBe('Japan');
  });

  it('keeps the letters badge under the picture on a Windows desktop', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="JP" name="Japan" />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.getAttribute('data-flag-kind')).toBe('letters');
    expect(flag?.textContent).toBe('JP');
    expect(flag?.querySelector('img')?.getAttribute('src')).toBe('/flags/jp.svg');
  });

  it('matches the server markup when it starts in the browser (no mismatch)', () => {
    const html = renderToString(<CountryFlag iso2="BD" name="Bangladesh" />);
    container.innerHTML = html;
    const problems: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <CountryFlag iso2="BD" name="Bangladesh" />, {
        onRecoverableError: (error) => problems.push(error),
      });
    });
    expect(problems).toEqual([]);
    expect(container.querySelector('.country-flag img')?.getAttribute('src')).toBe('/flags/bd.svg');
  });

  it('has no accessibility violations', async () => {
    root = createRoot(container);
    act(() =>
      root?.render(
        <div>
          <CountryFlag iso2="JP" name="Japan" />
          <CountryFlag iso2="JP" name="Japan" decorative size="lg" />
        </div>,
      ),
    );
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
