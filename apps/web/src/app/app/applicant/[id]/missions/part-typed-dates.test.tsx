// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseCountryOptions, casePurposeGroups } from '../../../../../lib/case-choices';

/**
 * A date box holding a part-typed date sends nothing, so both case forms stop at submit, say so
 * beside the box in the server's own words and move focus to it (form-dates.ts).
 */

const actions = vi.hoisted(() => ({ create: vi.fn(), again: vi.fn() }));
vi.mock('./actions', () => ({ createMissionAction: actions.create }));
vi.mock('./prepare-again/actions', () => ({ prepareCaseAgainAction: actions.again }));

const { CreateMissionForm } = await import('./create-mission-form');
const { PrepareAgainForm } = await import('./prepare-again/prepare-again-form');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  actions.create.mockResolvedValue({ ok: true, message: '' });
  actions.again.mockResolvedValue({ ok: true, message: '' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** jsdom does not parse date boxes, so the browser's "part-typed" flag is set by hand. */
function partType(name: string) {
  const box = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!box) throw new Error(`no ${name} box`);
  Object.defineProperty(box, 'validity', {
    configurable: true,
    value: { ...box.validity, badInput: true, valid: false },
  });
  return box;
}

async function submit() {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  await act(async () => {
    form.requestSubmit();
  });
}

describe.each([
  [
    'Start a Case',
    () => (
      <CreateMissionForm
        applicantId="a-1"
        countries={caseCountryOptions()}
        purposes={casePurposeGroups()}
      />
    ),
    actions.create,
  ],
  [
    'Start a New Case from This One',
    () => (
      <PrepareAgainForm
        applicantId="a-1"
        fromMissionId="m-1"
        defaultTitle="Japan trip 2027"
        expectedPackVersionId=""
        checklistNote="No checklist."
        groups={[]}
        sharingQuestions={[]}
      />
    ),
    actions.again,
  ],
] as const)('%s', (_name, view, action) => {
  it('stops at a part-typed date, says so beside the box and focuses it', async () => {
    act(() => root.render(view()));
    const box = partType('targetDeadline');
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    const messageId = box.getAttribute('aria-describedby')?.split(' ').at(-1) ?? '';
    expect(document.getElementById(messageId)?.textContent).toBe(
      'Enter a full date: day, month and year.',
    );
    expect(document.activeElement).toBe(box);
  });

  it('sends the form when no date is part-typed', async () => {
    act(() => root.render(view()));
    const title = container.querySelector<HTMLInputElement>('input[name="title"]');
    if (title) title.value = 'Japan trip 2027';
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});
