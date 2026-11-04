import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { chooseLegendId } from './response-choices';
import type { DocumentChoice } from './response-choices';

/**
 * Anticipate, never decide (CCD section 6): the reply form chooses a copy only when exactly one
 * finished copy fits and it is not the copy the agency just sent back, says so, and never sends
 * without the button. Each copy is told apart by its name, kind, time and checks, and the exact
 * file version the person saw is the one posted.
 */

vi.mock('./actions', () => ({ submitEvidenceResponseAction: vi.fn() }));

const { SubmitResponseForm, CONSENT_LINE } = await import('./submit-response-form');

const KEY = 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd';

const choice = (documentId: string, over: Partial<DocumentChoice> = {}): DocumentChoice => ({
  documentId,
  versionId: `version-of-${documentId}`,
  name: `Bank Statement ${documentId}`,
  kindLabel: 'Bank Statement',
  addedLabel: `${documentId} added`,
  scanLabel: 'Format Checked',
  scanDetail: 'The file type and structure were checked. It has not been scanned for viruses.',
  usable: true,
  sentBack: false,
  newest: false,
  ...over,
});

const render = (props: {
  kind: 'FIELD' | 'DOCUMENT';
  candidateFacts?: { factId: string; value: string }[];
  documentChoices?: DocumentChoice[];
  exactCopies?: boolean;
  documentsRead?: boolean;
  idempotencyKey?: string;
}) => {
  const html = renderToStaticMarkup(
    <SubmitResponseForm
      applicantId="a1"
      requestId="r1"
      kind={props.kind}
      candidateFacts={props.candidateFacts ?? []}
      documentChoices={props.documentChoices ?? []}
      idempotencyKey={props.idempotencyKey ?? KEY}
      exactCopies={props.exactCopies ?? true}
      documentsRead={props.documentsRead ?? true}
    />,
  );
  const page = new JSDOM(html).window.document;
  const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  return {
    page,
    html,
    text: page.body.textContent ?? '',
    radios,
    chosen: radios
      .filter((r) => r.checked)
      .map((r) => r.closest('label')?.querySelector('.evidence-pick-name')?.textContent),
    sent: page.querySelector<HTMLInputElement>('input[name="documentId"], input[name="factId"]')
      ?.value,
    version: page.querySelector<HTMLInputElement>('input[name="documentVersionId"]')?.value,
    key: page.querySelector<HTMLInputElement>('input[name="idempotencyKey"]')?.value,
    labels: [...page.querySelectorAll('label.request-choice')].map((l) => l.textContent ?? ''),
    button: page.querySelector('button[type="submit"]'),
  };
};

describe('the evidence reply form anticipates, and the person decides', () => {
  it('chooses the only finished copy that fits, and says so', () => {
    const form = render({
      kind: 'DOCUMENT',
      documentChoices: [choice('d1'), choice('d2', { usable: false })],
    });
    expect(form.chosen).toEqual(['Bank Statement d1']);
    expect(form.sent).toBe('d1');
    expect(form.text).toContain('This is the only one that fits, so it is already chosen.');
  });

  it('chooses nothing when several fit, and asks the person to choose', () => {
    const form = render({ kind: 'DOCUMENT', documentChoices: [choice('d1'), choice('d2')] });
    expect(form.chosen).toEqual([]);
    expect(form.sent).toBe('');
    expect(form.text).toContain('Choose which one to send.');
    expect(form.text).not.toContain('so it is already chosen');
  });

  it('never chooses the copy the agency just sent back, even when it is the only one', () => {
    const form = render({
      kind: 'DOCUMENT',
      documentChoices: [choice('d1', { sentBack: true })],
    });
    expect(form.chosen).toEqual([]);
    expect(form.sent).toBe('');
    expect(form.version).toBeUndefined();
    expect(form.text).toContain('Sent Back by the Agency');
    expect(form.text).toContain(
      'The copy the agency sent back is marked. Choose another, or upload a clearer copy.',
    );
    expect(
      form.button?.getAttribute('aria-disabled') === 'true' ||
        form.button?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('chooses the one new usable copy after a sent back one, and leaves the rejected one unchosen', () => {
    const form = render({
      kind: 'DOCUMENT',
      documentChoices: [
        choice('d2', { newest: true }),
        choice('d1', { sentBack: true, usable: false }),
      ],
    });
    expect(form.chosen).toEqual(['Bank Statement d2']);
    expect(form.sent).toBe('d2');
  });

  it('chooses nothing when two usable copies exist and one was sent back', () => {
    const form = render({
      kind: 'DOCUMENT',
      documentChoices: [choice('d2', { newest: true }), choice('d1', { sentBack: true })],
    });
    expect(form.chosen).toEqual([]);
    expect(form.sent).toBe('');
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

  it('says nothing about a choice it did not make when no copy is ready yet', () => {
    const form = render({ kind: 'DOCUMENT', documentChoices: [choice('d1', { usable: false })] });
    expect(form.text).not.toContain('Choose which one to send.');
    expect(form.sent).toBe('');
    expect(form.text).not.toContain('so it is already chosen');
  });
});

describe('the copies are told apart, in words, in a group', () => {
  const two = [
    choice('d2', {
      name: 'Bank Statement',
      addedLabel: '3 Nov 2026, 10:05 GMT+6',
      newest: true,
    }),
    choice('d1', {
      name: 'Bank Statement',
      addedLabel: '27 Oct 2026, 14:32 GMT+6',
      scanLabel: 'Checked for Viruses',
    }),
  ];

  it('is a fieldset with a visible legend and a hint that describes the group', () => {
    const { page } = render({ kind: 'DOCUMENT', documentChoices: two });
    const fieldset = page.querySelector('fieldset');
    const legend = fieldset?.querySelector('legend');
    expect(legend?.textContent).toBe('Choose the Copy to Send');
    expect(legend?.classList.contains('sr-only')).toBe(false);
    expect(legend?.id).toBe(chooseLegendId('r1'));
    expect(legend?.getAttribute('tabindex')).toBe('-1');
    const hintId = fieldset?.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(page.getElementById(hintId ?? '')?.textContent).toBe('Choose which one to send.');
  });

  it('is a radio group on one name, so the arrow keys move between copies', () => {
    const { radios } = render({ kind: 'DOCUMENT', documentChoices: two });
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(['choice']));
    for (const radio of radios) expect(radio.closest('label')).not.toBeNull();
  });

  it('gives each copy its own words: kind, when it was added, how it was checked, never a code', () => {
    const { labels, text } = render({ kind: 'DOCUMENT', documentChoices: two });
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toContain('Bank Statement · Added 3 Nov 2026, 10:05 GMT+6 · Format Checked');
    expect(labels[0]).toContain('Newest');
    expect(labels[1]).toContain('Added 27 Oct 2026, 14:32 GMT+6 · Checked for Viruses');
    expect(text).not.toMatch(/CLEAN|QUARANTINED|PROCESSING|not ready yet/);
    expect(text).not.toMatch(/Version \d/);
  });

  it('shows a copy that cannot be sent as unavailable, with the plain reason beside it', () => {
    const { radios, text } = render({
      kind: 'DOCUMENT',
      documentChoices: [
        choice('d1', {
          usable: false,
          scanLabel: 'Held for Safety',
          scanDetail: 'The checks held this file back, so it cannot be opened.',
        }),
        choice('d2'),
      ],
    });
    expect(radios[0]?.disabled).toBe(true);
    expect(radios[1]?.disabled).toBe(false);
    expect(text).toContain('The checks held this file back, so it cannot be opened.');
  });
});

describe('what is posted', () => {
  it('posts the server-made retry key and the exact version of the chosen copy', () => {
    const form = render({ kind: 'DOCUMENT', documentChoices: [choice('d1')] });
    expect(form.key).toBe(KEY);
    expect(form.key?.length).toBeGreaterThanOrEqual(16);
    expect(form.sent).toBe('d1');
    expect(form.version).toBe('version-of-d1');
  });

  it('posts no version before any copy is chosen, or while exact copies are not kept', () => {
    expect(
      render({ kind: 'DOCUMENT', documentChoices: [choice('d1'), choice('d2')] }).version,
    ).toBeUndefined();
    const notKept = render({
      kind: 'DOCUMENT',
      documentChoices: [choice('d1')],
      exactCopies: false,
    });
    expect(notKept.version).toBeUndefined();
    expect(notKept.sent).toBe('d1');
  });

  it('says what sending means for the exact copy, only when exact copies are kept', () => {
    expect(
      render({ kind: 'DOCUMENT', documentChoices: [choice('d1')], exactCopies: true }).text,
    ).toContain(CONSENT_LINE);
    expect(
      render({ kind: 'DOCUMENT', documentChoices: [choice('d1')], exactCopies: false }).text,
    ).not.toContain('exact copy');
  });
});

describe('when there is nothing to choose', () => {
  it('says so and points to Documents when no copy of the kind exists', () => {
    const form = render({ kind: 'DOCUMENT', documentChoices: [] });
    expect(form.text).toContain('No copy of this document type can be sent right now.');
    expect(form.page.querySelector('a.btn')?.textContent).toBe('Open Documents');
    expect(form.page.querySelector('a.btn')?.getAttribute('href')).toBe(
      '/app/applicant/a1/documents',
    );
    expect(form.radios).toHaveLength(0);
  });

  it('tells the person the documents could not be loaded, as an alert, and offers nothing', () => {
    const form = render({ kind: 'DOCUMENT', documentChoices: [], documentsRead: false });
    expect(form.page.querySelector('[role="alert"]')?.textContent).toBe(
      'Your documents could not be loaded. Refresh to try again.',
    );
    expect(form.text).not.toContain('You have not uploaded');
    expect(form.radios).toHaveLength(0);
  });
});
