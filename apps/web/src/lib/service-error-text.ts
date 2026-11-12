import {
  type Catalog,
  type CatalogTranslator,
  type Locale,
  catalogTranslator,
} from '@visastack/i18n';
import { type ServiceError, serviceMessages } from '@visastack/services';

/** What a refusal needs to be worded: its English message and, when it has one, its key. */
export type WordableServiceError = Pick<ServiceError, 'message' | 'messageKey' | 'params'>;

/** A translator over the services message catalogue; works on the server and in the browser. */
export function serviceErrorTranslator(locale: Locale): CatalogTranslator<string> {
  // The error carries its key as a plain string, so the keys are widened here on purpose.
  return catalogTranslator(serviceMessages as Catalog<string>, locale);
}

/**
 * The words to show a person for a service refusal. A keyed refusal is worded in the visitor's
 * language; a refusal with no key, or a key the translator does not know (an older client, a
 * message not converted yet), shows `error.message`, the English the service has always sent.
 * A translator returns the key itself for an unknown key, which is how that case is told apart.
 */
export function serviceErrorText(
  error: WordableServiceError,
  t: CatalogTranslator<string>,
): string {
  if (error.messageKey === undefined) return error.message;
  const text = t(error.messageKey, error.params);
  return text === error.messageKey ? error.message : text;
}
