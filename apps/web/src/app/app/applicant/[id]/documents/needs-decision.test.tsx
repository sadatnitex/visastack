import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./needs-decision-actions', () => ({
  decideRelationAction: async () => ({ ok: true, message: '' }),
  needsDecisionAction: async () => ({ ok: true, message: '' }),
}));

const { NeedsDecision } = await import('./needs-decision');

const RELATION = {
  kind: 'relation' as const,
  proposalId: 'p1',
  documentId: 'd2',
  title: 'Passport, Anna (New)',
  relatedDocumentId: 'd1',
  relatedTitle: 'Passport, Anna',
  relation: 'RENEWED' as const,
  labels: { newDocument: 'Renewed', relatedDocument: 'Earlier Copy' },
};

describe('the files that need one decision (UMPE P3)', () => {
  it('shows nothing at all when nothing needs a decision and nothing is linked', () => {
    expect(renderToStaticMarkup(<NeedsDecision applicantId="a1" items={[]} linked={[]} />)).toBe(
      '',
    );
  });

  it('says what each suggestion means and what Confirm does, with a named button per file', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision applicantId="a1" items={[RELATION]} linked={[]} />,
    );
    expect(html).toContain('Needs One Decision');
    expect(html).toContain('Passport, Anna (New) looks like a renewal of Passport, Anna.');
    expect(html).toContain('Confirm keeps both files and marks the older one as the Earlier Copy.');
    expect(html).toContain('aria-label="Confirm: Passport, Anna (New)"');
    expect(html).toContain('aria-label="Keep Separate: Passport, Anna (New)"');
    expect(html).toContain('>Renewed<');
    expect(html).toContain('name="decision"');
    expect(html).toContain('value="CONFIRM"');
    expect(html).toContain('value="KEEP_SEPARATE"');
  });

  it('never claims a duplicate is removed: Confirm only notes it', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[
          {
            ...RELATION,
            relation: 'EXACT_DUPLICATE',
            labels: { newDocument: 'Same as an Existing Copy', relatedDocument: 'Current Copy' },
          },
        ]}
        linked={[]}
      />,
    );
    expect(html).toContain('is the same file as');
    expect(html).toContain('Both files are kept.');
    expect(html).toContain('Same as an Existing Copy');
    expect(html).not.toMatch(/delet|merg/i);
  });

  it('sends a file of unknown kind to its own row, and lists confirmed links with labels', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[{ kind: 'low_confidence', documentId: 'd9', title: 'Untitled Document' }]}
        linked={[
          {
            documentId: 'd2',
            title: 'Statement April',
            relatedDocumentId: 'd1',
            relatedTitle: 'Statement March',
            labels: { newDocument: 'New Period', relatedDocument: 'Earlier Period' },
          },
        ]}
      />,
    );
    expect(html).toContain('We are not sure what Untitled Document is.');
    expect(html).toContain(
      'href="/app/applicant/a1/documents?document=d9#wallet-selected-document"',
    );
    expect(html).toContain('Choose What It Is');
    expect(html).toContain('Linked Copies');
    expect(html).toContain('>New Period<');
    expect(html).toContain('>Earlier Period<');
  });
});

describe('UMPE G1 additions to the list', () => {
  it('lists a background kind suggestion and the findings raised on arrival, each with its own button', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[
          {
            kind: 'suggested_kind',
            documentId: 'd1',
            title: 'Document, Anna',
            suggestedLabel: 'Bank Statement',
          },
          {
            kind: 'expired_on_arrival',
            exceptionId: 'x1',
            documentId: 'd2',
            title: 'Passport, Anna',
          },
          { kind: 'no_readable_text', exceptionId: 'x2', documentId: 'd3', title: 'Scan, Anna' },
        ]}
        linked={[]}
      />,
    );
    expect(html).toContain(
      'We think Document, Anna is a Bank Statement. Nothing is saved until you accept it.',
    );
    expect(html).toContain('aria-label="Review Suggestion: Document, Anna"');
    expect(html).toContain('Passport, Anna had already expired on the day it was added.');
    expect(html).toContain('We could not find any readable text in Scan, Anna.');
    expect(html).toContain('aria-label="Keep As It Is: Passport, Anna"');
    expect(html).toContain('aria-label="Keep As It Is: Scan, Anna"');
    expect(html).toContain('name="exceptionId" value="x1"');
  });

  it('asks Which Person? with the single suggestion chosen to start, and none when unsure', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[]}
        linked={[]}
        held={[
          {
            holdId: 'h1',
            fileName: 'erik passport.pdf',
            basis: 'NAME_AND_BIRTH_DATE',
            proposedApplicantId: 'a2',
            addedOn: '3 Nov 2026',
          },
          {
            holdId: 'h2',
            fileName: null,
            basis: 'CLOSE_MATCHES',
            proposedApplicantId: null,
            addedOn: '3 Nov 2026',
          },
        ]}
        people={[
          { applicantId: 'a1', displayName: 'Anna Eriksson' },
          { applicantId: 'a2', displayName: 'Erik Eriksson' },
        ]}
      />,
    );
    expect(html).toContain('Which Person Is erik passport.pdf For?');
    expect(html).toContain('The name and date of birth in this file match Erik Eriksson.');
    expect(html).toContain('Which Person Is File Added 3 Nov 2026 For?');
    expect(html).toContain('could belong to more than one of your people');
    // Exactly one radio starts chosen: the single suggestion of the first file.
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('aria-label="File It: erik passport.pdf"');
    expect(html).toContain('aria-label="Remove This File: erik passport.pdf"');
    expect(html).not.toContain('Nothing needs a decision right now.');
  });
});
