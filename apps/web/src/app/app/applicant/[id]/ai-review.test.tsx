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
      'Turn on Let VisaStack Process My Details on Home to save details to your profile.',
    );
    // The words that say where to turn it on are a working link to that switch on Home.
    expect(host.querySelector('a[href="/app#permissions"]')?.textContent).toBe('Home');
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

describe('what accepting clear details affects', () => {
  const BATCH = {
    items: [
      {
        label: 'Employer Name',
        summary: {
          href: '/app/applicant/a1/change-impact?detail=f1',
          actionRequired: 1,
          reviewRecommended: 0,
          unknown: 0,
        },
      },
    ],
    more: 2,
  };
  const two = [
    finding({ id: 'a', fieldLabel: 'Given Name' }),
    finding({ id: 'b', fieldLabel: 'Occupation' }),
  ];
  const notices = () => host.querySelectorAll('output.ci-notice');

  async function acceptBoth() {
    vi.mocked(actions.acceptClearDetailsAction).mockResolvedValue({
      ok: true,
      message: 'Saved 2 details to your profile.',
      changeImpactBatch: BATCH,
    });
    await act(async () => {
      (host.querySelector('.document-findings-bulk button') as HTMLButtonElement).click();
    });
  }

  it('shows it once while other readings are still waiting for a decision', async () => {
    render([...two, finding({ id: 'c', fieldLabel: 'City', clear: false })]);
    await acceptBoth();
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toContain('What This Change Affects');
    expect(notices()[0]?.textContent).toContain('Employer Name');
    expect(notices()[0]?.textContent).toContain('and 2 more details may also affect something.');
  });

  it('shows it once when nothing is left to decide', async () => {
    render(two);
    await acceptBoth();
    render([]);
    expect(host.querySelector('.finding-card')).toBeNull();
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toContain('Employer Name');
  });

  it('says the check did not happen after a saved detail, with the detail still saved', async () => {
    vi.mocked(actions.decideProposalAction).mockResolvedValue({
      ok: true,
      message: 'Saved to your profile.',
      changeImpactUnavailable: true,
    });
    render([finding({ id: 'a', fieldLabel: 'Given Name' })]);
    await act(async () => {
      (host.querySelector('button[value="approve"]') as HTMLButtonElement).click();
    });
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toBe(
      'We could not work out what this change affects this time. Your change is saved.',
    );
    render([]);
    expect(notices()).toHaveLength(1);
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
    expect(origin('Family Name')).toContain(
      'Read from the Two Lines at the Bottom of the Passport',
    );
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

  it('can name itself for a file that was never read', () => {
    act(() =>
      root.render(
        <ReadAgainButton applicantId="a1" documentVersionId="v1" label="Read This Document" />,
      ),
    );
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Read This Document',
    ]);
  });
});

describe('the date a changed detail took effect, from the document’s own issue date', () => {
  const passportNumber = (overrides: Partial<Finding> = {}) =>
    finding({
      id: 'pn',
      fieldKey: 'passport_number',
      fieldLabel: 'Passport Number',
      value: 'A1234567',
      difference: { current: 'OLD000001' },
      ...overrides,
    });

  function chooseChanged(): HTMLInputElement {
    act(() => (host.querySelector('input[value="changed"]') as HTMLInputElement).click());
    return host.querySelector('input[name="effectiveFrom"]') as HTMLInputElement;
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const noteOf = (input: HTMLInputElement) =>
    host.querySelector(`[id="${input.getAttribute('aria-describedby')}"]`)?.textContent;

  it('fills the date from the one issue date read from the same document, and says where it came from', () => {
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    const date = chooseChanged();
    expect(date.value).toBe('2024-03-12');
    expect(date.required).toBe(true);
    expect(noteOf(date)).toMatch(
      /^Taken from this document’s issue date, (12 Mar 2024|Mar 12, 2024)\. Change it if it is wrong\.$/,
    );
  });

  it('never saves it until the person presses Save My Choice, and then sends exactly what is shown', async () => {
    vi.mocked(actions.decideProposalAction).mockClear();
    vi.mocked(actions.decideProposalAction).mockResolvedValue({ ok: true, message: 'Saved.' });
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    chooseChanged();
    expect(actions.decideProposalAction).not.toHaveBeenCalled();
    await act(async () => {
      (host.querySelector('button[value="approve"]') as HTMLButtonElement).click();
    });
    expect(actions.decideProposalAction).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(actions.decideProposalAction).mock.calls[0]?.[1] as FormData;
    expect(sent.get('resolution')).toBe('changed');
    expect(sent.get('effectiveFrom')).toBe('2024-03-12');
  });

  it('is not filled while the person has not chosen "it changed"', () => {
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    expect(host.querySelector('input[name="effectiveFrom"]')).toBeNull();
  });

  it('lets the person override it, and what they typed is what is sent', async () => {
    vi.mocked(actions.decideProposalAction).mockClear();
    vi.mocked(actions.decideProposalAction).mockResolvedValue({ ok: true, message: 'Saved.' });
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    const date = chooseChanged();
    type(date, '2023-12-01');
    expect(date.value).toBe('2023-12-01');
    expect(noteOf(date)).toMatch(
      /^This document’s issue date is (12 Mar 2024|Mar 12, 2024)\. Use it, or enter the date it changed\.$/,
    );
    await act(async () => {
      (host.querySelector('button[value="approve"]') as HTMLButtonElement).click();
    });
    const sent = vi.mocked(actions.decideProposalAction).mock.calls[0]?.[1] as FormData;
    expect(sent.get('effectiveFrom')).toBe('2023-12-01');
  });

  it('keeps what the person typed when they switch choices and come back', () => {
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    type(chooseChanged(), '2023-12-01');
    act(() => (host.querySelector('input[value="keep"]') as HTMLInputElement).click());
    expect(chooseChanged().value).toBe('2023-12-01');
  });

  it('stays empty, with a plain reason, when no usable issue date was found', () => {
    const cases: [NonNullable<Finding['issueDate']>, string][] = [
      [
        { status: 'none' },
        'We have no issue date from this document to use. Enter the date it changed.',
      ],
      [
        { status: 'unreadable' },
        'We could not read an issue date from this document. Enter the date it changed.',
      ],
      [
        { status: 'conflict' },
        'We found more than one issue date on this document, so none was chosen. Enter the date it changed.',
      ],
      [
        { status: 'future' },
        'The issue date we read is in the future, so it was not used. Enter the date it changed.',
      ],
    ];
    for (const [issueDate, line] of cases) {
      render([passportNumber({ issueDate })]);
      const date = chooseChanged();
      expect(date.value).toBe('');
      expect(date.required).toBe(true);
      expect(noteOf(date)).toBe(line);
      act(() => root.render(<div />));
    }
  });

  it('says nothing, and fills nothing, for a detail whose document has no issue date', () => {
    render([
      finding({
        id: 'oc',
        fieldKey: 'occupation',
        fieldLabel: 'Occupation',
        value: 'Engineer',
        difference: { current: 'Teacher' },
      }),
    ]);
    const date = chooseChanged();
    expect(date.value).toBe('');
    expect(date.getAttribute('aria-describedby')).toBeNull();
  });

  it('names its note for screen readers and keeps the date within today', () => {
    render([passportNumber({ issueDate: { status: 'found', date: '2024-03-12' } })]);
    const date = chooseChanged();
    expect(date.getAttribute('aria-describedby')).toBeTruthy();
    expect(date.max).toBe(new Date().toISOString().slice(0, 10));
  });

  it('follows the value being saved when the reading is itself an issue date', () => {
    render([
      finding({
        id: 'pi',
        fieldKey: 'passport_issue_date',
        fieldLabel: 'Passport Issue Date',
        value: '2024-03-12',
        editor: { kind: 'date' },
        difference: { current: '2019-01-05' },
        issueDate: { status: 'found', date: '2024-03-12' },
        ownIssueDate: true,
      }),
    ]);
    expect(chooseChanged().value).toBe('2024-03-12');
    type(host.querySelector('input[name="correctedValue"]') as HTMLInputElement, '2024-03-14');
    expect((host.querySelector('input[name="effectiveFrom"]') as HTMLInputElement).value).toBe(
      '2024-03-14',
    );
    // The day is now the person's own entry, so the note never credits the document with it.
    expect(host.textContent).not.toContain('Taken from this document');
  });
});
