// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { CountryFlag, flagEmoji, flagLetters, platformLacksFlagEmoji } from './country-flag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Two regional indicator letters, built from code points. */
const bd = String.fromCodePoint(0x1f1e7, 0x1f1e9);
const jp = String.fromCodePoint(0x1f1ef, 0x1f1f5);

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

function stubNavigator(value: { userAgent: string; userAgentData?: { platform: string } }) {
  vi.stubGlobal('navigator', value);
}

describe('the flag code', () => {
  it('turns two letters into the flag emoji, in any case', () => {
    expect(flagEmoji('BD')).toBe(bd);
    expect(flagEmoji('jp')).toBe(jp);
    expect(flagEmoji(' jp ')).toBe(jp);
  });

  it('gives nothing for anything that is not two letters', () => {
    for (const bad of ['', 'B', 'BDX', '12', 'B1', null, undefined]) {
      expect(flagEmoji(bad)).toBeNull();
      expect(flagLetters(bad)).toBeNull();
    }
  });

  it('shows the letters in capitals for a plain badge', () => {
    expect(flagLetters('jp')).toBe('JP');
  });

  it('knows a Windows desktop from its platform or its browser string', () => {
    expect(platformLacksFlagEmoji({ platform: 'Windows' })).toBe(true);
    expect(platformLacksFlagEmoji({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(
      true,
    );
    expect(platformLacksFlagEmoji({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })).toBe(
      false,
    );
    expect(platformLacksFlagEmoji({ platform: 'Android', userAgent: 'Linux; Android 14' })).toBe(
      false,
    );
    expect(platformLacksFlagEmoji({})).toBe(false);
  });
});

describe('CountryFlag', () => {
  it('draws the emoji with the country name as its accessible name', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)' });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="JP" name="Japan" />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.getAttribute('role')).toBe('img');
    expect(flag?.getAttribute('aria-label')).toBe('Japan');
    expect(flag?.getAttribute('data-flag-kind')).toBe('emoji');
    expect(flag?.textContent).toBe(jp);
  });

  it('is hidden from a screen reader when the name is written beside it', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)' });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="JP" name="Japan" decorative />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.getAttribute('aria-hidden')).toBe('true');
    expect(flag?.getAttribute('role')).toBeNull();
    expect(flag?.getAttribute('aria-label')).toBeNull();
  });

  it('shows the letters on a plain round badge on a Windows desktop, keeping the name', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      userAgentData: { platform: 'Windows' },
    });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="jp" name="Japan" />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.getAttribute('data-flag-kind')).toBe('letters');
    expect(flag?.textContent).toBe('JP');
    expect(flag?.getAttribute('aria-label')).toBe('Japan');
  });

  it('matches the server markup on a Windows desktop (no mismatch), then switches to the letters', () => {
    const html = renderToString(<CountryFlag iso2="BD" name="Bangladesh" />);
    expect(html).toContain(bd);
    stubNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    container.innerHTML = html;
    const problems: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <CountryFlag iso2="BD" name="Bangladesh" />, {
        onRecoverableError: (error) => problems.push(error),
      });
    });
    expect(problems).toEqual([]);
    expect(container.querySelector('.country-flag')?.getAttribute('data-flag-kind')).toBe(
      'letters',
    );
  });

  it('draws a plain globe for a code that is not a country code, named when it has a name', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)' });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2="Narnia" name="Somewhere" />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.classList.contains('country-flag-unknown')).toBe(true);
    expect(flag?.getAttribute('aria-label')).toBe('Somewhere');
    expect(flag?.querySelector('svg')).not.toBeNull();
    expect(flag?.textContent).toBe('');
  });

  it('is decoration, not a nameless picture, when there is no name and no code', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)' });
    root = createRoot(container);
    act(() => root?.render(<CountryFlag iso2={null} />));
    const flag = container.querySelector('.country-flag');
    expect(flag?.getAttribute('aria-hidden')).toBe('true');
    expect(flag?.getAttribute('role')).toBeNull();
  });

  it('has no accessibility violations in any of its forms', async () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)' });
    root = createRoot(container);
    act(() =>
      root?.render(
        <div>
          <CountryFlag iso2="JP" name="Japan" />
          <CountryFlag iso2="??" name="Somewhere" size="sm" />
          <CountryFlag iso2="JP" name="Japan" decorative size="lg" />
        </div>,
      ),
    );
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
