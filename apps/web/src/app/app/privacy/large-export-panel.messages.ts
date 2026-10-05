import type { Messages } from '../../../lib/client-messages';

/** The words `LargeExportPanel` shows; the page picks them with `pickMessages(locale, LARGE_EXPORT_KEYS)`. */
export const LARGE_EXPORT_KEYS = [
  'privacy.large.body',
  'privacy.large.request',
  'privacy.large.requesting',
  'privacy.large.preparing',
  'privacy.large.download',
  'privacy.large.expires',
  'privacy.large.failed',
  'privacy.large.expired',
] as const;

export type LargeExportMessages = Messages<(typeof LARGE_EXPORT_KEYS)[number]>;
