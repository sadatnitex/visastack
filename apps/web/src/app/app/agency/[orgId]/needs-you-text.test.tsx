import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeedsYouText } from './needs-you-text';

describe('the Needs you sentence of a case', () => {
  const text = 'Needs you: 1 task and 2 items to review.';

  it('links exactly the count of items to review', () => {
    const html = renderToStaticMarkup(
      <NeedsYouText
        text={text}
        review={{ phrase: '2 items to review', href: '/app/agency/o1/clients?request=r#request-r' }}
      />,
    );
    expect(html).toBe(
      'Needs you: 1 task and <a href="/app/agency/o1/clients?request=r#request-r">2 items to review</a>.',
    );
  });

  it('stays plain text with no link, or when the words are not in the sentence', () => {
    expect(renderToStaticMarkup(<NeedsYouText text={text} />)).toBe(text);
    expect(
      renderToStaticMarkup(<NeedsYouText text={text} review={{ phrase: '9 items', href: '/x' }} />),
    ).toBe(text);
  });
});
