import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every signed-in page sits in the page gutter (`section container`): its own markup, or the
 * nearest layout above it, supplies it. A page that does not runs its text and buttons to the edge
 * of the window beside the sidebar, which is what the Group Trips pages did.
 */
const ROOT = resolve(__dirname, '../app/app');
const GUTTER = /section container/;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

function gutterFor(page: string): boolean {
  if (GUTTER.test(readFileSync(page, 'utf8'))) return true;
  for (let dir = dirname(page); dir.startsWith(ROOT); dir = dirname(dir)) {
    const layout = join(dir, 'layout.tsx');
    if (existsSync(layout) && GUTTER.test(readFileSync(layout, 'utf8'))) return true;
    if (dir === ROOT) break;
  }
  return false;
}

describe('every signed-in page has the page gutter', () => {
  const found = pages(ROOT);

  it('finds the pages', () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it('has none without it, itself or through a layout above', () => {
    const bare = found
      .filter((page) => !gutterFor(page))
      .map((page) => page.slice(ROOT.length + 1));
    expect(bare).toEqual([]);
  });
});
