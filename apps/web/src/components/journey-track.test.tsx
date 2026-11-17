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

const legacyPath = [
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'UNDER_REVIEW',
  'READY_TO_EXPORT',
  'LOCKED',
  'SUBMISSION_READY',
  'SUBMITTED',
  'CLOSED',
] as const;

const render = (state: string, stages: readonly string[] = path) =>
  renderToStaticMarkup(
    <JourneyTrack
      state={state as never}
      labels={labels}
      stages={stages as never}
      ariaLabel="Journey"
    />,
  );

describe('JourneyTrack', () => {
  it('keeps the same order and words as the step bar', () => {
    const li = items(render('AWAITING_APPLICANT'));
    expect(li).toHaveLength(7);
    li.forEach((x, i) => expect(x).toContain(labels[path[i] as keyof typeof labels]));
  });
  it('never claims an earlier stage as done: nothing is ticked, whichever stage is current', () => {
    for (const state of path) {
      const html = render(state);
      expect(html).not.toContain('journey-stage-done');
      expect(html).not.toContain('journey-stage-tick');
      expect(html).not.toContain('Done');
    }
    // A legacy case that moved Locked to Submission Ready (or Closed) skipped stages on the way.
    for (const state of ['SUBMISSION_READY', 'CLOSED']) {
      const html = render(state, legacyPath);
      expect(html).not.toContain('journey-stage-done');
      expect(html).not.toContain('Done');
    }
  });
  it('marks earlier stages as Before and later ones as Later, in words', () => {
    const li = items(render('IN_REVIEW'));
    expect(li[0]).toContain('Draft: Before');
    expect(li[1]).toContain('Intake: Before');
    expect(li[2]).toContain('Now');
    expect(li[3]).toContain('Awaiting Traveller: Later');
    expect(li[0]).toContain('journey-stage-before');
    expect(render('IN_REVIEW').match(/journey-stage-word/g)).toHaveLength(1);
  });
  it('makes no claim about Submitted on a closed case or before it', () => {
    for (const state of ['SUBMISSION_READY', 'CLOSED']) {
      const submitted = items(render(state))[5] ?? '';
      expect(submitted).not.toContain('Not recorded');
      expect(submitted).not.toContain('Done');
      expect(submitted).not.toContain('journey-stage-done');
    }
    // Only a case that is in Submitted now says so.
    expect(items(render('SUBMITTED'))[5]).toContain('journey-stage-current');
  });
  it('says Now in words for the current item and adds no aria-current of its own', () => {
    const html = render('INTAKE');
    expect(html).not.toContain('aria-current');
    const current = items(html)[1] ?? '';
    expect(current).toContain('Now: ');
    expect(current).toContain('journey-stage-word');
  });
  it('keeps list semantics on the ordered list', () => {
    expect(render('INTAKE')).toContain('<ol class="journey-track-list" role="list">');
  });
  it('puts exactly one explain button on the current stage, one sentence', () => {
    const html = render('IN_REVIEW');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(items(html)[2]).toContain('explain-tip');
    expect(journeyStageSentence('IN_REVIEW')).toMatch(/^[^.]+\.$/);
  });
  it('draws nothing when the case is not on the path', () => {
    expect(render('CANCELLED')).toBe('');
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
    // The step bar alone carries aria-current, so the page has one current step.
  });
  it('falls back to the step bar alone for a cancelled case', () => {
    const html = renderToStaticMarkup(<CaseStageTrackerView {...base} state="CANCELLED" journey />);
    expect(html).not.toContain('journey-track');
    expect(html).toContain('lift-steps');
  });
});
