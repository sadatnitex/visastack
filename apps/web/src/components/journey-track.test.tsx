import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseStageTrackerView } from './case-stage-tracker-view';
import { JourneyTrack, journeyStageSentence } from './journey-track';

const labels = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In Review',
  AWAITING_APPLICANT: 'Awaiting Traveller',
  SUBMISSION_READY: 'Submission Ready',
  SUBMITTED: 'Submitted',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};
const path = [
  'DRAFT',
  'INTAKE',
  'IN_REVIEW',
  'AWAITING_APPLICANT',
  'SUBMISSION_READY',
  'SUBMITTED',
  'CLOSED',
] as const;

function items(html: string) {
  return html.split('<li').slice(1);
}

describe('JourneyTrack', () => {
  it('ticks only the stages before the current one, in the same order and words', () => {
    const html = renderToStaticMarkup(
      <JourneyTrack state="AWAITING_APPLICANT" labels={labels} stages={path} ariaLabel="Journey" />,
    );
    const li = items(html);
    expect(li).toHaveLength(7);
    expect(li.filter((x) => x.includes('journey-stage-done'))).toHaveLength(3);
    expect(li[3]).toContain('journey-stage-current');
    expect(li[4]).not.toContain('journey-stage-done');
    expect(li[5]).not.toContain('journey-stage-done');
    li.forEach((x, i) => expect(x).toContain(labels[path[i] as keyof typeof labels]));
  });
  it('states done, current and later in words, not colour alone', () => {
    const html = renderToStaticMarkup(
      <JourneyTrack state="INTAKE" labels={labels} stages={path} ariaLabel="Journey" />,
    );
    const li = items(html);
    expect(li[0]).toContain('Done');
    expect(li[1]).toContain('Now');
    expect(li[2]).toContain('Later');
    expect(html.match(/journey-stage-word/g)).toHaveLength(1);
  });
  it('puts exactly one explain button on the current stage, one sentence', () => {
    const html = renderToStaticMarkup(
      <JourneyTrack state="IN_REVIEW" labels={labels} stages={path} ariaLabel="Journey" />,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(items(html)[2]).toContain('explain-tip');
    expect(journeyStageSentence('IN_REVIEW')).toMatch(/^[^.]+\.$/);
  });
  it('never shows Submitted as done before the case is past it', () => {
    for (const s of [
      'DRAFT',
      'INTAKE',
      'IN_REVIEW',
      'AWAITING_APPLICANT',
      'SUBMISSION_READY',
    ] as const) {
      const li = items(
        renderToStaticMarkup(
          <JourneyTrack state={s} labels={labels} stages={path} ariaLabel="J" />,
        ),
      );
      expect(li[5]).not.toContain('journey-stage-done');
    }
    const closed = items(
      renderToStaticMarkup(
        <JourneyTrack state="CLOSED" labels={labels} stages={path} ariaLabel="J" />,
      ),
    );
    expect(closed[5]).not.toContain('journey-stage-done');
    expect(closed[5]).toContain('Not recorded');
    expect(closed[4]).toContain('journey-stage-done');
  });
  it('ticks nothing when the case is not on the path', () => {
    const html = renderToStaticMarkup(
      <JourneyTrack state="CANCELLED" labels={labels} stages={path} ariaLabel="J" />,
    );
    expect(html).toBe('');
  });
});

describe('CaseStageTrackerView with the journey track', () => {
  const base = { state: 'INTAKE' as const, labels, nextStates: [], ariaLabel: 'Stages' };
  it('is unchanged without the journey prop', () => {
    const html = renderToStaticMarkup(<CaseStageTrackerView {...base} />);
    expect(html).not.toContain('journey-track');
    expect(html).not.toContain('<button');
  });
  it('adds the track above the existing step bar when asked, keeping the bar', () => {
    const html = renderToStaticMarkup(<CaseStageTrackerView {...base} journey />);
    expect(html).toContain('journey-track');
    expect(html).toContain('lift-steps');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });
  it('falls back to the step bar alone for a cancelled case', () => {
    const html = renderToStaticMarkup(<CaseStageTrackerView {...base} state="CANCELLED" journey />);
    expect(html).not.toContain('journey-track');
    expect(html).toContain('lift-steps');
  });
});
