// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const answer = vi.hoisted(() => ({
  next: { ok: true, message: 'Shared.' } as {
    ok: boolean;
    message: string;
    invitationUrl?: string;
  },
}));
vi.mock('./actions', () => ({ createGrantAction: async () => answer.next }));
vi.mock('./grant-ai-actions', () => ({ setGrantAiAssistAction: vi.fn() }));
vi.mock('./ai-draft-actions', () => ({ deleteAiDraftAction: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GrantForm } = await import('./grant-form');
const { GrantAiChoice } = await import('./grant-ai-choice');
const { AiDraftsSection } = await import('./ai-drafts');
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
  it('shows the Bengali recipient label, the two example texts and the permission and access lines (signed off 2026-11-12)', () => {
    const { html, text } = render('bn');
    expect(html).toContain(`>${bn[`${K}recipientEmail`]}</label>`);
    expect(html).toContain(`placeholder="${bn[`${K}themExampleCom`]}"`);
    expect(html).toContain(`placeholder="${bn[`${K}eGReviewMyUkStudent`]}"`);
    // Who can open what, how long, and the review step: Bengali since the owner sign-off.
    for (const key of [
      'everyGrantExpiresLeaveBlankFor',
      'whichDocumentsCanTheyOpen',
      'reviewAndConfirm',
    ]) {
      expect(text, key).toContain(bn[`${K}${key}`]);
      expect(text, key).not.toContain(en[`${K}${key}`]);
    }
    expect(html).not.toMatch(RAW_KEY);
  });

  describe('the interactive states (signed off 2026-11-12)', () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeEach(() => {
      vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
        run();
        return 1;
      });
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    });
    afterEach(() => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    });
    const mountForm = () =>
      act(() =>
        root.render(
          <I18nProvider locale="bn" pageLang="bn">
            <GrantForm
              applicantId="owned-person"
              documents={[{ id: 'passport', displayName: 'Passport summary' }]}
            />
          </I18nProvider>,
        ),
      );
    const type = (name: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input) throw new Error('Missing field');
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const reviewStep = async () => {
      type('recipientEmail', 'sara@example.com');
      type('purpose', 'Visa review');
      const review = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === bn[`${K}reviewAndConfirm`],
      );
      if (!review) throw new Error('Missing review button');
      await act(async () => review.click());
    };

    it('the review step says downloads are not included, then that safe copies may be downloaded and what revoking does', async () => {
      mountForm();
      await reviewStep();
      expect(host.textContent).toContain(bn[`${K}downloadsAreNotIncludedYouCan`]);
      act(() => host.querySelector<HTMLInputElement>('input[value="DOWNLOAD_REDACTED"]')?.click());
      expect(host.textContent).toContain(bn[`${K}safeCopiesMayBeDownloadedOriginal`]);
      expect(host.textContent).toContain(bn[`${K}revokingEndsAccessOnVisastackIt`]);
      expect(host.textContent).not.toMatch(RAW_KEY);
    });

    it('the receipts name the sharing request and the invitation in Bengali', async () => {
      mountForm();
      await reviewStep();
      await act(async () => {
        host.querySelector('form')?.requestSubmit();
      });
      expect(host.querySelector('.receipt-card h3')?.textContent).toBe(
        bn[`${K}sharingRequestCreated`],
      );
      act(() => root.unmount());
      root = createRoot(host);
      answer.next = {
        ok: true,
        message: 'Invitation emailed.',
        invitationUrl: 'https://example.test/invitation?kind=sharing&token=x',
      };
      mountForm();
      await reviewStep();
      await act(async () => {
        host.querySelector('form')?.requestSubmit();
      });
      expect(host.querySelector('.receipt-card h3')?.textContent).toBe(bn[`${K}invitationCreated`]);
      answer.next = { ok: true, message: 'Shared.' };
    });

    it('the AI choice on a grant and the drafts from AI apps are Bengali', () => {
      act(() =>
        root.render(
          <I18nProvider locale="bn" pageLang="bn">
            <GrantAiChoice
              applicantId="11111111-1111-4111-8111-111111111111"
              grantId="22222222-2222-4222-8222-222222222222"
              agencyName="Acme"
              allowed={false}
            />
            <AiDraftsSection
              applicantId="11111111-1111-4111-8111-111111111111"
              drafts={[
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  title: 'Cover Letter',
                  body: 'Dear Sir or Madam',
                  caseTitle: 'London Trip',
                  app: 'Claude (claude.ai)',
                  savedOn: '30 Oct 2026',
                },
              ]}
              more={0}
            />
          </I18nProvider>,
        ),
      );
      expect(host.textContent).toContain(
        bn['applicantSharing.appApplicantIdSharingGrantAiChoice.aiTools'],
      );
      expect(host.textContent).toContain(
        bn['applicantSharing.appApplicantIdSharingAiDrafts.draftsYourAiAppsSavedFor'],
      );
      expect(host.textContent).not.toMatch(RAW_KEY);
    });
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
