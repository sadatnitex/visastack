import { SIGNUP_TERMS_VERSION } from '@visastack/services';
import Link from 'next/link';
import {
  messageLang,
  publicMessage,
  publicSentence,
} from '../../components/public-site/public-text';
import { LEGAL_MESSAGES as M } from '../../i18n/legal-messages';
import { getPageLanguage, primeLocale } from '../../lib/i18n-server';
import { localizedMetadata } from '../../lib/localized-metadata';
import { isPublicBetaOpen } from '../../lib/public-beta';

export const generateMetadata = localizedMetadata({ title: 'Terms of Use' });
export const dynamic = 'force-dynamic';

/**
 * The Terms of Use. Every paragraph is legal wording: the Bengali is written out in full in
 * `i18n/legal-messages.ts` and held until signed off, so a Bengali visitor reads the English (marked
 * English) today; the link texts are live. English is exactly as before.
 */
export default async function TermsPage() {
  const locale = await primeLocale();
  const lang = getPageLanguage();
  const say = (
    message: Parameters<typeof publicMessage>[0],
    params?: Record<string, string | number>,
  ) => publicMessage(message, lang, locale, params);
  const linkMark = (key: 'legal.privacyLink' | 'legal.signupLink') =>
    locale === 'bn' ? { lang: messageLang(M[key], locale) } : {};
  return (
    <section className="section container" style={{ maxWidth: '48rem' }}>
      <h1 className="page-title">{say(M['terms.title'])}</h1>
      <p className="card-body">{say(M['terms.version'], { version: SIGNUP_TERMS_VERSION })}</p>
      {isPublicBetaOpen() ? (
        <>
          <h2>{say(M['terms.beta.heading'])}</h2>
          <p>{say(M['terms.beta.body'])}</p>
        </>
      ) : (
        <>
          <h2>{say(M['terms.pilot.heading'])}</h2>
          <p>
            {say(M['terms.pilot.lead'])} {say(M['legal.madeUp'])} {say(M['terms.pilot.tail'])}
          </p>
        </>
      )}
      <h2>{say(M['terms.info.heading'])}</h2>
      <p>{say(M['terms.info.body'])}</p>
      <h2>{say(M['terms.free.heading'])}</h2>
      <p>{say(M['terms.free.body'])}</p>
      <h2>{say(M['terms.visa.heading'])}</h2>
      <p>{say(M['terms.visa.body'])}</p>
      <p>
        {publicSentence(
          M['terms.footer'],
          {
            privacy: (
              <Link href="/privacy" {...linkMark('legal.privacyLink')}>
                {publicMessage(M['legal.privacyLink'], messageLang(M['legal.privacyLink'], locale))}
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
