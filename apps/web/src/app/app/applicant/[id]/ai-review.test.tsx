// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  runAiExtractionAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
  runOcrAction: vi.fn(),
}));

const { DocumentFindings } = await import('./ai-review');
type Finding = Parameters<typeof DocumentFindings>[0]['proposals'][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const finding = (overrides: Partial<Finding> & { id: string; fieldLabel: string }): Finding => ({
  type: 'NEW',
  fieldKey: overrides.fieldLabel.toLowerCase().replace(/ /g, '_'),
  value: 'Value',
  confidence: 95,
  rationale: null,
  evidence: [{ snippet: 'Value', verified: true }],
  clear: true,
  ...overrides,
});

function render(proposals: readonly Finding[], canApprove = true) {
  act(() =>
    root.render(
      <DocumentFindings applicantId="a1" canApprove={canApprove} proposals={proposals} />,
    ),
  );
}

describe('check what we found', () => {
  it('reassures that nothing is saved, and puts differences first, then readings to check, then clear ones', () => {
    render([
      finding({ id: 'clear', fieldLabel: 'Given Name' }),
      finding({ id: 'check', fieldLabel: 'Occupation', clear: false }),
      finding({ id: 'diff', fieldLabel: 'City', difference: { current: 'Chittagong' } }),
    ]);
    expect(host.querySelector('h3')?.textContent).toBe('Check What We Found');
    expect(host.textContent).toContain('Nothing is saved to your profile until you accept it.');
    const headings = [...host.querySelectorAll('.finding-card h4')].map((h) => h.textContent);
    expect(headings).toEqual(['City', 'Occupation', 'Given Name']);
    const badges = [...host.querySelectorAll('.finding-card-head .badge')].map(
      (b) => b.textContent,
    );
    expect(badges).toEqual(['Clear', 'Please Check', 'Clear']);
  });

  it('offers to accept all clear details at once, leaving out sensitive ones and differences', () => {
    render([
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation' }),
      finding({ id: 'c', fieldLabel: 'Passport Number', sensitive: true }),
      finding({ id: 'd', fieldLabel: 'City', difference: { current: 'Chittagong' } }),
      finding({ id: 'e', fieldLabel: 'Employer', clear: false }),
    ]);
    const bulk = host.querySelector('.document-findings-bulk');
    expect(bulk?.querySelector('button')?.textContent).toBe('Accept 2 Clear Details');
    const ids = [...(bulk?.querySelectorAll('input[name="proposalId"]') ?? [])].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(ids).toEqual(['a', 'b']);
    expect(host.querySelector('.badge.badge-neutral')?.textContent).toBe('Sensitive');
  });

  it('does not offer the shortcut for a single clear detail, or when saving is not allowed', () => {
    render([finding({ id: 'a', fieldLabel: 'Given Name' })]);
    expect(host.querySelector('.document-findings-bulk')).toBeNull();
    render(
      [
        finding({ id: 'a', fieldLabel: 'Given Name' }),
        finding({ id: 'b', fieldLabel: 'Occupation' }),
      ],
      false,
    );
    expect(host.querySelector('.document-findings-bulk')).toBeNull();
    // Without consent nothing can be saved, but skipping still works.
    expect(host.textContent).toContain(
      'Turn on processing on Home to save details to your profile.',
    );
    expect(host.querySelector('button[value="approve"]')).toBeNull();
    expect(host.querySelectorAll('button[value="reject"]')).toHaveLength(2);
  });

  it('asks which value is right when the profile differs, and wants a date when both are right', () => {
    render([
      finding({
        id: 'd',
        fieldLabel: 'City',
        value: 'Dhaka',
        difference: { current: 'Chittagong' },
      }),
    ]);
    const fieldset = host.querySelector('fieldset.finding-difference');
    expect(fieldset?.querySelector('legend')?.textContent).toBe(
      'Your profile has Chittagong. Which is right?',
    );
    const options = [...(fieldset?.querySelectorAll('label') ?? [])].map(
      (label) => label.textContent,
    );
    expect(options).toEqual([
      'Use This Document’s Value',
      'Both Are Right, It Changed',
      'Keep My Current Value',
    ]);
    expect(host.querySelector('input[name="effectiveFrom"]')).toBeNull();
    act(() => (fieldset?.querySelector('input[value="changed"]') as HTMLInputElement).click());
    const date = host.querySelector('input[name="effectiveFrom"]') as HTMLInputElement;
    expect(date.required).toBe(true);
    expect(host.querySelector('button[value="approve"]')?.textContent).toBe('Save My Choice');
  });

  it('says plainly when a quote was not found, and when a reading fits no detail', () => {
    render([
      finding({
        id: 'u',
        fieldLabel: 'Family Name',
        clear: true,
        evidence: [{ snippet: 'Rahmaan', verified: false }],
      }),
      finding({
        id: 'x',
        fieldLabel: 'Mystery',
        type: 'UNMAPPED',
        fieldKey: null,
        value: 'mystery',
      }),
    ]);
    const [unverified, unmapped] = [...host.querySelectorAll('.finding-card')];
    expect(unverified?.querySelector('.badge')?.textContent).toBe('Please Check');
    expect(unverified?.textContent).toContain(
      'We could not find these exact words in the document.',
    );
    expect(unmapped?.querySelector('h4')?.textContent).toBe('Detail We Could Not Place');
    expect(unmapped?.querySelector('button[value="approve"]')).toBeNull();
  });

  it('lets a person skip without answering the question, and names each button for screen readers', () => {
    render([finding({ id: 'd', fieldLabel: 'City', difference: { current: 'Chittagong' } })]);
    const skipForm = host.querySelector('form.finding-skip');
    expect(skipForm?.querySelector('input[name="resolution"]')).toBeNull();
    expect(skipForm?.querySelector('button')?.getAttribute('aria-label')).toBe('Skip: City');
    expect(host.querySelector('button[value="approve"]')?.getAttribute('aria-label')).toBe(
      'Save My Choice: City',
    );
  });
});
