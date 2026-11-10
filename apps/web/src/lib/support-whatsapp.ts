import { normalizeWhatsAppNumber } from './whatsapp-link';

/**
 * VisaStack's WhatsApp business number in international digits, when one is set up
 * (`WHATSAPP_BUSINESS_NUMBER`), or null. The Help page offers "Send on WhatsApp" only when this
 * is set; nothing invents a number. Read per request, so setting it needs no rebuild. It reads the
 * number alone, so it works whether or not the inbound WhatsApp channel is switched on.
 */
export function supportWhatsAppNumber(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): string | null {
  return normalizeWhatsAppNumber(readEnv('WHATSAPP_BUSINESS_NUMBER')?.trim());
}
