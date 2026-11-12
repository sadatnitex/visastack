import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const form = vi.hoisted(() => ({ state: { ok: true, message: '' } as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: () => [form.state, () => undefined, false],
}));
vi.mock('./actions', () => ({ startWhatsAppLinkAction: async () => ({}) }));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appAccountCatalog } from '../../../../i18n/app-account';
import { ConnectWhatsAppForm } from './connect-form';

const bn = appAccountCatalog.bn as Record<string, string>;
const en = appAccountCatalog.en as Record<string, string>;
const BENGALI = /[ঀ-৿]/;

const render = async (locale: 'en' | 'bn') =>
  textOf(
    await renderServer(
      <I18nProvider locale={locale} pageLang="en">
        <ConnectWhatsAppForm />
      </I18nProvider>,
    ),
  );

describe('connect WhatsApp form under Bengali', () => {
  it('code shown: the "I have sent it" link is Bengali, the instruction stays English', async () => {
    form.state = { ok: true, code: 'ABC', whatsappMessage: 'LINK ABC', whatsappHref: 'https://w' };
    const shown = await render('bn');
    expect(shown).toContain(bn['appAccount.appAccountWhatsappConnectForm.iHaveSentIt']);
    expect(shown).toContain(
      en['appAccount.appAccountWhatsappConnectForm.sendThisMessageFromTheWhatsapp'],
    );
    expect(await render('en')).toContain('I Have Sent It');
  });

  it('asking state: the agreement wording stays English under Bengali', async () => {
    form.state = { ok: true, message: '' };
    const shown = await render('bn');
    expect(shown).toContain(
      en['appAccount.appAccountWhatsappConnectForm.iAgreeToReceiveMessagesFrom'],
    );
    expect(await render('en')).not.toMatch(BENGALI);
  });
});
