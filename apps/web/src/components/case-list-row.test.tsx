// @vitest-environment jsdom
import { MISSION_STATES } from '@visastack/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { CASE_STATUS, CHIP_WORDS, caseStatus } from '../lib/status-words';
import { isTitleCase } from '../lib/title-case';
import {
  CaseListRow,
  type CaseListRowProps,
  type CaseRowProgress,
  caseRowName,
} from './case-list-row';

const base: CaseListRowProps = {
  id: 'c1',
  title: 'Japan',
  state: 'INTAKE',
  destination: 'Japan',
  iso2: 'JP',
  purpose: 'Tourism',
  progress: { kind: 'counted', done: 6, total: 8 },
  nextStep: 'Add Passport',
  href: '/app/mission/c1',
};

function draw(props: Partial<CaseListRowProps> = {}): HTMLElement {
  const doc = document.createElement('div');
  doc.innerHTML = `<ul>${renderToStaticMarkup(<CaseListRow {...base} {...props} />)}</ul>`;
  return doc;
}

const shape = (doc: HTMLElement) =>
  [...(doc.querySelector('.trip-card-body')?.children ?? [])].map((child) => child.className);

describe('the status words of a case', () => {
  it('has a plain word and a colour for every stored stage, legacy ones included', () => {
    for (const state of MISSION_STATES) {
      const found = CASE_STATUS[state];
      expect(found, `stage ${state}`).toBeDefined();
      expect(isTitleCase(found?.word ?? ''), `"${found?.word}" is Title Case`).toBe(true);
      expect(CHIP_WORDS.has(found?.word ?? ''), `"${found?.word}" is a chip word`).toBe(true);
    }
    expect(Object.keys(CASE_STATUS).sort()).toEqual([...MISSION_STATES].sort());
  });

  it('uses the owner-approved words and colours for the eight stages', () => {
    expect(CASE_STATUS.DRAFT).toEqual({ word: 'Getting Started', tone: 'warning' });
    expect(CASE_STATUS.INTAKE).toEqual({ word: 'Gathering Documents', tone: 'warning' });
    expect(CASE_STATUS.IN_REVIEW).toEqual({ word: 'Agency Is Checking', tone: 'info' });
    expect(CASE_STATUS.AWAITING_APPLICANT).toEqual({ word: 'Needs You', tone: 'danger' });
    expect(CASE_STATUS.SUBMISSION_READY).toEqual({ word: 'Ready to Submit', tone: 'success' });
    expect(CASE_STATUS.SUBMITTED).toEqual({ word: 'Submitted', tone: 'info' });
    expect(CASE_STATUS.CLOSED).toEqual({ word: 'Closed', tone: 'neutral' });
    expect(CASE_STATUS.CANCELLED).toEqual({ word: 'Cancelled', tone: 'neutral' });
  });

  it('reads an older stage as the nearest stage, and never claims a decision', () => {
    expect(caseStatus('IN_PROGRESS').word).toBe('Gathering Documents');
    expect(caseStatus('READY_FOR_REVIEW').word).toBe('Agency Is Checking');
    expect(caseStatus('UNDER_REVIEW').word).toBe('Agency Is Checking');
    expect(caseStatus('READY_TO_EXPORT').word).toBe('Ready to Submit');
    expect(caseStatus('LOCKED').word).toBe('Closed');
    for (const { word } of Object.values(CASE_STATUS)) expect(word).not.toMatch(/approv|grant/i);
  });

  it('reads a stage it does not know as the plainest word, never the stored code', () => {
    expect(caseStatus('SOMETHING_NEW').word).toBe('Getting Started');
  });
});

describe('a case row', () => {
  it('has the same shape whatever the length of the name, with the chip alone on its line', () => {
    const short = draw({ title: 'JP' });
    const long = draw({ title: `Family visit ${'to Japan and onwards '.repeat(20)}` });
    expect(shape(long)).toEqual(shape(short));
    for (const doc of [short, long]) {
      const line = doc.querySelector('.trip-card-chipline');
      expect(line?.children).toHaveLength(1);
      expect(line?.firstElementChild?.classList.contains('case-chip')).toBe(true);
      expect(line?.textContent).toBe('Gathering Documents');
      // The name sits on one line: the stylesheet cuts it, the markup keeps it whole.
      expect(doc.querySelector('.trip-card-title')?.textContent).toBe(
        doc === long ? `Family visit ${'to Japan and onwards '.repeat(20)}` : 'JP',
      );
    }
  });

  it('colours the chip with the Harbor tone of the stage, and leaves grey ones plain', () => {
    const tone = (state: string) =>
      draw({ state }).querySelector('.case-chip')?.getAttribute('data-tone') ?? null;
    expect(tone('DRAFT')).toBe('amber');
    expect(tone('AWAITING_APPLICANT')).toBe('red');
    expect(tone('IN_REVIEW')).toBe('blue');
    expect(tone('SUBMISSION_READY')).toBe('green');
    expect(tone('CLOSED')).toBeNull();
  });

  it('leaves a slot for the purpose icon in front of the purpose', () => {
    const doc = draw({ purposeIcon: <svg data-testid="purpose" aria-hidden="true" /> });
    expect(doc.querySelector('.trip-card-sub .trip-card-purpose svg')).not.toBeNull();
    expect(doc.querySelector('.trip-card-sub')?.textContent).toBe('Japan \u00b7 Tourism');
  });

  it('is one link with one tab stop and one accessible name: case, stage and count', () => {
    const doc = draw();
    const links = doc.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/app/mission/c1');
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'Japan, Gathering Documents, 6 of 8 ready, Next: Add Passport',
    );
    expect(doc.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(1);
  });

  it('names the case and its stage when there is no count to say', () => {
    const none: CaseRowProgress = { kind: 'no-checklist' };
    expect(caseRowName('Korea', 'DRAFT', none)).toBe('Korea, Getting Started');
    expect(caseRowName('Korea', 'DRAFT', none, 'Pick a Checklist')).toBe(
      'Korea, Getting Started, Next: Pick a Checklist',
    );
  });

  it('shows the country and the purpose on one muted line, and invents neither', () => {
    expect(draw().querySelector('.trip-card-sub')?.textContent).toBe('Japan · Tourism');
    expect(draw({ purpose: null }).querySelector('.trip-card-sub')?.textContent).toBe('Japan');
    expect(
      draw({ destination: null, iso2: null }).querySelector('.trip-card-sub')?.textContent,
    ).toBe('Tourism');
    expect(
      draw({ destination: null, iso2: null, purpose: null }).querySelector('.trip-card-sub'),
    ).toBeNull();
  });

  it('draws a thin bar with the count and the next step from the checklist', () => {
    const doc = draw();
    const bar = doc.querySelector<HTMLProgressElement>('progress.case-bar-track');
    expect(bar?.getAttribute('value')).toBe('75');
    expect(doc.querySelector('.trip-card-count')?.textContent).toBe('6 of 8 ready');
    expect(doc.querySelector('.trip-card-next')?.textContent).toBe('Next: Add Passport');
  });

  it('keeps a visible stub on a bar at zero', () => {
    const doc = draw({ progress: { kind: 'counted', done: 0, total: 5 } });
    expect(doc.querySelector('.case-bar')?.getAttribute('data-empty')).toBe('true');
    expect(doc.querySelector('.trip-card-count')?.textContent).toBe('0 of 5 ready');
    expect(draw().querySelector('.case-bar')?.getAttribute('data-empty')).toBe('false');
  });

  it('with no checklist draws no bar and makes picking one the next step', () => {
    const doc = draw({ progress: { kind: 'no-checklist' }, nextStep: null });
    expect(doc.querySelector('progress')).toBeNull();
    expect(doc.querySelector('.trip-card-count')).toBeNull();
    expect(doc.querySelector('.trip-card-next')?.textContent).toBe('Next: Pick a Checklist');
  });

  it('gives a closed or cancelled case no advice about what to do next', () => {
    const doc = draw({
      state: 'CLOSED',
      past: true,
      progress: { kind: 'no-checklist' },
      nextStep: 'Add Passport',
    });
    expect(doc.querySelector('.trip-card-next')).toBeNull();
    expect(doc.textContent).not.toMatch(/pick a checklist/i);
    const counted = draw({ state: 'CANCELLED', past: true });
    expect(counted.querySelector('.trip-card-next')).toBeNull();
    expect(counted.querySelector('.trip-card-count')?.textContent).toBe('6 of 8 ready');
  });

  it('says why there is no count instead of making one up', () => {
    expect(
      draw({ progress: { kind: 'none-required' } }).querySelector('.trip-card-count')?.textContent,
    ).toBe('No required items');
    expect(
      draw({ progress: { kind: 'unread' } }).querySelector('.trip-card-count')?.textContent,
    ).toBe('Open the case to see its progress.');
  });

  it('shows no next step when nothing required is missing', () => {
    expect(draw({ nextStep: null }).querySelector('.trip-card-next')).toBeNull();
  });

  it('draws the flag for the destination, and a plain globe for text that names no country', () => {
    expect(draw().querySelector('.country-flag')?.getAttribute('data-size')).toBe('lg');
    const unknown = draw({ destination: 'Not sure yet', iso2: null });
    expect(unknown.querySelector('.country-flag-unknown')).not.toBeNull();
    expect(unknown.querySelector('.trip-card-sub')?.textContent).toContain('Not sure yet');
  });

  it('has no accessibility violations in its states', async () => {
    const doc = document.createElement('div');
    doc.innerHTML = `<ul>${[
      base,
      { ...base, id: 'c2', progress: { kind: 'no-checklist' } as const, nextStep: null },
      { ...base, id: 'c3', state: 'CLOSED', past: true },
      { ...base, id: 'c4', destination: null, iso2: null, purpose: null },
    ]
      .map((props) => renderToStaticMarkup(<CaseListRow {...props} />))
      .join('')}</ul>`;
    document.body.append(doc);
    expect(await axeViolations(doc.outerHTML)).toEqual([]);
    doc.remove();
  });
});
