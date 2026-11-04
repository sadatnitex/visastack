import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TidyUpCard, tidyUpLine, tidyUpShortLine } from './tidy-up';

describe('Tidy Up', () => {
  it('says what could be tidied, in plain words', () => {
    expect(tidyUpLine({ duplicates: 1, expired: 0, replaced: 0 })).toBe(
      '1 exact copy could be tidied away in one record. Nothing changes until you choose.',
    );
    expect(tidyUpLine({ duplicates: 2, expired: 1, replaced: 3 })).toBe(
      '2 exact copies, 1 expired document and 3 replaced documents could be tidied away in one record. Nothing changes until you choose.',
    );
    expect(tidyUpLine({ duplicates: 0, expired: 2, replaced: 0 }, 2)).toBe(
      '2 expired documents could be tidied away in one record. 2 other travellers have some too. Nothing changes until you choose.',
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

  it('has a short line for the slim card, and keeps the whole sentence for a screen reader', () => {
    expect(tidyUpShortLine({ duplicates: 0, expired: 1, replaced: 0 })).toBe(
      '1 expired document to tidy',
    );
    expect(tidyUpShortLine({ duplicates: 2, expired: 1, replaced: 3 })).toBe(
      '2 exact copies, 1 expired document and 3 replaced documents to tidy',
    );
    expect(tidyUpShortLine({ duplicates: 1, expired: 0, replaced: 0 }, 2)).toBe(
      '1 exact copy to tidy, and more elsewhere',
    );
    const html = renderToStaticMarkup(
      <TidyUpCard
        line="1 expired document could be tidied away in one record. Nothing changes until you choose."
        short="1 expired document to tidy"
        href="/app/applicant/x/documents"
      />,
    );
    expect(html).toContain('1 expired document to tidy</p>');
    expect(html).toContain('Nothing changes until you choose.');
    expect(html).toContain('aria-label="Tidy Up Documents"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
