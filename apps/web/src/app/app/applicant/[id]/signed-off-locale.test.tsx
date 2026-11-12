// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { textOf } from '../../../../lib/next-mocks.test-support';
import type { DocumentSuggestionView } from './document-suggestion';

// Components whose wording the owner signed off on 2026-11-12, drawn under Bengali so that every
// live Bengali message has a test that shows it.
vi.mock('./actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  decideDocumentSuggestionAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
vi.mock('./documents/manage/copy/actions', () => ({ keepCopyAction: vi.fn() }));
vi.mock('./documents/needs-decision-actions', () => ({
  decideRelationAction: async () => ({ ok: true, message: '' }),
  needsDecisionAction: async () => ({ ok: true, message: '' }),
}));

const { DocumentSuggestionCard } = await import('./document-suggestion-card');
const { AppSuggestionsSection } = await import('./app-suggestions');
const { KeepCopyAction } = await import('./documents/manage/copy/keep-copy-action');
const { NeedsDecision } = await import('./documents/needs-decision');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantId';
const RAW_KEY = /appApplicant\.app[A-Z]/;

const bengali = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider locale="bn" pageLang="bn">
      {node}
    </I18nProvider>,
  );

describe('signed-off wording on the applicant screens, under Bengali', () => {
  it('the document suggestion card says nothing is saved until the person accepts', () => {
    const suggestion: DocumentSuggestionView = {
      documentId: 'd1',
      nameVersionId: 'n1',
      typeProposalId: 'k1',
      kind: 'EMPLOYMENT_CERTIFICATE',
      kindLabel: 'Employment Certificate',
      recordGroup: 'Employment and Business',
      source: 'ai',
      clear: false,
      proposedName: 'Employment Certificate - Anna Eriksson.pdf',
      nameAfterKind: ' - Anna Eriksson.pdf',
      protectedNow: false,
      removesFreshSignIn: false,
    };
    const key = `${K}DocumentSuggestionCard.nothingIsSavedUntilYouAccept`;
    const html = bengali(
      <DocumentSuggestionCard
        applicantId="a1"
        suggestion={suggestion}
        groups={[]}
        protectedKinds={[]}
      />,
    );
    expect(textOf(html)).toContain(bn[key]);
    expect(textOf(html)).not.toContain(en[key]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the AI app suggestions section says how many changes were suggested and that nothing is saved yet', () => {
    const html = bengali(
      <AppSuggestionsSection
        applicantId="a1"
        canApprove
        proposals={[
          {
            id: 'p1',
            type: 'NEW',
            fieldKey: 'given_name',
            fieldLabel: 'Given Name',
            value: 'Value',
            confidence: 95,
            rationale: null,
            evidence: [{ snippet: 'Value', verified: true }],
            clear: true,
          },
        ]}
      />,
    );
    const key = `${K}AppSuggestions.pluralYourAiAppsSuggestedFor`;
    // The count word comes from the English plural helper; the Bengali sentence around it is shown.
    const parts = (bn[key] ?? '').split('{plural}');
    for (const part of parts) expect(textOf(html)).toContain(part.trim());
    expect(html).not.toMatch(RAW_KEY);
  });

  it('keeping a copy for another person says it is a separate copy', () => {
    const key = `${K}DocumentsManageCopyKeepCopyAction.itIsASeparateCopyChecked`;
    const html = bengali(
      <KeepCopyAction
        applicantId="a1"
        documentId="d1"
        documentName="Marriage Certificate"
        copyPeople={[{ id: 'a2', name: 'Salma Sadat' }]}
        onClose={() => undefined}
      />,
    );
    expect(textOf(html)).toContain(bn[key]);
    expect(textOf(html)).not.toContain(en[key]);
  });

  it('the files that need one decision say a suggestion is only a guess', () => {
    const key = `${K}DocumentsNeedsDecision.aSuggestionIsOnlyAGuess`;
    const html = bengali(
      <NeedsDecision
        applicantId="a1"
        items={[
          { kind: 'suggested_kind', documentId: 'd1', title: 'Scan', suggestedLabel: 'Bank Statement' },
        ]}
        linked={[]}
      />,
    );
    expect(textOf(html)).toContain(bn[key]);
    expect(textOf(html)).not.toContain(en[key]);
    expect(html).not.toMatch(RAW_KEY);
  });
});
