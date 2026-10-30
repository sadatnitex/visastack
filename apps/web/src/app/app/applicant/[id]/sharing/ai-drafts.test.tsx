import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { textOf } from '../../../../../lib/next-mocks.test-support';

vi.mock('./ai-draft-actions', () => ({ deleteAiDraftAction: vi.fn() }));
const { AiDraftsSection } = await import('./ai-drafts');

const draft = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Cover Letter',
  body: 'Dear Sir or Madam,\n\nI am writing to apply.',
  caseTitle: 'London Trip',
  app: 'Claude (claude.ai)',
  savedOn: '30 Oct 2026',
};

describe('Drafts from AI Apps', () => {
  it('shows each draft with its app and case, to copy or delete, and says it goes nowhere', async () => {
    const html = renderToStaticMarkup(
      <AiDraftsSection
        applicantId="11111111-1111-4111-8111-111111111111"
        drafts={[draft]}
        more={2}
      />,
    );
    const text = textOf(html);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html.match(/<h3/g)).toHaveLength(1);
    expect(text).toContain('Drafts from AI Apps');
    expect(text).toContain('Saved by Claude (claude.ai) on 30 Oct 2026, for London Trip.');
    expect(text).toContain('nothing is sent anywhere, and agencies never see them');
    expect(text).toContain('Copy Draft');
    expect(text).toContain('Delete Draft');
    expect(html).toContain('aria-label="Delete Draft: Cover Letter"');
    expect(text).toContain('And 2 more drafts, not shown here.');
    // The draft is plain text: shown as typed, never as markup.
    expect(html).toContain('Dear Sir or Madam,\n\nI am writing to apply.');
    expect(await axeViolations(html)).toEqual([]);
  });
});
