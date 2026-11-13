import { type Catalog, DEFAULT_LOCALE, type Locale, catalogResolve } from '@visastack/i18n';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { unstable_rethrow } from 'next/navigation';
import { getLocale } from './locale';
import { plainSentence } from './plain-sentence';
import {
  type WordableServiceError,
  serviceErrorText,
  serviceErrorTranslator,
} from './service-error-text';

/**
 * The words for a service refusal in the visitor's language, for server actions (which have no
 * primed page translator). Server code only: it reads the request's language preference. A
 * refusal with no key is the English the service sent, so no language is read for it.
 */
export async function serviceErrorMessage(error: WordableServiceError): Promise<string> {
  if (error.messageKey === undefined) return error.message;
  return serviceErrorText(error, serviceErrorTranslator(await visitorLocale()));
}

/**
 * A sentence the service also says, worded from its key in the visitor's language. For a screen
 * that answers before the service is asked (a made-up id, a check made first), so that answer and
 * the service's own are the same words in every language.
 */
export function serviceKeyMessage(key: ServiceMessageKey): Promise<string> {
  return serviceErrorMessage({ message: serviceMessages.en[key], messageKey: key });
}

/** The request's language; English when there is no request to read. */
async function visitorLocale(): Promise<Locale> {
  try {
    return await getLocale();
  } catch (failure) {
    // Next's own signals (dynamic rendering, redirects) must keep travelling; anything else (no
    // request to read, as in a unit test) is English.
    unstable_rethrow(failure);
    return DEFAULT_LOCALE;
  }
}

/**
 * `serviceErrorMessage` as a finished sentence (see plainSentence), punctuated by the language the
 * words are actually shown in: Bangla only when the visitor reads Bangla and the key has a Bangla
 * entry; the English fallback under bn, and every unkeyed refusal, is punctuated as English.
 */
export async function serviceErrorSentence(error: WordableServiceError): Promise<string> {
  const key = error.messageKey;
  if (key === undefined) return plainSentence(error.message);
  const catalog = serviceMessages as Catalog<string>;
  // A key this build does not know (an older or newer service) shows the English it was sent.
  if (catalog.en[key] === undefined) return plainSentence(error.message);
  const { text, lang } = catalogResolve(catalog, await visitorLocale(), key, error.params);
  return plainSentence(text, lang);
}
