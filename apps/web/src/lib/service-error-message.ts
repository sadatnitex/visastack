import type { Locale } from '@visastack/i18n';
import { getLocale } from './locale';
import { serviceErrorText, serviceErrorTranslator } from './service-error-text';
import type { WordableServiceError } from './service-error-text';

/**
 * The words for a service refusal in the visitor's language, for server actions and pages. A
 * refusal with no key, or a key with no Bengali yet, reads exactly as `error.message` always did.
 */
export async function refusalText(error: WordableServiceError): Promise<string> {
  if (error.messageKey === undefined) return error.message;
  let locale: Locale = 'en';
  try {
    locale = await getLocale();
  } catch {
    // No request to read a language from (a job, a test): the English the service sent.
  }
  return serviceErrorText(error, serviceErrorTranslator(locale));
}
