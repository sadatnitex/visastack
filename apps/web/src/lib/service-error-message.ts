import { DEFAULT_LOCALE, type Locale } from '@visastack/i18n';
import { getLocale } from './locale';
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
  let locale: Locale;
  try {
    locale = await getLocale();
  } catch (failure) {
    // Next's own signals (dynamic rendering, redirects) must keep travelling; anything else (no
    // request to read, as in a unit test) is English.
    if (isNextSignal(failure)) throw failure;
    locale = DEFAULT_LOCALE;
  }
  return serviceErrorText(error, serviceErrorTranslator(locale));
}

function isNextSignal(failure: unknown): boolean {
  if (typeof failure !== 'object' || failure === null || !('digest' in failure)) return false;
  const digest = (failure as { readonly digest: unknown }).digest;
  return typeof digest === 'string' && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_)/.test(digest);
}
