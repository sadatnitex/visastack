// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { AttentionList, EmptyState } = await import('./ui');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The rest of the workspace speaks the design language (Owner, 5 Nov 2026): an empty state's icon
 * stands bare, a line that asks for attention wears the slice rule of its kind, and a section bar
 * with many tabs wraps on a phone instead of scrolling.
 */
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('attention lines carry their kind', () => {
  it('maps each kind to its tone', () => {
    act(() =>
      root.render(
        <AttentionList
          items={[
            { key: 'a', href: '/a', label: 'A', tone: 'success' },
            { key: 'b', href: '/b', label: 'B' },
            { key: 'c', href: '/c', label: 'C', tone: 'danger' },
            { key: 'd', href: '/d', label: 'D', tone: 'neutral' },
          ]}
        />,
      ),
    );
    const tones = [...container.querySelectorAll('.attention-item')].map((li) =>
      li.getAttribute('data-tone'),
    );
    expect(tones).toEqual(['green', 'amber', 'red', 'blue']);
  });
});

describe('an empty state shows its icon bare', () => {
  it('draws the icon large, inside no tile of its own', () => {
    act(() => root.render(<EmptyState title="Nothing here">Add one.</EmptyState>));
    const icon = container.querySelector('.icon-tile svg.icon');
    expect(icon?.getAttribute('width')).toBe('36');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
  const block = css.slice(
    css.indexOf('/* WP-PLAIN-SCREENS'),
    css.indexOf('/* end WP-PLAIN-SCREENS */'),
  );
  it('takes the tile off the empty state icon', () => {
    expect(block).toMatch(/\.icon-tile \{[^}]*background: none;/);
    expect(block).toMatch(/\.icon-tile \{[^}]*border-radius: 0;/);
  });
  it('gives an attention line the slice rule of its tone', () => {
    expect(block).toMatch(/\.attention-item\[data-tone\] \.attention-link::before/);
    expect(block).toMatch(/border-top: 3px solid var\(--tone\)/);
  });
  it('wraps a section bar on a phone instead of scrolling it', () => {
    expect(block).toMatch(
      /@media \(max-width: 640px\) \{\s*\.subnav:not\(\.subnav-fit\) \{\s*display: grid;/,
    );
    expect(block).toMatch(/overflow-x: visible;/);
  });
});
