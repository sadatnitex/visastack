import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TidyUpCard, tidyUpLine } from './tidy-up';

describe('Tidy Up', () => {
  it('says what could be tidied, in plain words', () => {
    expect(tidyUpLine({ duplicates: 1, expired: 0, replaced: 0 })).toBe(
      '1 exact copy could be tidied away. Nothing changes until you choose.',
    );
    expect(tidyUpLine({ duplicates: 2, expired: 1, replaced: 3 })).toBe(
      '2 exact copies, 1 expired document and 3 replaced documents could be tidied away. Nothing changes until you choose.',
    );
    expect(tidyUpLine({ duplicates: 0, expired: 2, replaced: 0 })).toBe(
      '2 expired documents could be tidied away. Nothing changes until you choose.',
    );
  });

  it('offers one action that opens the documents, at Glance depth', () => {
    const html = renderToStaticMarkup(
      <TidyUpCard line="1 exact copy could be tidied away." href="/app/applicant/x/documents" />,
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/app/applicant/x/documents"');
    expect(html).toContain('data-level="glance"');
    expect(html).toContain('>Tidy Up</h2>');
  });
});
