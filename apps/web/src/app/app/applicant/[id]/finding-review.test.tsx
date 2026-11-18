// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WAL2: Check What We Found as compact rows (owner decision 17 Nov 2026). Ordinary details are one
 * row each with Accept for a clear one; Sensitive details and details that differ from the profile
 * are decided one at a time; Sensitive values stay hidden until opened; the bulk Accept sits in an
 * accept bar at the end. Presentation only: the same server actions and the same form fields.
 */

vi.mock('./actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));

const { DocumentFindings } = await import('./ai-review');
const actions = await import('./actions');
type Finding = Parameters<typeof DocumentFindings>[0]['proposals'][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(actions.decideProposalAction).mockReset();
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

const MIXED: readonly Finding[] = [
  finding({ id: 'given', fieldLabel: 'Given Name', value: 'Ayesha' }),
  finding({ id: 'job', fieldLabel: 'Occupation', value: 'Engineer' }),
  finding({ id: 'city', fieldLabel: 'City', value: 'Dhaka', clear: false }),
  finding({
    id: 'passport',
    fieldLabel: 'Passport Number',
    value: 'A1234567',
    evidence: [{ snippet: 'A1234567', verified: true }],
    sensitive: true,
  }),
  finding({
    id: 'birth',
    fieldLabel: 'Date of Birth',
    value: '1990-03-14',
    evidence: [{ snippet: '14 MAR 1990', verified: true }],
    sensitive: true,
    difference: { current: null },
  }),
];

function render(proposals: readonly Finding[], canApprove = true) {
  act(() =>
    root.render(
      <DocumentFindings applicantId="a1" canApprove={canApprove} proposals={proposals} />,
    ),
  );
}

const rowTitles = () =>
  [...host.querySelectorAll('.finding-row .expandable-section-title')].map((h) => h.textContent);

describe('Check What We Found: compact rows', () => {
  it('counts the details in one line: how many, how many clear, how many to check', () => {
    render(MIXED);
    expect(host.querySelector('.document-findings-metric')?.textContent).toBe(
      '5 details, 4 clear, 1 to check',
    );
  });

  it('shows each ordinary detail as one row with its value and the Suggested picture', () => {
    render(MIXED);
    expect(rowTitles()).toEqual(['City', 'Given Name', 'Occupation']);
    const row = [...host.querySelectorAll('.finding-row')].find((r) =>
      r.textContent?.includes('Given Name'),
    ) as HTMLElement;
    expect(row.querySelector('.expandable-section-summary')?.textContent).toBe('Ayesha');
    expect(row.querySelector('.status-picture, .explain-tip')).not.toBeNull();
    expect(row.textContent).toContain('Suggested');
    // The full card is there, closed, for Check: change the value or skip it.
    expect(row.querySelector('details .finding-card')).not.toBeNull();
    expect(row.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('offers Accept on the row for a clear detail only, and it sends the plain approve', async () => {
    vi.mocked(actions.decideProposalAction).mockResolvedValue({ ok: true, message: 'Saved.' });
    render(MIXED);
    const accepts = [...host.querySelectorAll('.finding-row-accept-button')] as HTMLButtonElement[];
    expect(accepts.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Accept: Given Name',
      'Accept: Occupation',
    ]);
    await act(async () => {
      accepts[0]?.click();
    });
    const data = vi.mocked(actions.decideProposalAction).mock.calls[0]?.[1] as FormData;
    expect(data.get('proposalId')).toBe('given');
    expect(data.get('proposalAction')).toBe('approve');
    expect(data.has('correctedValue')).toBe(false);
  });

  it('never offers row Accept without permission to process details', () => {
    render(MIXED, false);
    expect(host.querySelector('.finding-row-accept-button')).toBeNull();
  });

  it('keeps the bulk Accept in an accept bar after every detail, counting clear ordinary ones only', () => {
    render(MIXED);
    const bar = host.querySelector('.document-findings > .finding-accept-bar');
    expect(bar).not.toBeNull();
    expect(bar?.classList.contains('document-findings-bulk')).toBe(true);
    expect(bar?.querySelector('button')?.textContent).toBe('Accept 2 Clear Details');
    expect(host.querySelector('.document-findings')?.lastElementChild).toBe(bar);
  });
});

describe('Check What We Found: Sensitive and conflicting details, one at a time', () => {
  it('takes only Sensitive and conflicting details one at a time, never ordinary ones', async () => {
    render(MIXED);
    await act(async () => undefined);
    const steps = host.querySelector('.finding-steps') as HTMLElement;
    expect(steps.querySelector('h4')?.textContent).toBe('Decide One at a Time');
    const cards = [...steps.querySelectorAll('.finding-card-head h5')].map((h) => h.textContent);
    expect(cards).toEqual(['Date of Birth', 'Passport Number']);
    expect(rowTitles()).not.toContain('Passport Number');
    expect(rowTitles()).not.toContain('Date of Birth');
  });

  it('shows one at a time with 1 of 2, Back and Skip for Now, and Skip for Now saves nothing', async () => {
    render(MIXED);
    await act(async () => undefined);
    const steps = host.querySelector('.finding-steps') as HTMLElement;
    const visible = () =>
      [...steps.querySelectorAll('.finding-steps-list > li')]
        .filter((li) => !(li as HTMLElement).hidden)
        .map((li) => li.querySelector('.finding-card-head h5')?.textContent);
    expect(steps.querySelector('.finding-steps-count')?.textContent).toBe('1 of 2');
    expect(visible()).toEqual(['Date of Birth']);
    const [back, skip] = [
      ...steps.querySelectorAll('.finding-steps-nav button'),
    ] as HTMLButtonElement[];
    expect(back?.textContent).toBe('Back');
    expect(back?.getAttribute('aria-disabled')).toBe('true');
    expect(skip?.textContent).toBe('Skip for Now');
    await act(async () => skip?.click());
    expect(visible()).toEqual(['Passport Number']);
    expect(steps.querySelector('.finding-steps-count')?.textContent).toBe('2 of 2');
    expect(actions.decideProposalAction).not.toHaveBeenCalled();
    await act(async () => back?.click());
    expect(visible()).toEqual(['Date of Birth']);
  });

  it('lists every detail to decide before the page script runs, so nothing is out of reach without it', () => {
    const html = renderToString(<DocumentFindings applicantId="a1" canApprove proposals={MIXED} />);
    const steps = html.slice(html.indexOf('finding-steps'));
    expect(steps).toContain('Date of Birth');
    expect(steps).toContain('Passport Number');
    expect(html).not.toContain('finding-steps-nav');
    expect(html).not.toMatch(/<li[^>]*hidden/);
  });
});

describe('Check What We Found: Sensitive values stay hidden until opened', () => {
  it('hides the value, the quote and the field until Value Found is opened', () => {
    const html = renderToString(
      <DocumentFindings applicantId="a1" canApprove proposals={[MIXED[3] as Finding]} />,
    );
    // The detail's name and the mask show; the value sits only inside the closed section.
    expect(html).toContain('Passport Number');
    expect(html).toMatch(
      /<details class="expandable-section-details"><summary[^>]*>.*Value Found.*••••••••/s,
    );
    const closedBefore = html.slice(0, html.indexOf('Value Found'));
    expect(closedBefore).not.toContain('A1234567');
  });

  it('opens with the native control, showing the value to save and the words found', () => {
    render([MIXED[3] as Finding]);
    const section = host.querySelector('.finding-masked details') as HTMLDetailsElement;
    expect(section.open).toBe(false);
    expect(section.querySelector('input[name="correctedValue"]')).not.toBeNull();
    expect(section.querySelector('.finding-source')?.textContent).toContain('A1234567');
  });

  it('asks which is right for a conflict without showing the hidden profile value, as large choices', () => {
    render([MIXED[4] as Finding]);
    const fieldset = host.querySelector('fieldset.finding-difference') as HTMLFieldSetElement;
    expect(fieldset.classList.contains('finding-choice-tiles')).toBe(true);
    expect(fieldset.querySelector('legend')?.textContent).toBe(
      'Your profile already has a different value for this, hidden here to keep it private. Which is right?',
    );
    expect(
      [...fieldset.querySelectorAll('input[name="resolution"]')].map(
        (i) => (i as HTMLInputElement).value,
      ),
    ).toEqual(['use_document', 'changed', 'keep']);
  });

  it('never masks an ordinary detail', () => {
    render([MIXED[0] as Finding]);
    expect(host.querySelector('.finding-masked')).toBeNull();
    expect(host.textContent).toContain('Ayesha');
  });
});

describe('Check What We Found: review fixes (WAL2 code review)', () => {
  it('never shows a profile value on a masked card, even if one were sent', () => {
    render([
      finding({
        id: 's',
        fieldLabel: 'Passport Number',
        value: 'A1234567',
        sensitive: true,
        difference: { current: 'B7654321' },
      }),
    ]);
    expect(host.textContent).not.toContain('B7654321');
    expect(host.querySelector('legend')?.textContent).toContain('hidden here to keep it private');
  });

  it('keeps the consent note in view on a masked card, without the value', () => {
    render(
      [finding({ id: 's', fieldLabel: 'Passport Number', value: 'A1234567', sensitive: true })],
      false,
    );
    const outside = [...host.querySelectorAll('.finding-card > p')]
      .map((p) => p.textContent)
      .join(' ');
    expect(outside).toContain('Let VisaStack Process My Details');
    expect(outside).not.toContain('A1234567');
  });

  it('uses one meaning of clear: words not found in the document are never accepted in bulk', () => {
    render([
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Family Name' }),
      finding({ id: 'c', fieldLabel: 'Occupation', evidence: [{ snippet: 'x', verified: false }] }),
    ]);
    expect(host.querySelector('.finding-accept-bar button')?.textContent).toBe(
      'Accept 2 Clear Details',
    );
    expect(host.querySelector('.document-findings-metric')?.textContent).toBe(
      '3 details, 2 clear, 1 to check',
    );
    const row = [...host.querySelectorAll('.finding-row')].find((r) =>
      r.textContent?.includes('Occupation'),
    ) as HTMLElement;
    expect(row.querySelector('.finding-row-check')?.textContent).toBe('Please Check');
    expect(row.querySelector('.finding-row-accept-button')).toBeNull();
  });

  it('moves focus to the next detail when the one shown is decided', async () => {
    const decide = [
      finding({ id: 'x', fieldLabel: 'Passport Number', sensitive: true }),
      finding({ id: 'y', fieldLabel: 'National ID Number', sensitive: true }),
      finding({ id: 'z', fieldLabel: 'Tax Number', sensitive: true }),
    ];
    render(decide);
    await act(async () => undefined);
    (document.activeElement as HTMLElement | null)?.blur();
    render(decide.slice(1));
    await act(async () => undefined);
    expect(document.activeElement?.closest('.finding-steps-list > li')?.textContent).toContain(
      'National ID Number',
    );
  });
});
