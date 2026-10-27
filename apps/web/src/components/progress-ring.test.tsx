import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseReadinessRing } from './case-readiness-ring';
import { NO_CHECKLIST_LINE, ProgressRing } from './progress-ring';

const render = (node: React.ReactElement) => renderToStaticMarkup(node);
const BANNED = /\b(approved|approval|cleared|clearance|accepted|guarantee[ds]?|eligible)\b/i;

describe('ProgressRing with a count', () => {
  const html = render(<ProgressRing done={6} total={9} />);

  it('is an image with a text alternative that says the count', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="6 of 9 items ready"');
  });

  it('shows the same words beside the ring, hidden from assistive technology so they are not read twice', () => {
    expect(html).toContain(
      '<span class="progress-ring-words" aria-hidden="true">6 of 9 items ready</span>',
    );
  });

  it('draws the filled part from the count on a 100 unit path', () => {
    expect(html).toContain('pathLength="100"');
    expect(html).toContain('stroke-dasharray="67 33"');
    expect(html).toContain('progress-ring-fill');
  });

  it('uses no inline style, so the page needs no style exception', () => {
    expect(html).not.toContain('style=');
  });

  it('draws no fill at zero and marks a full ring, still in words', () => {
    const none = render(<ProgressRing done={0} total={9} />);
    expect(none).toContain('aria-label="0 of 9 items ready"');
    expect(none).not.toContain('progress-ring-fill');
    const all = render(<ProgressRing done={9} total={9} />);
    expect(all).toContain('progress-ring-full');
    expect(all).toContain('9 of 9 items ready');
  });

  it('never shows more ready than there are items', () => {
    expect(render(<ProgressRing done={12} total={9} />)).toContain('9 of 9 items ready');
  });

  it('puts a figure in the middle of a large ring without reading it aloud a second time', () => {
    const large = render(<ProgressRing size="lg" done={1} total={4} centre="25%" />);
    expect(large).toContain('progress-ring-lg');
    expect(large).toContain('<span class="progress-ring-centre" aria-hidden="true">25%</span>');
  });
});

describe('ProgressRing with nothing to count', () => {
  it('shows an empty ring, teaches the next step and invents no number', () => {
    const html = render(
      <ProgressRing
        done={3}
        total={0}
        emptyAction={{ href: '/app/mission/m1#pack', label: 'Pick a Checklist' }}
      />,
    );
    expect(html).toContain('progress-ring-empty');
    expect(html).toContain('aria-label="No checklist yet"');
    expect(html).toContain(NO_CHECKLIST_LINE);
    expect(html).toContain('href="/app/mission/m1#pack"');
    expect(html).not.toContain('progress-ring-fill');
    expect(html).not.toMatch(/\d+ of \d+/);
    expect(html).not.toContain('stroke-dasharray');
  });

  it('offers no link when none is given, so it can sit inside a link', () => {
    expect(render(<ProgressRing done={0} total={0} />)).not.toContain('<a ');
  });

  it('lets a checklist with nothing required say so instead of asking for a checklist', () => {
    const html = render(
      <ProgressRing
        done={0}
        total={0}
        emptyLabel="No required items"
        emptyLine="Nothing to count."
      />,
    );
    expect(html).toContain('aria-label="No required items"');
    expect(html).toContain('Nothing to count.');
    expect(html).not.toContain(NO_CHECKLIST_LINE);
  });
});

describe('CaseReadinessRing takes its count only from computed readiness', () => {
  it('shows the count when readiness exists', () => {
    const html = render(
      <CaseReadinessRing readiness={{ requiredCount: 5, satisfiedRequired: 2 }} />,
    );
    expect(html).toContain('aria-label="2 of 5 items ready"');
  });

  it('shows an empty ring with the way to pick a checklist when there is no readiness', () => {
    const html = render(<CaseReadinessRing readiness={null} pickHref="#pack" />);
    expect(html).toContain('aria-label="No checklist yet"');
    expect(html).toContain('href="#pack"');
    expect(html).toContain('>Pick a Checklist<');
  });

  it('shows no link inside a link row', () => {
    expect(render(<CaseReadinessRing readiness={null} />)).not.toContain('<a ');
  });

  it('says a checklist with no required items has nothing to count, never a full ring', () => {
    const html = render(
      <CaseReadinessRing readiness={{ requiredCount: 0, satisfiedRequired: 0 }} />,
    );
    expect(html).toContain('aria-label="No required items"');
    expect(html).not.toContain('progress-ring-fill');
    expect(html).not.toContain('progress-ring-full');
  });
});

describe('the ring never reads as a decision', () => {
  it('uses none of the decision words in any state it can be in', () => {
    const states = [
      render(<ProgressRing done={0} total={9} />),
      render(<ProgressRing done={9} total={9} />),
      render(<ProgressRing done={1} total={1} />),
      render(
        <ProgressRing
          done={0}
          total={0}
          emptyAction={{ href: '#pack', label: 'Pick a Checklist' }}
        />,
      ),
      render(<CaseReadinessRing readiness={null} pickHref="#pack" size="lg" />),
    ];
    for (const html of states) expect(html).not.toMatch(BANNED);
  });
});
