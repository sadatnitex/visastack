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
vi.mock('./actions', () => ({
  createGrantAction: async () => answer.next,
  allowCaseAction: vi.fn(),
}));
vi.mock('./ai-connection-actions', () => ({
  turnOffAiConnectionAction: vi.fn(),
  changeAiAccessAction: vi.fn(),
}));
// The AI connections card is a server component: the locale is set here directly, and React's
// cache stands in for one request per render (as in the other locale tests).
const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    loc.holder ??= build();
    return loc.holder;
  },
}));
vi.mock('./grant-ai-actions', () => ({ setGrantAiAssistAction: vi.fn() }));
vi.mock('./ai-draft-actions', () => ({ deleteAiDraftAction: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GrantForm } = await import('./grant-form');
const { GrantAiChoice } = await import('./grant-ai-choice');
const { AiDraftsSection } = await import('./ai-drafts');
const { AiConnectionsSection } = await import('./ai-connections');
const { CaseExceptions } = await import('./case-exceptions');
const { primeLocale } = await import('../../../../../lib/i18n-server');
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

  describe('the AI connections card and the case exceptions under Bengali (refill 3)', () => {
    const AI = 'applicantSharing.appApplicantIdSharingAiConnections.';
    const OFF = 'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.';
    const EXC = 'applicantSharing.appApplicantIdSharingCaseExceptions.';
    const DRAFTS = 'applicantSharing.appApplicantIdSharingAiDrafts.';
    const APPLICANT = '11111111-1111-4111-8111-111111111111';
    const connection = (over: Record<string, unknown> = {}) => ({
      id: '22222222-2222-4222-8222-222222222222',
      clientName: 'Claude',
      clientHost: 'claude.ai',
      connectedAt: new Date('2026-10-06T10:00:00Z'),
      scopes: [] as string[],
      caseMode: 'ALL_CURRENT' as const,
      missionId: null,
      caseTitle: null,
      revealIdentifiers: false,
      expiresAt: null,
      lastUsedAt: null,
      endedAt: null,
      endedBy: null,
      ...over,
    });
    const list = (over: Record<string, unknown> = {}) => ({
      available: true,
      active: [] as ReturnType<typeof connection>[],
      recentlyEnded: [] as ReturnType<typeof connection>[],
      activeTotal: 0,
      ...over,
    });
    let root: Root;
    let host: HTMLDivElement;
    beforeEach(async () => {
      loc.holder = null;
      loc.locale = 'bn';
      await primeLocale();
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    });
    afterEach(() => {
      act(() => root.unmount());
      host.remove();
      loc.locale = 'en';
    });
    const mount = (node: React.ReactNode) =>
      act(() =>
        root.render(
          <I18nProvider locale="bn" pageLang="bn">
            {node}
          </I18nProvider>,
        ),
      );
    const button = (label: string) => {
      const found = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
      if (!found) throw new Error(`Missing button ${label}`);
      return found;
    };

    it('a connection that reads nothing yet shows the Bengali row names, words and buttons', async () => {
      mount(
        <AiConnectionsSection
          applicantId={APPLICANT}
          connectorOn
          notice="changed"
          list={list({
            active: [connection()],
            activeTotal: 1,
            recentlyEnded: [
              connection({ id: '33333333-3333-4333-8333-333333333333', endedAt: new Date() }),
            ],
          })}
        />,
      );
      const text = host.textContent ?? '';
      for (const key of [
        'aiApps',
        'aiConnections',
        'aiAppsYouConnectedToThis12cecd',
        'accessChangedTheAppGetsThe',
        'connected',
        'canRead',
        'nothingFromThisRecord',
        'cases',
        'ends',
        'untilYouTurnItOff',
        'lastUsed',
        'notUsedYet',
        'changeAccess',
      ]) {
        expect(text, key).toContain(bn[`${AI}${key}`]);
      }
      expect(text).toContain('সম্প্রতি বন্ধ করা হয়েছে (১)');
      expect(host.innerHTML).toContain(
        `aria-label="${bn[`${AI}changeAccessForClientname`]?.replace('{clientName}', 'Claude')}"`,
      );
      // The full-numbers row keeps its English name and its English answer together.
      expect(text).toContain('No');
      expect(text).not.toContain(en[`${AI}aiAppsYouConnectedToThis12cecd`]);
      // Turn Off asks first: the question and the button are Bengali; the answers stay one
      // language each (the confirm button "Yes, Turn Off" is English, so is Keep It On).
      expect(host.innerHTML).toContain(
        `aria-label="${bn[`${OFF}turnOffAppname`]?.replace('{appName}', 'Claude')}"`,
      );
      await act(async () => button(bn[`${OFF}turnOff`] as string).click());
      const asked = host.textContent ?? '';
      expect(asked).toContain(
        (bn[`${OFF}turnOffAppnameFromItsNext`] as string).replace('{appName}', 'Claude'),
      );
      expect(asked).toContain('Yes, Turn Off');
      expect(asked).toContain('Keep It On');
      expect(host.innerHTML).not.toMatch(RAW_KEY);
    });

    it('an app that may suggest changes, a turned-off notice, no apps and an unreadable list are Bengali', () => {
      mount(
        <AiConnectionsSection
          applicantId={APPLICANT}
          connectorOn
          notice="off"
          list={list({ active: [connection({ scopes: ['suggest_changes'] })], activeTotal: 1 })}
        />,
      );
      const suggest = host.textContent ?? '';
      expect(suggest).toContain(bn[`${AI}aiAppsYouConnectedToThis`]);
      expect(suggest).toContain(bn[`${AI}turnedOffThatAppCanNo`]);
      mount(<AiConnectionsSection applicantId={APPLICANT} connectorOn list={list()} />);
      expect(host.textContent).toContain(bn[`${AI}noAiAppsAreConnectedTo`]);
      mount(
        <AiConnectionsSection
          applicantId={APPLICANT}
          connectorOn
          list={list({ available: false })}
        />,
      );
      expect(host.textContent).toContain(bn[`${AI}aiConnectionsCannotBeShownRight`]);
      mount(<AiDraftsSection applicantId={APPLICANT} drafts={[]} more={0} />);
      expect(host.textContent).toContain(bn[`${DRAFTS}noDraftsFromAiApps`]);
      expect(host.innerHTML).not.toMatch(RAW_KEY);
    });

    it('cases left out of an access are listed in Bengali, and allowing one asks in Bengali', async () => {
      mount(
        <CaseExceptions
          applicantId={APPLICANT}
          grantId="44444444-4444-4444-8444-444444444444"
          recipientLabel="Harbor Visas"
          exceptions={[
            { missionId: 'm1', title: 'Japan Visit', sharedSeparately: false },
            { missionId: 'm2', title: 'UK Study', sharedSeparately: true },
          ]}
        />,
      );
      const text = host.textContent ?? '';
      expect(text).toContain(bn[`${EXC}thisAccessCoversEveryCaseExcept`]);
      expect(text).toContain(`${bn[`${EXC}notShared`]}: Japan Visit`);
      expect(text).toContain(`${bn[`${EXC}sharedSeparately`]}: UK Study`);
      expect(text).toContain(
        (bn[`${EXC}recipientlabelSeesThisCaseThroughAnother`] as string).replace(
          '{recipientLabel}',
          'Harbor Visas',
        ),
      );
      expect(host.innerHTML).toContain(
        `aria-label="${(bn[`${EXC}allowThisCaseTitle`] as string).replace('{title}', 'Japan Visit')}"`,
      );
      const allow = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === bn[`${EXC}allowThisCase`],
      );
      if (!allow) throw new Error('Missing Allow This Case');
      await act(async () => allow.click());
      const asked = host.textContent ?? '';
      expect(asked).toContain(
        (bn[`${EXC}recipientlabelWillBeAbleToSee`] as string).replace(
          '{recipientLabel}',
          'Harbor Visas',
        ),
      );
      // The two answers stay English together.
      expect(asked).toContain('Yes, Allow This Case');
      expect(asked).toContain('Keep It Private');
      expect(host.innerHTML).not.toMatch(RAW_KEY);
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
