// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { StickyActionBar } from './sticky-action-bar';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
/** The WP-SB0 block only: it ends where the next package's marker starts. */
const block = (() => {
  const start = css.indexOf('/* WP-SB0');
  if (start < 0) return '';
  const end = css.indexOf('/* WP-', start + 9);
  return css.slice(start, end < 0 ? undefined : end);
})();

describe('StickyActionBar', () => {
  it('names the group of buttons and keeps the note in a polite status', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <StickyActionBar label="Save Your Profile" note="3 changes not saved yet">
        <button type="submit" className="btn btn-primary">
          Save Changes
        </button>
      </StickyActionBar>,
    );
    const bar = host.querySelector('.sticky-action-bar');
    expect(bar?.tagName).toBe('FIELDSET');
    expect(bar?.querySelector('legend')?.textContent).toBe('Save Your Profile');
    expect(bar?.querySelector('output')?.textContent).toBe('3 changes not saved yet');
    expect(bar?.querySelector('.sticky-action-bar-actions button')?.textContent).toBe(
      'Save Changes',
    );
  });

  it('leaves the note out when there is none', () => {
    const html = renderToStaticMarkup(
      <StickyActionBar label="Next Step">
        <button type="button">Next</button>
      </StickyActionBar>,
    );
    expect(html).not.toContain('<output');
  });

  it('sticks to the bottom inside its container, clears the safe area and keeps focus in view', () => {
    expect(block).toMatch(/\.sticky-action-bar \{[^}]*position: sticky;[^}]*bottom: 0;/s);
    expect(block).toMatch(/\.sticky-action-bar \{[^}]*env\(safe-area-inset-bottom/s);
    expect(block).toMatch(/:has\(\.sticky-action-bar\)[^{]*\{[^}]*scroll-padding-bottom/s);
    expect(block).not.toMatch(/\.sticky-action-bar[^{]*\{[^}]*(transition|animation)/s);
  });

  it('passes the automated accessibility rules', async () => {
    const html = renderToStaticMarkup(
      <form aria-label="Profile">
        <label htmlFor="n">Name</label>
        <input id="n" />
        <StickyActionBar label="Save Your Profile" note="Not saved yet">
          <button type="submit">Save Changes</button>
        </StickyActionBar>
      </form>,
    );
    expect(await axeViolations(html)).toEqual([]);
  });
});
