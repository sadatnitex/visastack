import { type CatalogKey, defineCatalog } from '@visastack/i18n';
import { caseFlowBBn, caseFlowBEn } from './case-flow-b';

/**
 * The words behind service refusals that carry a `messageKey` (see `keyedError` in errors.ts).
 * `en` is the exact English sentence the service has always returned, so logs, stored text and
 * code that compares messages see no change; `bn` may be partial and falls back to English.
 * Numbers are passed raw as params so the screen formats them by the language it resolves.
 * Empty on purpose until the domain errors are converted, one area per change.
 *
 * Staff and admin text, emails, and legal, payment and official-rule wording stay English and
 * never come here.
 */
export const serviceMessages = defineCatalog({
  en: { ...caseFlowBEn },
  bn: { ...caseFlowBBn },
});

export type ServiceMessageKey = CatalogKey<typeof serviceMessages>;
