import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupedList } from './grouped-list';
import { ListRow } from './list-row';

const parse = (html: string) => new JSDOM(html).window.document;

describe('the list row options a screen may use', () => {
  it('carries an address anchor on the row when asked, and none otherwise', () => {
    const row = (domId?: string) =>
      parse(
        renderToStaticMarkup(
          <ListRow
            id="r1"
            name="Document: Bank Statement"
            tone="neutral"
            status="Received"
            domId={domId}
          />,
        ),
      ).querySelector('[data-pattern="list-row"]');
    expect(row('request-r1')?.id).toBe('request-r1');
    expect(row()?.hasAttribute('id')).toBe(false);
  });

  it('marks a date or count line as data, not explanation', () => {
    const meta = (metaIsData?: boolean) =>
      parse(
        renderToStaticMarkup(
          <ListRow
            id="r1"
            name="x"
            tone="neutral"
            status="Received"
            meta="Needed by 10 Nov 2026"
            metaIsData={metaIsData}
          />,
        ),
      ).querySelector('.lp-row-meta');
    expect(meta(true)?.hasAttribute('data-value')).toBe(true);
    expect(meta()?.hasAttribute('data-value')).toBe(false);
  });
});

describe('the folder heading level', () => {
  const heading = (level?: 2 | 3 | 4) =>
    parse(
      renderToStaticMarkup(
        <GroupedList
          {...(level ? { level } : {})}
          groups={[
            { id: 'g', heading: 'Finished', count: 1, tone: 'neutral', open: true, children: null },
          ]}
        />,
      ),
    ).querySelector('[data-pattern="group-heading"]')?.tagName;
  it('is a level 4 heading by default, and the level a screen needs when it asks', () => {
    expect(heading()).toBe('H4');
    expect(heading(2)).toBe('H2');
    expect(heading(3)).toBe('H3');
  });
});
