import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ createGrantAction: vi.fn() }));

const { GrantForm } = await import('./grant-form');
const { applicantSharingCatalog } = await import('../../../../../i18n/applicant-sharing');

const bn = applicantSharingCatalog.bn as Record<string, string>;
const en = applicantSharingCatalog.en as Record<string, string>;
const K = 'applicantSharing.appApplicantIdSharingGrantForm.';
const RAW_KEY = /applicantSharing\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;

const render = (locale: 'en' | 'bn') => {
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang={locale}>
      <GrantForm
        applicantId="owned-person"
        documents={[{ id: 'passport', displayName: 'Passport summary' }]}
      />
    </I18nProvider>,
  );
  return { html, text: textOf(html) };
};

describe('the sharing form under Bengali', () => {
  it('shows the Bengali recipient label and the two example texts, and keeps every permission and access line in English', () => {
    const { html, text } = render('bn');
    expect(html).toContain(`>${bn[`${K}recipientEmail`]}</label>`);
    expect(html).toContain(`placeholder="${bn[`${K}themExampleCom`]}"`);
    expect(html).toContain(`placeholder="${bn[`${K}eGReviewMyUkStudent`]}"`);
    // Held in English: who can open what, how long, and the review step.
    for (const key of [
      'everyGrantExpiresLeaveBlankFor',
      'whichDocumentsCanTheyOpen',
      'reviewAndConfirm',
    ]) {
      expect(text, key).toContain(en[`${K}${key}`]);
      expect(`${K}${key}` in bn).toBe(false);
    }
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', () => {
    const { html, text } = render('en');
    expect(html).not.toMatch(BENGALI);
    expect(text).toContain('Recipient Email');
    expect(html).toContain('placeholder="them@example.com"');
  });

  it('every live Bengali message of the sharing surface was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantSharingCatalog);
  });
});
