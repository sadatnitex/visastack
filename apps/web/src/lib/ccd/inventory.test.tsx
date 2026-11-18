import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TravellerRow } from '../../app/app/u7-rows';
import { entryKey, inventory } from './inventory';

const screen = (meta?: string) =>
  `<main>${renderToStaticMarkup(
    <TravellerRow
      headingLevel={2}
      title="Signed In"
      picture={<span />}
      chip={{ label: 'Session', tone: 'neutral' }}
      {...(meta ? { meta } : {})}
    >
      <p>Body sentence.</p>
    </TravellerRow>,
  )}</main>`;

describe('the parity inventory counts sentences kept in a row summary (U7)', () => {
  it('counts a marked chip and a marked line as text entries', () => {
    const keys = inventory(screen('Sign out of this device.')).map(entryKey);
    expect(keys).toContain('text|Session|');
    expect(keys).toContain('text|Sign out of this device.|');
    // Everything it counted before is still counted: the heading and the body sentence.
    expect(keys).toContain('heading|Signed In|2');
    expect(keys).toContain('text|Body sentence.|');
  });

  it('shows a sentence as missing when it is removed from the screen (the guard can still fail)', () => {
    const before = inventory(screen('Sign out of this device.')).map(entryKey);
    const now = new Set(inventory(screen()).map(entryKey));
    expect(before.filter((key) => !now.has(key))).toContain('text|Sign out of this device.|');
  });

  it('never counts the wrapper twice: one entry per marked sentence', () => {
    const keys = inventory(screen('Sign out of this device.')).map(entryKey);
    expect(keys.filter((key) => key === 'text|Session|')).toHaveLength(1);
  });
});
