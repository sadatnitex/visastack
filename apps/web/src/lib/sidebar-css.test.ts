import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the "WP-UMPE-UX4" sidebar block. The markup tests cannot see what the stylesheet does,
 * and each of these is a rule a later edit could drop without any other test noticing.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const start = css.indexOf('/* WP-UMPE-UX4 ');
const block = (start < 0 ? '' : css.slice(start)).replace(/\/\*[\s\S]*?\*\//g, '');
const flat = block.replace(/\s+/g, '');
const all = css.replace(/\s+/g, '');

describe('the sidebar block (WP-UMPE-UX4)', () => {
  it('is one marked block at the end of the stylesheet', () => {
    expect(css.split('/* WP-UMPE-UX4 ').length - 1).toBe(1);
    expect(start).toBeGreaterThan(0);
    expect(css.slice(start + 1)).not.toMatch(/\/\* WP-/);
  });

  it('lets a task wrapper step aside on a phone, so the bottom bar keeps its four columns', () => {
    expect(flat).toContain('@media(max-width:1023px){.app-nav-entry{display:contents;}}');
  });

  it('keeps the task hidden in the collapsed rail, as before', () => {
    expect(all).toContain(
      '.app-frame[data-sidebar="collapsed"].app-shell-linksa.app-nav-action{display:none;}',
    );
  });

  it('ties the reserved width of a row to the button it makes room for', () => {
    expect(flat).toContain('--nav-action:44px');
    expect(flat).toContain('padding-inline-end:calc(var(--nav-action)+var(--space-2))');
    expect(flat).toContain('width:var(--nav-action)');
  });

  it('shows the task name on hover and on keyboard focus, not only as a mouse tooltip', () => {
    expect(flat).toContain(':where(:hover,:focus-visible)::after{content:attr(aria-label)');
  });

  it('draws the hairline only when the utilities exist', () => {
    expect(flat).toContain('.app-shell-links-more:has(a){');
  });

  it('never hides the Staff Mode cue; only the customer reassurance gives way', () => {
    expect(flat).toContain(
      '.app-frame:not([data-workspace="platform"]).workspace-assurance{display:none;}',
    );
    expect(flat).not.toMatch(/(^|})\.workspace-assurance\{display:none/);
    expect(flat).toContain(
      '.app-frame[data-workspace="platform"].workspace-assurancesmall{display:none;}',
    );
  });
});
