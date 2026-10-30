import { AI_FEATURE_LIMIT_HINT, AI_FEATURE_OFF_HINT } from '@visastack/core/ai-features';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('./actions', () => ({ explainReadinessGapAction: vi.fn() }));
const { ExplainGapButton } = await import('./readiness-gap-explain');

const render = (props: Parameters<typeof ExplainGapButton>[0]) =>
  renderToStaticMarkup(<ExplainGapButton {...props} />);

describe('Explain This with AI on the case page (S28 off state)', () => {
  it('offers the button while Gap Explanations is on', () => {
    const html = render({ missionId: 'm1', packRequirementId: 'r1', explanation: null });
    expect(textOf(html)).toContain('Explain This with AI');
    expect(html).toContain('<form');
  });

  it('puts the plain hint in its place while off, and keeps an earlier explanation readable', async () => {
    const html = render({
      missionId: 'm1',
      packRequirementId: 'r1',
      explanation: 'A bank statement from the last three months is still needed.',
      off: 'turned_off',
    });
    const text = textOf(html);
    expect(html).not.toContain('<form');
    expect(text).not.toContain('Explanation');
    expect(text).toContain(AI_FEATURE_OFF_HINT);
    expect(text).toContain('A bank statement from the last three months is still needed.');
    expect(await axeViolations(html)).toEqual([]);
    expect(
      textOf(
        render({ missionId: 'm1', packRequirementId: 'r1', explanation: null, off: 'daily_limit' }),
      ),
    ).toContain(AI_FEATURE_LIMIT_HINT);
  });
});
