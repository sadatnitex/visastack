import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExplainTip } from './explain-tip';

const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('ExplainTip: generated ids', () => {
  it('uses only React-generated ids, so a page outline never counts them as structure', () => {
    const html = renderToStaticMarkup(
      <ExplainTip label="Stage" text="One sentence.">
        <span>x</span>
      </ExplainTip>,
    );
    const found = ids(html);
    expect(found).toHaveLength(2);
    for (const id of found) expect(id.startsWith('_R_')).toBe(true);
  });
  it('still links the button to its sentence', () => {
    const html = renderToStaticMarkup(
      <ExplainTip label="Stage" text="One sentence.">
        <span>x</span>
      </ExplainTip>,
    );
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeTruthy();
    expect(ids(html)).toContain(described);
  });
});

describe('case page wiring', () => {
  it('turns the journey track on in the case status panel', () => {
    const source = readFileSync(
      new URL('../app/app/mission/[id]/case-status-panel.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/<CaseStageTracker[^>]*\bjourney\b/s);
  });
});
