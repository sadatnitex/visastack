import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the "WP-LIFT-C" stylesheet block: the signed-in screens other than the case page
 * (Home, Documents, Evidence Requests, Agency Clients, Sharing and the start forms). The block is
 * flat and uses the shared tokens only, the Documents rows stay one column on a phone (a file name
 * once rendered one letter to a line), Revoke is an outlined danger button, and Received and
 * Accepted never share a colour.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

const block = (() => {
  const start = css.indexOf('/* WP-LIFT-C');
  const end = css.indexOf('/* end WP-LIFT-C */');
  if (start < 0 || end < 0) throw new Error('the WP-LIFT-C block is missing');
  return css.slice(start, end);
})();

const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The body of the first rule with exactly this selector list. */
const rule = (selector: string, from = withoutComments) =>
  from.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)} \\{([^}]*)\\}`))?.[1];

/** The text of a media block, from its opening line to its closing brace. */
function media(query: string): string {
  const open = withoutComments.indexOf(`@media (${query}) {`);
  if (open < 0) return '';
  let depth = 0;
  for (let at = withoutComments.indexOf('{', open); at < withoutComments.length; at += 1) {
    if (withoutComments[at] === '{') depth += 1;
    if (withoutComments[at] === '}') depth -= 1;
    if (depth === 0) return withoutComments.slice(open, at + 1);
  }
  return '';
}

describe('the WP-LIFT-C block', () => {
  it('is flat and uses tokens only: no colour of its own, no shadow, gradient, see-through ground or motion', () => {
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutComments).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(withoutComments).not.toMatch(
      /gradient\(|box-shadow|text-shadow|backdrop-filter|filter:|opacity/,
    );
    expect(withoutComments).not.toMatch(/transition|animation/);
    expect(withoutComments).not.toMatch(/!important/);
  });

  it('keeps every Documents row one column on a phone, so a file name is never squeezed to a letter a line', () => {
    const phone = media('max-width: 767px');
    expect(phone).not.toBe('');
    const row = rule('  .wallet-metadata-list .wallet-document-select', phone);
    expect(row).toBeDefined();
    expect(row).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    // Every part of the row takes the one column, whatever an older rule placed it in.
    const parts = phone.match(
      /\.wallet-document-select \.wallet-document-name,[\s\S]*?\{([^}]*)\}/,
    );
    expect(parts?.[1]).toMatch(/grid-column: 1;/);
  });

  it('draws Revoke as an outlined danger button, not a filled one', () => {
    const outline = rule('.btn-danger-outline');
    expect(outline).toBeDefined();
    expect(outline).toContain('border: 1px solid var(--danger-strong);');
    expect(outline).toContain('color: var(--danger);');
    expect(outline).not.toMatch(/background: var\(--danger-strong\)/);
  });

  it('gives Received the information colour and keeps it off the success colour', () => {
    // The request status of Received is told apart from Accepted (success) by the brand blue pill.
    expect(css).toMatch(/\.lift-pill-info \{[^}]*color: var\(--brand\);/);
    expect(block).not.toMatch(/\.lift-pill-info[^{]*\{[^}]*var\(--success/);
  });

  it('gives every flat fold summary a chevron that turns when it opens, since a flex summary loses the browser marker', () => {
    for (const name of [
      '.lc-ended-summary',
      '.request-decision-more-toggle',
      '.activity-log-fold-toggle',
      '.sharing-invitation-history > summary',
    ]) {
      const escaped = escapeRegExp(name);
      const flat = withoutComments.replace(/\s+/g, ' ');
      expect(flat, name).toMatch(new RegExp(`:is\\([^{]*${escaped}[^{]*\\)::after`));
      expect(flat, name).toMatch(
        new RegExp(`\\[open\\] > :is\\([^{]*${escaped}[^{]*::after \\{[^}]*rotate`),
      );
    }
  });

  it('keeps the touch targets: filter tiles, segmented filters, grant buttons and the fold toggles are 44px or more', () => {
    expect(withoutComments).toMatch(/\.wallet-overview-strip button \{[^}]*min-height: 44px;/);
    expect(withoutComments).toMatch(
      /\.quick-views\.lift-segments \.quick-view \{[^}]*min-height: 44px;/,
    );
    expect(withoutComments).toMatch(/\.lc-grant-ops \.btn \{[^}]*min-height: 44px;/);
    expect(withoutComments).toMatch(/\.request-decision-more-toggle \{[^}]*min-height: 44px;/);
    expect(withoutComments).toMatch(/\.activity-log-fold-toggle \{[^}]*min-height: 44px;/);
  });
});
