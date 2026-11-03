import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the "WP-UMPE-UX4" sidebar block. The markup tests cannot see what the stylesheet does,
 * and each of these is a rule a later edit could drop without any other test noticing.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const start = css.indexOf('/* WP-UMPE-UX4 ');
const rest = start < 0 ? '' : css.slice(start);
// The block ends at the next marker, so a later package's rules never count as this one's.
const end = rest.slice(12).search(/\n\/\* WP-/);
const block = (end < 0 ? rest : rest.slice(0, 12 + end)).replace(/\/\*[\s\S]*?\*\//g, '');
const flat = block.replace(/\s+/g, '');
const all = css.replace(/\s+/g, '');

describe('the sidebar block (WP-UMPE-UX4)', () => {
  it('is one marked block', () => {
    expect(css.split('/* WP-UMPE-UX4 ').length - 1).toBe(1);
    expect(start).toBeGreaterThan(0);
  });

  it('lets a task wrapper step aside on a phone, so the bottom bar keeps its four columns', () => {
    expect(flat).toContain('@media(max-width:1023px){.app-nav-entry{display:contents;}');
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

  it('keeps a task below the bar out of the phone panel, where Quick actions lists it', () => {
    expect(flat).toContain('.app-more.app-shell-links-morea.app-nav-action{display:none;}');
  });

  it('never hides the Staff Mode cue; only the customer reassurance gives way', () => {
    // Only a customer workspace loses the whole card, and only on a very short window; every
    // workspace, staff included, first loses just its small line.
    expect(flat).toContain(
      '.app-frame:not([data-workspace="platform"]).workspace-assurance{display:none;}',
    );
    expect(flat).not.toMatch(/(^|})\.workspace-assurance\{display:none/);
    expect(flat).toContain(
      '@media(min-width:1024px)and(max-height:780px){.workspace-assurancesmall{display:none;}}',
    );
  });
});
