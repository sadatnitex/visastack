import type { Catalog } from '@visastack/i18n';
import { serviceMessages } from '@visastack/services/i18n';
import type { ReactNode } from 'react';
import { getServerT } from './i18n-server';
import type { WordableServiceError } from './service-error-text';

/**
 * A service refusal for a server page that has run `primeLocale()`: the keyed words in the page's
 * language, marked with the language they are shown in (as every other catalogue line on the
 * page). A refusal with no key, or a key this build does not know, shows the English it was sent.
 */
export function serviceErrorNode(error: WordableServiceError): ReactNode {
  const key = error.messageKey;
  const catalog = serviceMessages as Catalog<string>;
  if (key === undefined || catalog.en[key] === undefined) return error.message;
  return getServerT(catalog).node(key, error.params);
}
