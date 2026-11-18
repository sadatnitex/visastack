// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StickyDetails } from './sticky-details';

describe('StickyDetails summaryProps (WAL1)', () => {
  it('draws existing callers exactly as before', () => {
    const html = renderToStaticMarkup(
      <StickyDetails initiallyOpen className="plan-fold" summary="Change Plan">
        <p>Inside.</p>
      </StickyDetails>,
    );
    expect(html).toBe(
      '<details class="plan-fold" open=""><summary>Change Plan</summary><p>Inside.</p></details>',
    );
    const closed = renderToStaticMarkup(
      <StickyDetails initiallyOpen={false} summary="Closed">
        x
      </StickyDetails>,
    );
    expect(closed).toBe('<details><summary>Closed</summary>x</details>');
  });

  it('puts the given names and class on the summary', () => {
    const html = renderToStaticMarkup(
      <StickyDetails
        initiallyOpen={false}
        summary="Row"
        summaryProps={{ className: 'row', 'aria-labelledby': 't', 'aria-describedby': 'd s' }}
      >
        x
      </StickyDetails>,
    );
    expect(html).toBe(
      '<details><summary class="row" aria-labelledby="t" aria-describedby="d s">Row</summary>x</details>',
    );
  });
});
