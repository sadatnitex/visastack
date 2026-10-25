import { describe, expect, it } from 'vitest';
import { renderServer } from '../lib/next-mocks.test-support';
import { BrandMark } from './brand-mark';

describe('the VisaStack brand mark', () => {
  it('draws the Sliced V inline, hidden from screen readers next to the name', async () => {
    const html = await renderServer(<BrandMark />);
    expect(html).toMatch(/^<svg class="brand-mark" viewBox="0 0 512 512" aria-hidden="true"/);
    expect(html).toContain('class="brand-mark-tile"');
    expect(html).toContain('class="brand-mark-v"');
    // One V in stacked slices, as in the brand pack's app icon.
    expect(html.match(/<path /g)).toHaveLength(4);
    // No colour in the markup: the stylesheet sets the brand pair and its reversed form.
    expect(html).not.toMatch(/fill=/);
  });
});
