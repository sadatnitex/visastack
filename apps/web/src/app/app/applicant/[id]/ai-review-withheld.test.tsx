// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ESS1: on My Profile an AI app suggestion about a protected detail arrives with none of its words.
 * The card says so, Show asks the owner-only reveal action, and only then are the value, the app's
 * reason and the box drawn. Made-up values only.
 */

const reveal = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({
  decideProposalAction: vi.fn(),
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
vi.mock('./profile-reveal-actions', () => ({
  revealProfileValueAction: vi.fn(),
  revealSuggestionValueAction: reveal,
}));
const { AiProposalReview } = await import('./ai-review');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  reveal.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const WITHHELD = {
  id: 'proposal-1',
  type: 'FIELD_VALUE',
  fieldKey: 'passport_number',
  fieldLabel: 'Passport Number',
  value: null,
  confidence: 90,
  rationale: null,
  evidence: [],
  clear: false,
  sensitive: true,
  withheld: true,
  app: 'Claude (claude.ai)',
  difference: { current: null, undisclosed: true },
} as const;

function draw() {
  act(() =>
    root.render(<AiProposalReview applicantId="person-1" proposal={WITHHELD} canApprove />),
  );
}
const showButton = () =>
  [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Show the Value Found'),
  );

describe('a withheld suggestion (ESS1)', () => {
  it('draws no value and no box, and asks which value to keep without saying if they match', () => {
    draw();
    expect(container.querySelector('input[name="correctedValue"]')).toBeNull();
    expect(container.textContent).toContain('the value is not shown until you choose Show');
    expect(container.textContent).toContain(
      'Your profile already holds a value for this detail. Which should it keep?',
    );
    expect(showButton()?.textContent).toBe('Show the Value Found Passport Number');
  });

  it('opens the value, the reason and the box only on Show', async () => {
    reveal.mockResolvedValue({
      ok: true,
      value: 'X1234567',
      rationale: 'The person said so.',
      snippets: ['number X1234567'],
    });
    draw();
    await act(async () => showButton()?.click());
    expect(reveal).toHaveBeenCalledWith('person-1', 'proposal-1');
    expect(container.querySelector<HTMLInputElement>('input[name="correctedValue"]')?.value).toBe(
      'X1234567',
    );
    expect(container.textContent).toContain('The person said so.');
    expect(showButton()).toBeUndefined();
  });

  it('says so in place when the value cannot be opened, and keeps it hidden', async () => {
    reveal.mockResolvedValue({ ok: false });
    draw();
    const status = container.querySelector('output');
    expect(status?.textContent).toBe('');
    await act(async () => showButton()?.click());
    expect(container.querySelector('output')).toBe(status);
    expect(status?.textContent).toMatch(/could not be shown just now/);
    expect(container.querySelector('input[name="correctedValue"]')).toBeNull();
  });
});
