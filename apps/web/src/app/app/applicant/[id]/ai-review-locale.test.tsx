// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';

/**
 * AI review under Bengali. Everything about what the AI found, what is saved and what the person
 * approves is held back in English; only the "Sensitive" badge has Bengali.
 */
vi.mock('./actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));

const { DocumentFindings, ReadAgainButton, OcrResultView, InconsistencyFlagReview } = await import(
  './ai-review'
);
type Finding = Parameters<typeof DocumentFindings>[0]['proposals'][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdAiReview.';
const BENGALI = /[ঀ-৿]/;

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

function render(locale: 'en' | 'bn', proposals: readonly Finding[], canApprove = true) {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        <DocumentFindings applicantId="a1" canApprove={canApprove} proposals={proposals} />
        <ReadAgainButton applicantId="a1" documentVersionId="v1" />
      </I18nProvider>,
    ),
  );
  return (host.textContent ?? '').replace(/\s+/g, ' ');
}

describe('AI review under Bengali', () => {
  it('shows the Bengali Sensitive badge only on a sensitive detail', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Passport Number', sensitive: true }),
    ]);
    expect(text).toContain(bn[`${K}sensitive`]);
    expect(host.querySelectorAll('.finding-card .badge')).toHaveLength(3);
    // One badge is the sensitive one; the Bengali AI wording (signed off 2026-11-12) sits beside it.
    expect(text.split(bn[`${K}sensitive`] as string)).toHaveLength(2);
  });

  it('shows no Sensitive badge when nothing is sensitive, for a clear and a to-check detail', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation', clear: false }),
    ]);
    expect(text).not.toContain(bn[`${K}sensitive`]);
    // Left English at review: the draft for "Clear" is the verb (empty it), not "readable".
    expect(text).toContain('Clear');
    // Left English at review with its pair "Clear" (one language per badge pair).
    expect(text).toContain('Please Check');
  });

  it('shows the AI promises and the approval wording in Bengali, with no raw key', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'd', fieldLabel: 'City', difference: { current: 'Chittagong' } }),
    ]);
    expect(text).toContain('Nothing is saved to your profile until you accept it.');
    expect(text).toContain(bn[`${K}changeItIfItIsNot`]);
    expect(text).not.toContain(en[`${K}changeItIfItIsNot`]);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('says in Bengali when the exact words could not be found in the document', () => {
    const text = render('bn', [
      finding({
        id: 'u',
        fieldLabel: 'Given Name',
        evidence: [{ snippet: 'Value', verified: false }],
      }),
    ]);
    expect(text).toContain(bn[`${K}weCouldNotFindTheseExact`]);
    expect(text).not.toContain(en[`${K}weCouldNotFindTheseExact`]);
  });

  it('is the same English as before under English, with the Sensitive badge in English', () => {
    const text = render('en', [
      finding({ id: 'b', fieldLabel: 'Passport Number', sensitive: true }),
    ]);
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Sensitive');
  });
});

describe('AI review states under Bengali', () => {
  const draw = (node: React.ReactNode) =>
    act(() =>
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          {node}
        </I18nProvider>,
      ),
    );
  const text = () => (host.textContent ?? '').replace(/\s+/g, ' ');
  const expectBengali = (keys: readonly string[]) => {
    for (const key of keys) {
      const value = bn[`${K}${key}`] ?? `missing ${key}`;
      for (const part of value
        .split(/\{\w+\}/)
        .map((p) => p.trim())
        .filter(Boolean))
        expect(text(), key).toContain(part);
      expect(text(), key).not.toContain(en[`${K}${key}`]);
    }
    expect(host.innerHTML).not.toMatch(/appApplicant\./);
  };

  it('a reading by the backup reader that found no text', () => {
    draw(<OcrResultView text="" reviewIssues={[]} usedFallback />);
    expectBengali(['fallbackProviderUsed', 'noLegibleTextWasFound']);
    expect(host.querySelector('.badge[title]')?.getAttribute('title')).toBe(
      bn[`${K}theFirstReaderTimedOutOr`],
    );
  });

  it('a date suggested by an AI app that differs from a hidden profile value, then marked as changed', () => {
    draw(
      <DocumentFindings
        applicantId="a1"
        canApprove
        proposals={[
          finding({
            id: 'd',
            fieldLabel: 'Passport Expiry Date',
            fieldKey: 'passport_expiry_date',
            value: '14 MAR 2030',
            editor: { kind: 'date' },
            difference: { current: null },
            app: 'Claude',
          }),
        ]}
      />,
    );
    // "Suggested by {app}": the app name sits after the Bengali words.
    expect(text()).toContain(`Claude${bn[`${K}suggestedByApp`]?.split('{app}')[1] ?? '?'}`);
    // Left English at review: the choice of which value is right stays in one language.
    expect(text()).toContain('Use the Suggested Value');
    expect(text()).toContain('Both Are Right, It Changed');
    expect(text()).toContain('14 MAR 2030');
    expect(text()).toContain(bn[`${K}weReadReadaswrittenPickTheDate`]?.split('"')[0]?.trim());
    const changed = host.querySelector<HTMLInputElement>('input[type="radio"][value="changed"]');
    if (!changed) throw new Error('changed choice');
    act(() => changed.click());
    expect(text()).toContain('Date It Changed');
  });

  it('two clear details offer accepting them together, with what is left out', () => {
    draw(
      <DocumentFindings
        applicantId="a1"
        canApprove
        proposals={[
          finding({ id: 'a', fieldLabel: 'Given Name' }),
          finding({ id: 'b', fieldLabel: 'Surname' }),
        ]}
      />,
    );
    expectBengali(['sensitiveDetailsAnythingYouChangedAnd']);
  });

  it('a possible inconsistency names its confidence in Bengali digits', () => {
    draw(
      <InconsistencyFlagReview
        applicantId="a1"
        flag={
          { id: 'f1', description: 'Two dates differ.', confidence: 80, rationale: null } as never
        }
      />,
    );
    expect(text()).toContain(
      bn[`${K}possibleInconsistencyConfidenceConfidence`]?.replace('{confidence}', '৮০'),
    );
  });
});
