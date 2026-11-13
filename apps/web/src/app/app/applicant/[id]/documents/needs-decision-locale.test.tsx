import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';

/**
 * Needs One Decision under Bengali (refill 7): the Which Person? list with a suggested person and
 * its Choose Someone Else, the note about family files, a file with no readable text, the files
 * sorted for the person and the linked copies. Each line is the real component's own render.
 */

vi.mock('./needs-decision-actions', () => ({
  decideRelationAction: async () => ({ ok: true, message: '' }),
  needsDecisionAction: async () => ({ ok: true, message: '' }),
}));

const { NeedsDecision } = await import('./needs-decision');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdDocumentsNeedsDecision.';
const BENGALI = /[ঀ-৿]/;

type Props = Parameters<typeof NeedsDecision>[0];

function render(locale: 'en' | 'bn', props: Partial<Props>) {
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang={locale}>
      <NeedsDecision applicantId="a1" items={[]} linked={[]} {...props} />
    </I18nProvider>,
  );
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replace(/\s+/g, ' ');
  return { html, text };
}

const people = [
  { applicantId: 'a1', displayName: 'Karim' },
  { applicantId: 'a2', displayName: 'Rina' },
];
const heldFile = {
  holdId: 'h1',
  fileName: 'Passport_Karim.pdf',
  basis: 'NAME_AND_BIRTH_DATE' as const,
  proposedApplicantId: 'a1',
  addedOn: '4 Nov 2026',
};

describe('Needs One Decision under Bengali', () => {
  it('asks Which Person? with Choose Someone Else and the note about family files in Bengali', () => {
    const { text } = render('bn', { held: [heldFile], people });
    for (const key of ['whichPerson', 'chooseSomeoneElse', 'theseFilesWereAddedForSeveral'])
      expect(text, key).toContain(bn[`${K}${key}`]);
    for (const key of ['whichPerson', 'chooseSomeoneElse', 'theseFilesWereAddedForSeveral'])
      expect(text, key).not.toContain(en[`${K}${key}`]);
    // The file name and the person's name stay as they are; the File Under button is English.
    expect(text).toContain('Passport_Karim.pdf');
    expect(text).toContain('File Under Karim');
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('says what can be done about a file with no readable text in Bengali, and keeps its first line English (held)', () => {
    const { text } = render('bn', {
      items: [
        {
          kind: 'no_readable_text',
          exceptionId: 'e1',
          documentId: 'd1',
          title: 'Scan of Passport',
        },
      ],
    });
    expect(text).toContain(bn[`${K}addAClearerCopyIfYou`]);
    expect(text).not.toContain(en[`${K}addAClearerCopyIfYou`]);
    // Held (REFILL_LEFTOVERS.md, refill 7): the document title inside it is English.
    expect(bn[`${K}weCouldNotFindAnyReadable`]).toBeUndefined();
    expect(text).toContain(
      'We could not find any readable text in Scan of Passport. It may be blank, blurred or turned sideways.',
    );
  });

  it('marks each file sorted for the person in Bengali, beside the English line and the English Change button', () => {
    const { text } = render('bn', {
      personName: 'Karim',
      automatic: [
        {
          placementId: 'p1',
          documentId: 'd1',
          placement: 'KIND',
          title: 'Passport',
          kindLabel: 'Passport',
        },
        {
          placementId: 'p2',
          documentId: 'd2',
          placement: 'PERSON',
          title: 'Visa',
          kindLabel: null,
        },
      ],
    });
    expect(text).toContain(bn[`${K}recognisedAutomatically`]);
    expect(text).toContain(bn[`${K}filedUnderPersonname`]?.replace('{personName}', 'Karim'));
    expect(text).not.toContain('Recognised Automatically');
    expect(text).not.toContain('Filed Under Karim');
    // Held (refill 7): the line names the Change button, which is still English.
    expect(bn[`${K}theseWereSortedForYouIf`]).toBeUndefined();
    expect(text).toContain(en[`${K}theseWereSortedForYouIf`]);
    expect(text).toContain('Visa matched Karim by name and date of birth, so we filed it for you.');
    expect(text).toContain('Change');
  });

  it('heads the linked copies in Bengali, with the titles and labels as they are', () => {
    const { text } = render('bn', {
      linked: [
        {
          documentId: 'd2',
          title: 'Passport (New)',
          relatedDocumentId: 'd1',
          relatedTitle: 'Passport',
          labels: { newDocument: 'Renewed', relatedDocument: 'Earlier Copy' },
        },
      ],
    });
    expect(text).toContain(bn[`${K}linkedCopies`]);
    expect(text).not.toContain('Linked Copies');
    expect(text).toContain('Passport (New): Renewed');
  });

  it('is the same English as before under English', () => {
    const { text } = render('en', {
      held: [heldFile],
      people,
      linked: [
        {
          documentId: 'd2',
          title: 'Passport (New)',
          relatedDocumentId: 'd1',
          relatedTitle: 'Passport',
          labels: { newDocument: 'Renewed', relatedDocument: 'Earlier Copy' },
        },
      ],
      personName: 'Karim',
      automatic: [
        {
          placementId: 'p1',
          documentId: 'd1',
          placement: 'KIND',
          title: 'Passport',
          kindLabel: 'Passport',
        },
      ],
    });
    expect(text).not.toMatch(BENGALI);
    for (const words of [
      'Which Person?',
      'Choose Someone Else',
      'Linked Copies',
      'Recognised Automatically',
      en[`${K}theseFilesWereAddedForSeveral`],
    ])
      expect(text).toContain(words);
  });
});
