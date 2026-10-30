// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answers = vi.hoisted(() => [] as { ok: boolean; message: string }[]);
vi.mock('./ai-draft-actions', () => ({
  deleteAiDraftAction: async () => answers.shift() ?? { ok: true, message: '' },
}));
const { AiDraftsSection } = await import('./ai-drafts');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const draft = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Cover Letter',
  body: 'Dear Sir or Madam',
  caseTitle: null,
  app: 'Claude (claude.ai)',
  savedOn: '30 Oct 2026',
};

describe('deleting the last draft (S21 review item 10)', () => {
  it('keeps the section, says there are none, and reads out the confirmation at the heading', async () => {
    act(() => root.render(<AiDraftsSection applicantId="a" drafts={[draft]} more={0} />));
    answers.push({ ok: true, message: 'Draft deleted.' });
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete Draft'),
    );
    await act(async () => {
      button?.form?.requestSubmit(button);
    });
    expect(container.textContent).toContain('No drafts from AI apps.');
    expect(container.textContent).toContain('Draft deleted.');
    expect(container.querySelector('output')?.textContent).toContain('Draft deleted.');
    expect(document.activeElement?.id).toBe('ai-drafts-title');
  });
});
