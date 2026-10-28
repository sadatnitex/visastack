import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Anticipate, never decide (CCD section 6): the reply form chooses an item only when exactly one
 * finished item fits, says so, and never sends without the button.
 */

vi.mock('./actions', () => ({ submitEvidenceResponseAction: vi.fn() }));

const { SubmitResponseForm } = await import('./submit-response-form');

const doc = (documentId: string, usable = true) => ({
  documentId,
  displayName: `Bank Statement ${documentId}`,
  usable,
  statusLabel: usable ? 'Ready' : 'Processing',
});

const render = (props: {
  kind: 'FIELD' | 'DOCUMENT';
  candidateFacts?: { factId: string; value: string }[];
  candidateDocuments?: ReturnType<typeof doc>[];
}) => {
  const html = renderToStaticMarkup(
    <SubmitResponseForm
      applicantId="a1"
      requestId="r1"
      kind={props.kind}
      candidateFacts={props.candidateFacts ?? []}
      candidateDocuments={props.candidateDocuments ?? []}
    />,
  );
  const page = new JSDOM(html).window.document;
  return {
    text: page.body.textContent ?? '',
    chosen: [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter((r) => r.checked)
      .map((r) => r.parentElement?.textContent),
    sent: page.querySelector<HTMLInputElement>('input[name="documentId"], input[name="factId"]')
      ?.value,
    button: page.querySelector('button[type="submit"]'),
  };
};

describe('the evidence reply form anticipates, and the person decides', () => {
  it('chooses the only finished document that fits, and says so', () => {
    const form = render({ kind: 'DOCUMENT', candidateDocuments: [doc('d1'), doc('d2', false)] });
    expect(form.chosen).toEqual(['Bank Statement d1']);
    expect(form.sent).toBe('d1');
    expect(form.text).toContain('This is the only one that fits, so it is already chosen.');
  });

  it('chooses nothing when several fit, and asks the person to choose', () => {
    const form = render({ kind: 'DOCUMENT', candidateDocuments: [doc('d1'), doc('d2')] });
    expect(form.chosen).toEqual([]);
    expect(form.sent).toBe('');
    expect(form.text).toContain('Choose which one to send.');
    expect(form.text).not.toContain('so it is already chosen');
  });

  it('treats details the same way', () => {
    expect(
      render({ kind: 'FIELD', candidateFacts: [{ factId: 'f1', value: 'A1234567' }] }).sent,
    ).toBe('f1');
    expect(
      render({
        kind: 'FIELD',
        candidateFacts: [
          { factId: 'f1', value: 'A1234567' },
          { factId: 'f2', value: 'B7654321' },
        ],
      }).sent,
    ).toBe('');
  });

  it('chooses nothing when no finished document fits yet', () => {
    const form = render({ kind: 'DOCUMENT', candidateDocuments: [doc('d1', false)] });
    expect(form.sent).toBe('');
    expect(form.text).not.toContain('so it is already chosen');
  });
});
