import 'server-only';
import { systemPrincipal } from '@visastack/services';
import { triggerWhatsAppInbox } from '../../../../lib/whatsapp';

/**
 * The only place outside the job route that makes the `process-whatsapp-inbox` scope (the access
 * rules allow `systemPrincipal` in this folder and nowhere else in the app). The webhook route
 * uses it to handle a delivery right after answering Meta, without an HTTP call.
 */
export function runWhatsAppInbox(
  options: { readonly limit?: number; readonly timeBudgetMs?: number } = {},
) {
  return triggerWhatsAppInbox(systemPrincipal('process-whatsapp-inbox'), options);
}
