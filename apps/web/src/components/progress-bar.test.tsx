import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseReadinessBar } from './case-readiness-ring';
import { NO_CHECKLIST_LINE, NO_REQUIRED_LINE, ProgressBar } from './progress-ring';

describe('ProgressBar', () => {
  it('is a native progress element with the count as its name', () => {
    const html = renderToStaticMarkup(<ProgressBar done={6} total={8} />);
    expect(html).toContain('<progress');
    expect(html).toContain('max="100"');
    expect(html).toContain('value="75"');
    expect(html).toContain('aria-label="6 of 8 items ready"');
    expect(html).toContain('6 of 8 items ready</span>');
  });

  it('never makes up a number: empty teaches the next step', () => {
    const html = renderToStaticMarkup(<ProgressBar done={0} total={0} />);
    expect(html).not.toContain('<progress');
    expect(html).toContain(NO_CHECKLIST_LINE);
  });

  it('holds a full bar at the total, never past it', () => {
    expect(renderToStaticMarkup(<ProgressBar done={9} total={8} />)).toContain('value="100"');
  });
});

describe('CaseReadinessBar', () => {
  it('counts from the computed readiness only', () => {
    const html = renderToStaticMarkup(
      <CaseReadinessBar readiness={{ requiredCount: 4, satisfiedRequired: 1 }} />,
    );
    expect(html).toContain('aria-label="1 of 4 items ready"');
  });

  it('says a checklist with nothing required has nothing to count', () => {
    const html = renderToStaticMarkup(
      <CaseReadinessBar readiness={{ requiredCount: 0, satisfiedRequired: 0 }} />,
    );
    expect(html).toContain(NO_REQUIRED_LINE);
  });

  it('teaches the next step when there is no readiness, or says why it cannot be read', () => {
    expect(renderToStaticMarkup(<CaseReadinessBar readiness={null} />)).toContain(
      NO_CHECKLIST_LINE,
    );
    expect(
      renderToStaticMarkup(<CaseReadinessBar readiness={null} emptyLine="Open the case." />),
    ).toContain('Open the case.');
  });
});
