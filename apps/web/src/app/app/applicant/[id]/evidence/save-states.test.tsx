import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textOf } from '../../../../../lib/next-mocks.test-support';

/**
 * Saving, Saved at and Not saved (spec B09, "Saving and visibility"): each state of the two forms on
 * the evidence page says exactly what happened, in the person's time zone, and nothing it cannot know.
 */

const forced = vi.hoisted(() => ({
  value: undefined as
    | undefined
    | { state: { ok: boolean; message: string; savedAt?: string }; pending: boolean },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      forced.value
        ? [forced.value.state, () => undefined, forced.value.pending]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: vi.fn(),
  askAboutRequestItemAction: vi.fn(),
}));

const { SubmitResponseForm } = await import('./submit-response-form');
const { AskAboutItemForm } = await import('./ask-about-item-form');

const AT = '2026-10-27T08:32:00.000Z';

const respond = (props: { awaiting?: boolean } = {}) =>
  renderToStaticMarkup(
    <SubmitResponseForm
      applicantId="a1"
      requestId="r1"
      kind="FIELD"
      candidateFacts={[{ factId: 'f1', value: 'A1234567' }]}
      candidateDocuments={[]}
      timeZone="Asia/Dhaka"
      {...props}
    />,
  );

const ask = () =>
  renderToStaticMarkup(
    <AskAboutItemForm
      applicantId="a1"
      missionId="m1"
      requestId="r1"
      maxLength={500}
      timeZone="Asia/Dhaka"
    />,
  );

function show(state: typeof forced.value) {
  forced.value = state;
}

describe.each([
  ['answering a request', respond],
  ['asking a question', ask],
])('%s', (_name, render) => {
  it('says nothing before anything is sent', () => {
    show(undefined);
    const text = textOf(render());
    expect(text).not.toMatch(/Saving|Saved at|Not saved/);
  });

  it('says Saving while the server works', () => {
    show({ state: { ok: true, message: '' }, pending: true });
    expect(textOf(render())).toContain('Saving…');
  });

  it('says Not saved with the reason and offers Try Again, in the alert region', () => {
    show({
      state: { ok: false, message: 'This request is not awaiting a submission.' },
      pending: false,
    });
    const html = render();
    expect(textOf(html)).toContain(
      'Not saved. This request is not awaiting a submission. Try again.',
    );
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Try Again');
  });
});

describe('Saved at', () => {
  it('names the confirmed time in the traveller zone once the answer is saved, after the form is gone', () => {
    show({
      state: { ok: true, message: 'The agency will review it.', savedAt: AT },
      pending: false,
    });
    const html = respond({ awaiting: false });
    expect(textOf(html)).toBe('Saved at 14:32 GMT+6. The agency will review it.');
    expect(html).not.toContain('<form');
  });

  it('does not show an earlier Saved at beside a fresh Submit button (the agency sent it back)', () => {
    show({
      state: { ok: true, message: 'The agency will review it.', savedAt: AT },
      pending: false,
    });
    const text = textOf(respond({ awaiting: true }));
    expect(text).not.toContain('Saved at');
    expect(text).toContain('Send to the Agency');
  });

  it('shows nothing for a request that no longer waits and has not been answered in this visit', () => {
    show(undefined);
    expect(respond({ awaiting: false })).toBe('');
    show({ state: { ok: false, message: 'Nope.' }, pending: false });
    expect(respond({ awaiting: false })).toBe('');
  });

  it('confirms a saved question and tells the person where the agency will answer', () => {
    show({
      state: { ok: true, message: 'The agency can read it in the case notes.', savedAt: AT },
      pending: false,
    });
    expect(textOf(ask())).toContain(
      'Saved at 14:32 GMT+6. The agency can read it in the case notes.',
    );
  });
});

describe('the question box', () => {
  it('says who can read the question before anything is sent, and bounds its length', () => {
    show(undefined);
    const html = ask();
    const text = textOf(html);
    expect(text).toContain(
      'Everyone who can read the shared notes on this case will see your question.',
    );
    expect(text).toContain('Do not type passport, bank or card numbers.');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('name="question"');
    // The explanation is tied to the box for screen readers.
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${described}"`);
  });
});
