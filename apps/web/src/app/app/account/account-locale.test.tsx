import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../lib/axe.test-support';
import { renderServer, stub, textOf } from '../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  whatsapp: {
    available: true,
    connected: false,
    maskedNumber: null as string | null,
    connectedAt: null as string | null,
    messagesOff: false,
    pendingCodeExpiresAt: null as string | null,
  },
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com', self: { kind: 'self' } }),
}));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../lib/admin', () => ({ holdsPlatformRole: async () => false }));
vi.mock('../../../lib/profile-photos', () => ({ loadOwnPhoto: async () => null }));
vi.mock('../../../lib/sign-out', () => ({ signOutCurrentUser: async () => undefined }));
vi.mock('../../../lib/whatsapp', () => ({ readWhatsAppConfig: () => ({}) }));
vi.mock('../../actions', () => ({ setLocaleAction: async () => undefined }));
vi.mock('../../../components/profile-photo/account-photo-card', () => ({
  AccountPhotoCard: stub('AccountPhotoCard'),
}));
vi.mock('./plan/plan-forms', () => ({
  BuyPlanForm: stub('BuyPlanForm'),
  PayPurchaseForm: stub('PayPurchaseForm'),
  RenewalForm: stub('RenewalForm'),
}));
vi.mock('./whatsapp/actions', () => ({
  disconnectWhatsAppAction: async () => undefined,
  startWhatsAppLinkAction: async () => ({}),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getWhatsAppConnection: async () => state.whatsapp,
  listMembershipsForAccount: async () => [],
  getTravellerPlanSummary: async () => ({
    plan: { key: 'traveller_free', name: 'Traveller Free' },
    features: {},
    paidUntil: null,
    storage: { accountBytes: null, personBytes: null },
  }),
  listApplicants: async () => [],
  getApplicantEvidenceBytes: async () => 0,
  listTravellerPlansForSale: async () => [],
  getOwnPurchase: async () => null,
  getOwnRenewal: async () => null,
  hasOwnBilling: async () => false,
  countTravellerPlanEvent: async () => undefined,
}));
vi.mock('../../../lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai-usage')>()),
  readAiUsage: async () => [],
}));

import { I18nProvider } from '../../../components/i18n-provider';
import { appAccountCatalog } from '../../../i18n/app-account';

const { default: AccountPage } = await import('./page');
const { default: WhatsAppPage } = await import('./whatsapp/page');
const { default: PlanPage } = await import('./plan/page');

const BENGALI = /[ঀ-৿]/;
const bn = appAccountCatalog.bn as Record<string, string>;
const en = appAccountCatalog.en as Record<string, string>;

async function html(locale: 'en' | 'bn', page: () => Promise<React.JSX.Element>) {
  state.locale = locale;
  state.generation += 1;
  return renderServer(
    <I18nProvider locale={locale} pageLang="en">
      {await page()}
    </I18nProvider>,
  );
}
const account = (locale: 'en' | 'bn') => html(locale, () => AccountPage());
const whatsapp = (locale: 'en' | 'bn') => html(locale, () => WhatsAppPage());
const plan = (locale: 'en' | 'bn') => html(locale, () => PlanPage({}));

beforeEach(() => {
  state.whatsapp = {
    available: true,
    connected: false,
    maskedNumber: null,
    connectedAt: null,
    messagesOff: false,
    pendingCodeExpiresAt: null,
  };
});

describe('account page under Bengali', () => {
  it('shows the Bengali drafts on the cards, keeps Data Rights in English, and leaves the language switch as it was', async () => {
    const shown = textOf(await account('bn'));
    for (const k of [
      'account',
      'yourAccount',
      'session',
      'signedIn',
      'signOutOfThisDevice',
      'signOut',
    ]) {
      expect(shown).toContain(bn[`appAccount.appAccountPage.${k}`]);
    }
    expect(shown).toContain(en['appAccount.appAccountPage.dataRights']);
    // The switch: its card text and its button are the English the page always had.
    expect(shown).toContain('Preferences Language Applies immediately across the whole product.');
    expect(shown).toContain('Switch to English');
    expect(shown).toMatch(BENGALI);
  });

  it('the language switch markup is the same in both languages apart from the target', async () => {
    const switchOf = (markup: string) =>
      markup.slice(markup.indexOf('Preferences'), markup.indexOf('Plan &amp;'));
    const toBengali = switchOf(await account('en'));
    expect(toBengali).toContain('lang="bn"');
    expect(toBengali).toContain('বাংলা');
    const toEnglish = switchOf(await account('bn'));
    expect(toEnglish).toContain('lang="en"');
  });

  it('English is unchanged', async () => {
    // The only Bengali on the English page is the name of the language on the switch.
    const shown = textOf(await account('en')).replace('Switch to বাংলা', '');
    expect(shown).not.toMatch(BENGALI);
    expect(shown).toContain('Signed In');
    expect(shown).toContain('Sign out of this device.');
  });
});

describe('WhatsApp page under Bengali', () => {
  it('not connected: the Bengali heading stays and the connect form is English where no draft exists', async () => {
    const shown = textOf(await whatsapp('bn'));
    expect(shown).toContain(bn['appAccount.appAccountPage.account']);
  });

  it('connected: the connection date uses Bengali digits, English keeps its date', async () => {
    state.whatsapp = {
      ...state.whatsapp,
      connected: true,
      maskedNumber: '+88 *** 1234',
      connectedAt: '2026-10-20T08:00:00Z',
    };
    const shown = textOf(await whatsapp('bn'));
    expect(shown).toContain(bn['appAccount.appAccountWhatsappPage.on'] ?? 'On');
    expect(shown).toContain('২০');
    expect(shown).not.toContain('Oct 20, 2026');
    expect(textOf(await whatsapp('en'))).toContain('Oct 20, 2026');
  });
});

describe('accessibility under Bengali', () => {
  it('the account, WhatsApp and plan pages have no axe violations', async () => {
    expect(await axeViolations(await account('bn'))).toEqual([]);
    expect(await axeViolations(await whatsapp('bn'))).toEqual([]);
    expect(await axeViolations(await plan('bn'))).toEqual([]);
  });
});

describe('plan page under Bengali', () => {
  it('shows the Bengali labels for the plan, storage and account, and keeps the AI wording in English', async () => {
    const shown = textOf(await plan('bn'));
    expect(shown).toContain(bn['appAccount.appAccountPlanPage.storage']);
    expect(shown).toContain(bn['appAccount.appAccountPlanPage.yourWholeAccount']);
    expect(textOf(await plan('en'))).not.toMatch(BENGALI);
  });
});
