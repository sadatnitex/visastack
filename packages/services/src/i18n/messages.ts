import { type CatalogKey, defineCatalog } from '@visastack/i18n';
import { caseFlowBBn, caseFlowBEn } from './case-flow-b';
import { sharingBn, sharingEn } from './sharing';

/**
 * The words behind service refusals that carry a `messageKey` (see `keyedError` in errors.ts).
 * `en` is the exact English sentence the service has always returned, so logs, stored text and
 * code that compares messages see no change; `bn` may be partial and falls back to English.
 * Numbers are passed raw as params so the screen formats them by the language it resolves.
 * One file per area under this folder, merged here as each area is converted.
 *
 * Staff and admin text, emails, and legal, payment and official-rule wording stay English and
 * never come here.
 */
export const serviceMessages = defineCatalog({
  en: { ...caseFlowBEn, ...sharingEn },
  bn: { ...caseFlowBBn, ...sharingBn },
});

export type ServiceMessageKey = CatalogKey<typeof serviceMessages>;
