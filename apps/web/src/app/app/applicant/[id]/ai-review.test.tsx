// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));

const { DocumentFindings, ReadAgainButton } = await import('./ai-review');
const actions = await import('./actions');
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

  it('leaves a detail out of the shortcut once its value is changed', () => {
    render([
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation' }),
      finding({ id: 'c', fieldLabel: 'Employer' }),
    ]);
    const bulkButton = () => host.querySelector('.document-findings-bulk button')?.textContent;
    expect(bulkButton()).toBe('Accept 3 Clear Details');
    const input = host.querySelector('input[name="correctedValue"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(input, 'Changed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(bulkButton()).toBe('Accept 2 Clear Details');
    act(() => {
      setValue?.call(input, 'Value');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(bulkButton()).toBe('Accept 3 Clear Details');
  });

  it('keeps one-of-many records out of the shortcut, and never offers "it changed" for a fixed detail', () => {
    render([
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation' }),
      finding({ id: 'c', fieldLabel: 'City', repeating: true }),
      finding({
        id: 'd',
        fieldLabel: 'Date of Birth',
        fixed: true,
        difference: { current: '1990-01-05' },
      }),
    ]);
    expect(host.querySelector('.document-findings-bulk button')?.textContent).toBe(
      'Accept 2 Clear Details',
    );
    const options = [...host.querySelectorAll('fieldset.finding-difference label')].map(
      (label) => label.textContent,
    );
    expect(options).toEqual(['Use This Document’s Value', 'Keep My Current Value']);
  });

  it('does not reveal a hidden value, and says so plainly', () => {
    render([finding({ id: 'p', fieldLabel: 'Passport Number', difference: { current: null } })]);
    expect(host.querySelector('legend')?.textContent).toBe(
      'Your profile already has a different value for this, hidden here to keep it private. Which is right?',
    );
  });

  it('keeps the outcome on screen after the decided card is gone', async () => {
    vi.mocked(actions.decideProposalAction).mockResolvedValue({
      ok: true,
      message: 'Saved to your profile.',
    });
    render([finding({ id: 'a', fieldLabel: 'Given Name' })]);
    await act(async () => {
      (host.querySelector('button[value="approve"]') as HTMLButtonElement).click();
    });
    expect(actions.decideProposalAction).toHaveBeenCalledTimes(1);
    render([]);
    expect(host.querySelector('.finding-card')).toBeNull();
    expect(host.querySelector('output')?.textContent).toBe('Saved to your profile.');
  });

  it('holds every card while all clear details are being saved, so nothing is decided twice', async () => {
    vi.mocked(actions.decideProposalAction).mockClear();
    let finish: (value: { ok: boolean; message: string }) => void = () => undefined;
    vi.mocked(actions.acceptClearDetailsAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render([
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation' }),
    ]);
    const cardButtons = () =>
      [...host.querySelectorAll('.finding-card button')] as HTMLButtonElement[];
    expect(cardButtons().every((b) => b.getAttribute('aria-disabled') !== 'true')).toBe(true);
    await act(async () => {
      (host.querySelector('.document-findings-bulk button') as HTMLButtonElement).click();
    });
    expect(cardButtons().length).toBeGreaterThan(0);
    // Busy, not disabled: keyboard focus stays where it was.
    expect(
      cardButtons().every((b) => b.getAttribute('aria-disabled') === 'true' && !b.disabled),
    ).toBe(true);
    // Visible text and spoken names stay the same while held.
    const accept = host.querySelector('.finding-card button[value="approve"]') as HTMLButtonElement;
    expect(accept.textContent).toBe('Accept');
    expect(accept.getAttribute('aria-label')).toBe('Accept: Given Name');
    expect(host.querySelector('.finding-skip button')?.getAttribute('aria-label')).toBe(
      'Skip: Given Name',
    );
    // A click on a held card decides nothing.
    await act(async () => {
      accept.click();
      (host.querySelector('.finding-skip button') as HTMLButtonElement).click();
    });
    expect(actions.decideProposalAction).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ok: true, message: 'Saved 2 details to your profile.' });
    });
    expect(cardButtons().every((b) => b.getAttribute('aria-disabled') !== 'true')).toBe(true);
  });
});

describe('where each suggestion came from (S6)', () => {
  it('names the source under each suggestion, in plain words', () => {
    render([
      finding({ id: 'a', fieldLabel: 'Family Name', source: 'machine_readable' }),
      finding({ id: 'b', fieldLabel: 'City', source: 'document_text', clear: false }),
      finding({ id: 'c', fieldLabel: 'Occupation', source: 'ai_image', clear: false }),
      finding({ id: 'd', fieldLabel: 'Hobby', clear: false }),
    ]);
    const origin = (heading: string) =>
      [...host.querySelectorAll('.finding-card')]
        .find((card) => card.querySelector('h4')?.textContent === heading)
        ?.querySelector('.finding-origin')?.textContent;
    expect(origin('Family Name')).toContain('Read from the Machine-Readable Lines');
    expect(origin('Family Name')).toContain('No AI was used.');
    expect(origin('City')).toContain('Read from the Document');
    expect(origin('Occupation')).toContain('Read with AI');
    // A suggestion whose source is not known says nothing about it, rather than guessing.
    expect(origin('Hobby')).toBeUndefined();
  });

  it('uses the suggestion’s own sentence for the machine-readable lines, such as a country shown as a code', () => {
    render([
      finding({
        id: 'a',
        fieldLabel: 'Nationality',
        source: 'machine_readable',
        clear: false,
        rationale:
          "Read from the passport's machine-readable lines. The country is shown as the code the passport prints.",
      }),
    ]);
    expect(host.querySelector('.finding-origin')?.textContent).toContain(
      'The country is shown as the code the passport prints.',
    );
  });
});

describe('Read Again (S6)', () => {
  it('is one button that names itself, and says nothing about how it works', () => {
    act(() => root.render(<ReadAgainButton applicantId="a1" documentVersionId="v1" />));
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Read Again']);
    expect(
      [...host.querySelectorAll('input[type="hidden"]')].map((i) => [
        (i as HTMLInputElement).name,
        (i as HTMLInputElement).value,
      ]),
    ).toEqual([
      ['applicantId', 'a1'],
      ['documentVersionId', 'v1'],
    ]);
  });
});
