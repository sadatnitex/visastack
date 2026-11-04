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

  it('files the suggested person with one button, and keeps the full choice behind one quiet line', () => {
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
    // The suggested file: one button files it, nothing is filed until it is pressed.
    expect(html).toContain('The name and date of birth in this file match Erik Eriksson.');
    expect(html).toContain('File Under Erik Eriksson');
    expect(html).toContain('aria-label="File Under Erik Eriksson: erik passport.pdf"');
    expect(html).toContain('name="personId" value="a2"');
    expect(html).toContain('Choose Someone Else');
    expect(html).toContain('aria-label="Remove This File: erik passport.pdf"');
    // The file with no suggestion keeps the plain question and File It.
    expect(html).toContain('Which Person Is File Added 3 Nov 2026 For?');
    expect(html).toContain('could belong to more than one of your people');
    expect(html).toContain('aria-label="File It: File Added 3 Nov 2026"');
    // No radio starts chosen anywhere: the person always presses a button to file.
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('Nothing needs a decision right now.');
  });

  it('suggests the person the file name points to, says why, and says it was not read', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[]}
        linked={[]}
        held={[
          {
            holdId: 'h3',
            fileName: 'Passport_Nazmus Sadat.pdf',
            basis: 'NOT_READ',
            proposedApplicantId: null,
            nameSuggestionApplicantId: 'a1',
            addedOn: '4 Nov 2026',
          },
          {
            holdId: 'h4',
            fileName: 'nbr_tin_certificate.pdf',
            basis: 'NOT_READ',
            proposedApplicantId: null,
            nameSuggestionApplicantId: null,
            addedOn: '4 Nov 2026',
          },
          {
            holdId: 'h5',
            fileName: 'bank letter.pdf',
            basis: 'NO_MATCH',
            proposedApplicantId: null,
            nameSuggestionApplicantId: null,
            addedOn: '4 Nov 2026',
          },
        ]}
        people={[
          { applicantId: 'a1', displayName: 'Nazmus Sadat' },
          { applicantId: 'a2', displayName: 'Salma' },
        ]}
      />,
    );
    expect(html).toContain('The file name says Nazmus Sadat, so we think this is theirs.');
    expect(html).toContain('File Under Nazmus Sadat');
    // Honest wording: not read is not "we could not tell", and a read that matched nobody says so.
    expect(html).toContain(
      'We have not read anything from this file, so we cannot tell who it belongs to.',
    );
    expect(html).toContain('We read this file, but it does not match any of your people');
    // Only the first file gets a one-tap button.
    expect(html.match(/File Under /g)?.length).toBe(2);
  });
});

describe('UMPE G4: placed automatically', () => {
  it('names each automatic placement and offers one Change per file', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[]}
        linked={[]}
        personName="Anna Eriksson"
        automatic={[
          {
            placementId: 'pl1',
            documentId: 'd1',
            placement: 'KIND',
            title: 'Hotel Booking, Anna',
            kindLabel: 'Hotel or Stay Booking',
          },
          {
            placementId: 'pl2',
            documentId: 'd2',
            placement: 'PERSON',
            title: 'Passport, Anna',
            kindLabel: null,
          },
        ]}
      />,
    );
    expect(html).toContain('Placed Automatically');
    expect(html).toContain('Recognised Automatically');
    expect(html).toContain('Filed Under Anna Eriksson');
    expect(html).toContain('We recognised Hotel Booking, Anna as a Hotel or Stay Booking');
    expect(html).toContain('matched Anna Eriksson by name and date of birth');
    expect(html).toContain('value="change-kind"');
    expect(html).toContain('value="change-person"');
    expect(html).toContain('aria-label="Change: Hotel Booking, Anna"');
    expect(html).toContain('aria-label="Change: Passport, Anna"');
  });

  it('asks plainly after a file was moved back from an automatic filing', () => {
    const html = renderToStaticMarkup(
      <NeedsDecision
        applicantId="a1"
        items={[]}
        linked={[]}
        held={[
          {
            holdId: 'h1',
            fileName: 'scan.pdf',
            basis: 'NAME_AND_BIRTH_DATE',
            proposedApplicantId: null,
            addedOn: '3 Nov 2026',
          },
        ]}
        people={[{ applicantId: 'a1', displayName: 'Anna Eriksson' }]}
      />,
    );
    expect(html).toContain('Choose who this file belongs to.');
    expect(html).not.toContain('checked=""');
  });
});
