// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { CaseWelcome } from './case-welcome';
import { caseWelcomeCopy } from './case-welcome-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('caseWelcomeCopy: what a new case says to do first, from what it holds', () => {
  it('names the linked checklist and points to the first gap', () => {
    const copy = caseWelcomeCopy({
      packName: 'UK Visitor',
      checklists: { kind: 'pick', travellerUnconfirmed: false },
      firstGapHref: '#readiness',
    });
    expect(copy.title).toBe('Case Created');
    expect(copy.body[0]).toContain('Checklist linked: UK Visitor.');
    expect(copy.action).toEqual({ href: '#readiness', label: 'See What to Do First' });
  });

  it('asks for a checklist when none is linked but some exist', () => {
    const copy = caseWelcomeCopy({
      packName: null,
      checklists: { kind: 'pick', travellerUnconfirmed: false },
      firstGapHref: null,
    });
    expect(copy.body.join(' ')).toContain('pick the checklist');
    expect(copy.action).toEqual({ href: '#pack', label: 'Pick a Checklist' });
  });

  it('says when only an unconfirmed nationality or residence kept the checklist from being linked', () => {
    const copy = caseWelcomeCopy({
      packName: null,
      checklists: { kind: 'pick', travellerUnconfirmed: true },
      firstGapHref: null,
    });
    const text = copy.body.join(' ');
    expect(text).toContain('the profile does not confirm them yet');
    expect(text).toContain('Confirm the nationality and country of residence on the profile');
    expect(text).toContain('Or pick one now.');
    expect(copy.action).toEqual({ href: '#pack', label: 'Pick a Checklist' });
  });

  it('promises nothing when the check could not be made', () => {
    const copy = caseWelcomeCopy({
      packName: null,
      checklists: { kind: 'unknown' },
      firstGapHref: null,
    });
    const text = copy.body.join(' ');
    expect(text).not.toMatch(/pick the checklist|no checklist for this route/i);
    expect(copy.action.href).toBe('#evidence');
  });

  it('says plainly when there is no checklist for the route yet', () => {
    const copy = caseWelcomeCopy({
      packName: null,
      checklists: { kind: 'none' },
      firstGapHref: null,
    });
    expect(copy.body.join(' ')).toContain('There is no checklist for this route yet');
    expect(copy.body.join(' ')).not.toMatch(/approved|ready to submit|guarantee/i);
    expect(copy.action.href).toBe('#evidence');
  });
});

describe('CaseWelcome', () => {
  const copy = caseWelcomeCopy({
    packName: 'UK Visitor',
    checklists: { kind: 'none' },
    firstGapHref: null,
  });

  it('opens the page at the top, puts focus on the note and drops the welcome mark from the address', async () => {
    window.history.replaceState(null, '', '/app/mission/case-1?welcome=1#x');
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    act(() =>
      root.render(
        <>
          <CaseWelcome {...copy} />
          <div id="readiness" />
        </>,
      ),
    );
    expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0 });
    const heading = container.querySelector('h2');
    expect(heading?.textContent).toBe('Case Created');
    expect(document.activeElement).toBe(heading);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/app/mission/case-1#x',
    );
    expect(container.querySelector('a.btn-primary')?.getAttribute('href')).toBe('#readiness');
    const violations = await axeViolations(container.innerHTML);
    expect(violations).toEqual([]);
  });

  it('puts the note away on Got It and moves focus to the case title', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const title = document.createElement('h2');
    title.className = 'page-title';
    document.body.append(title);
    act(() => root.render(<CaseWelcome {...copy} />));
    const gotIt = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Got It');
    act(() => gotIt?.click());
    expect(container.querySelector('.case-welcome')).toBeNull();
    expect(document.activeElement).toBe(title);
    title.remove();
  });
});
