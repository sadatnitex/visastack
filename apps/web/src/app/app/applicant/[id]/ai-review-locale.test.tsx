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

const { DocumentFindings, ReadAgainButton } = await import('./ai-review');
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
  it('shows the Bengali Sensitive badge only on a sensitive detail, and nothing in Bengali elsewhere', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Passport Number', sensitive: true }),
    ]);
    expect(text).toContain(bn[`${K}sensitive`]);
    expect(host.querySelectorAll('.finding-card .badge')).toHaveLength(3);
    // Only the one badge is Bengali; the rest of the screen is held back.
    expect(text.match(/[ঀ-৿]+/g)).toEqual([bn[`${K}sensitive`]]);
  });

  it('shows no Bengali badge when nothing is sensitive, for a clear and a to-check detail', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'b', fieldLabel: 'Occupation', clear: false }),
    ]);
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Clear');
    expect(text).toContain('Please Check');
  });

  it('keeps the AI promises and the approval wording in English, with no raw key', () => {
    const text = render('bn', [
      finding({ id: 'a', fieldLabel: 'Given Name' }),
      finding({ id: 'd', fieldLabel: 'City', difference: { current: 'Chittagong' } }),
    ]);
    expect(text).toContain('Nothing is saved to your profile until you accept it.');
    expect(text).toContain(en[`${K}changeItIfItIsNot`]);
    expect(`${K}changeItIfItIsNot` in bn).toBe(false);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('is the same English as before under English, with the Sensitive badge in English', () => {
    const text = render('en', [
      finding({ id: 'b', fieldLabel: 'Passport Number', sensitive: true }),
    ]);
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Sensitive');
  });
});
