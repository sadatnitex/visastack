import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CasePurposeGroup } from '../lib/case-choices';
import { EmptyArt } from './empty-art';
import { ListRow } from './list-pattern';
import { MarkTile } from './mark-tile';
import { PurposeSelect } from './purpose-select';
import { EmptyState } from './ui';
import { StatusPill } from './ui-lift/status-pill';

/** The picture language on the shared pieces (owner decision, 10 Nov 2026). */

describe('MarkTile', () => {
  it('draws the icon in its tone tile and hides it from screen readers', () => {
    const html = renderToStaticMarkup(<MarkTile mark={{ icon: 'docPassport', tone: 'blue' }} />);
    expect(html).toContain('class="mark-tile"');
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain('data-mark="docPassport"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('draws grey as the neutral token, not as a seventh tone', () => {
    const html = renderToStaticMarkup(<MarkTile mark={{ icon: 'lock', tone: 'neutral' }} />);
    expect(html).toContain('data-neutral');
    expect(html).not.toContain('data-tone');
  });
});

describe('ListRow with a kind', () => {
  it('shows the kind in its tile and the status in the chip, with the word as the name', () => {
    const html = renderToStaticMarkup(
      <ListRow
        id="r1"
        name="Passport"
        tone="danger"
        status="Missing"
        mark={{ icon: 'docPassport', tone: 'blue' }}
      />,
    );
    expect(html).toContain('lift-check-mark');
    expect(html).toContain('data-mark="docPassport"');
    // The chip wears its own symbol and still says the word.
    expect(html).toContain('lift-pill-icon');
    expect(html).toMatch(/<\/svg>Missing<\/span>/);
    // The old status glyph circle is not drawn as well.
    expect(html).not.toContain('class="lift-check-icon"');
  });

  it('keeps the status glyph for a row with no kind', () => {
    const html = renderToStaticMarkup(
      <ListRow id="r2" name="Anything" tone="success" status="On File" />,
    );
    expect(html).toContain('class="lift-check-icon"');
    expect(html).not.toContain('mark-tile');
  });
});

describe('StatusPill', () => {
  it('wears the symbol of a status word and drops the plain mark', () => {
    const html = renderToStaticMarkup(<StatusPill tone="success">On File</StatusPill>);
    expect(html).toContain('lift-pill-icon');
    expect(html).toContain('<svg');
    expect(html).toContain('On File');
  });

  it('keeps the plain mark when the tone disagrees with the word', () => {
    const html = renderToStaticMarkup(<StatusPill tone="danger">Pending</StatusPill>);
    expect(html).not.toContain('lift-pill-icon');
    expect(html).not.toContain('<svg');
  });

  it('keeps the plain mark for a word that is not a status', () => {
    const html = renderToStaticMarkup(<StatusPill tone="warning">Due in 3 days</StatusPill>);
    expect(html).not.toContain('lift-pill-icon');
    expect(html).not.toContain('<svg');
  });
});

describe('empty states', () => {
  it('draws three tiles for each of the three places', () => {
    for (const kind of ['documents', 'trips', 'sharing'] as const) {
      const html = renderToStaticMarkup(<EmptyArt kind={kind} />);
      expect(html).toContain(`data-art="${kind}"`);
      expect(html.match(/class="mark-tile"/g)).toHaveLength(3);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('shows the drawing in place of the single icon when a screen asks for it', () => {
    const withArt = renderToStaticMarkup(
      <EmptyState title="No Documents Yet" art="documents">
        Add each paper once.
      </EmptyState>,
    );
    expect(withArt).toContain('empty-art');
    expect(withArt).not.toContain('icon-tile');
    const plain = renderToStaticMarkup(<EmptyState title="Nothing Here">Text.</EmptyState>);
    expect(plain).toContain('icon-tile');
    expect(plain).not.toContain('empty-art');
  });
});

describe('PurposeSelect', () => {
  const purposes: readonly CasePurposeGroup[] = [
    {
      family: 'study',
      label: 'Study',
      options: [{ key: 'bachelors_or_masters_degree', label: "Bachelor's or Master's Degree" }],
    },
    { family: 'visit', label: 'Visit', options: [{ key: 'tourism', label: 'Tourism' }] },
  ];

  it('shows a plane before anything is chosen and the purpose picture after', () => {
    const empty = renderToStaticMarkup(
      <PurposeSelect id="p" purposes={purposes} value="" onChange={() => {}} />,
    );
    expect(empty).toContain('data-mark="plane"');
    expect(empty).toContain('data-neutral');
    const chosen = renderToStaticMarkup(
      <PurposeSelect
        id="p"
        purposes={purposes}
        value="bachelors_or_masters_degree"
        onChange={() => {}}
      />,
    );
    expect(chosen).toContain('data-mark="tripStudy"');
    expect(chosen).toContain('name="purpose"');
    expect(chosen).toContain('<optgroup');
    // A value the list does not hold is not drawn as a purpose.
    const stray = renderToStaticMarkup(
      <PurposeSelect id="p" purposes={purposes} value="not_in_the_list" onChange={() => {}} />,
    );
    expect(stray).toContain('data-mark="plane"');
  });
});
