import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseMobileBar } from './case-mobile-bar';
import type { CaseAttentionItem } from './case-model';

/**
 * The phone's next step bar on its own (WP-LIFT-B): how far the checklist is, the step in words,
 * one secondary button that keeps the link and the group it opens.
 */

const missing: CaseAttentionItem = {
  kind: 'missing',
  label: 'required items to fix',
  href: '#readiness',
  count: 4,
  tone: 'danger',
  opens: 'case-checklist-needs-you',
};

const render = (props: Parameters<typeof CaseMobileBar>[0]) =>
  new JSDOM(`<body>${renderToStaticMarkup(<CaseMobileBar {...props} />)}</body>`).window.document;

const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the phone next step bar', () => {
  it('says how far the checklist is, then the step, with a small bar', () => {
    const doc = render({
      missionTitle: 'Japan visitor visa',
      nextStep: missing,
      progress: { done: 6, total: 12 },
    });
    const note = doc.querySelector('fieldset.sticky-action-bar output');
    expect(words(note)).toBe('6 of 12 · Fix 4 required items for Japan visitor visa');
    const meter = note?.querySelector('svg[role="img"]');
    expect(meter?.getAttribute('aria-label')).toBe('6 of 12 required items on file');
    expect(note?.querySelector('.lift-meter-fill')?.getAttribute('width')).toBe('50');
    // The one button stays secondary: the Next Step panel at the top holds the filled one.
    const action = doc.querySelector('fieldset a');
    expect(action?.className).toBe('btn btn-secondary');
    expect(action?.getAttribute('href')).toBe('#readiness');
    expect(action?.getAttribute('data-open-group')).toBe('case-checklist-needs-you');
    expect(words(action)).toBe('See What Needs Fixing');
    expect(doc.querySelector('legend')?.textContent).toBe('Next Step');
  });

  it('shows only the step when there is no checklist to count', () => {
    for (const progress of [undefined, null, { done: 0, total: 0 }]) {
      const doc = render({ missionTitle: 'Japan visitor visa', nextStep: missing, progress });
      expect(words(doc.querySelector('output'))).toBe(
        'Fix 4 required items for Japan visitor visa',
      );
      expect(doc.querySelector('svg')).toBeNull();
    }
  });

  it('shows nothing when there is no next step or the case changed (the alert holds it)', () => {
    expect(
      render({ missionTitle: 'Case', nextStep: null }).querySelector('.case-sticky-next'),
    ).toBeNull();
    const changed: CaseAttentionItem = { ...missing, kind: 'changed' };
    expect(
      render({
        missionTitle: 'Case',
        nextStep: changed,
        progress: { done: 1, total: 2 },
      }).querySelector('.case-sticky-next'),
    ).toBeNull();
  });

  it('carries no inline style', () => {
    const html = renderToStaticMarkup(
      <CaseMobileBar missionTitle="Case" nextStep={missing} progress={{ done: 1, total: 2 }} />,
    );
    expect(html).not.toContain('style=');
  });
});
