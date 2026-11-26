import { SIGNUP_PRIVACY_VERSION } from '@visastack/services';
import Link from 'next/link';
import {
  messageLang,
  publicMessage,
  publicSentence,
} from '../../components/public-site/public-text';
import { LEGAL_MESSAGES as M } from '../../i18n/legal-messages';
import { readEnv } from '../../lib/env';
import { getPageLanguage, primeLocale } from '../../lib/i18n-server';
import { localizedMetadata } from '../../lib/localized-metadata';
import { isPublicBetaOpen } from '../../lib/public-beta';

export const generateMetadata = localizedMetadata({ title: 'Privacy Notice' });
export const dynamic = 'force-dynamic';

/**
 * The Privacy Notice. Every paragraph is legal wording: the Bengali is written out in full in
 * `i18n/legal-messages.ts` and held until signed off, so a Bengali visitor reads the English (marked
 * English) today; the link texts are live. English is exactly as before.
 */
export default async function PrivacyPage() {
  const locale = await primeLocale();
  const lang = getPageLanguage();
  const say = (
    message: Parameters<typeof publicMessage>[0],
    params?: Record<string, string | number>,
  ) => publicMessage(message, lang, locale, params);
  const storage = readEnv('STORAGE_PROVIDER');
  const fileStorage =
    storage === 'r2'
      ? 'Cloudflare R2'
      : storage === 'vercel_blob'
        ? 'Vercel'
        : storage === 'neon'
          ? 'Neon'
          : null;
  // A named service keeps its name in every language; the generic words are a message of their own.
  const storageWords = fileStorage ?? publicMessage(M['privacy.storage.generic'], lang, locale);
  // A link inside a sentence names its own language whenever Bengali is chosen (the sentence around
  // it may be held English), and carries no mark at all in English.
  const linkMark = (key: 'privacy.access.link' | 'legal.termsLink' | 'legal.signupLink') =>
    locale === 'bn' ? { lang: messageLang(M[key], locale) } : {};
  return (
    <section className="section container" style={{ maxWidth: '48rem' }}>
      <h1 className="page-title">{say(M['privacy.title'])}</h1>
      <p className="card-body">{say(M['privacy.version'], { version: SIGNUP_PRIVACY_VERSION })}</p>
      <h2>{say(M['privacy.info.heading'])}</h2>
      <p>
        {say(M['privacy.info.body'])}{' '}
        {isPublicBetaOpen() ? say(M['privacy.info.open']) : say(M['legal.madeUp'])}
      </p>
      <h2>{say(M['privacy.services.heading'])}</h2>
      <p>{publicSentence(M['privacy.services.body'], { storage: storageWords }, lang, locale)}</p>
      <h2>{say(M['privacy.choices.heading'])}</h2>
      <p>{say(M['privacy.choices.body'])}</p>
      <h2>{say(M['privacy.access.heading'])}</h2>
      <p>
        {publicSentence(
          M['privacy.access.body'],
          {
            link: (
              <Link href="/app/privacy" {...linkMark('privacy.access.link')}>
                {publicMessage(
                  M['privacy.access.link'],
                  messageLang(M['privacy.access.link'], locale),
                )}
              </Link>
            ),
          },
          lang,
          locale,
        )}
      </p>
      <h2>{say(M['privacy.storage.heading'])}</h2>
      <p>{say(M['privacy.storage.body'])}</p>
      <p>
        {publicSentence(
          M['privacy.footer'],
          {
            terms: (
              <Link href="/terms" {...linkMark('legal.termsLink')}>
                {publicMessage(M['legal.termsLink'], messageLang(M['legal.termsLink'], locale))}
              </Link>
            ),
            signup: (
              <Link href="/auth/sign-up" {...linkMark('legal.signupLink')}>
                {publicMessage(M['legal.signupLink'], messageLang(M['legal.signupLink'], locale))}
              </Link>
            ),
          },
          lang,
          locale,
        )}
      </p>
    </section>
  );
}
