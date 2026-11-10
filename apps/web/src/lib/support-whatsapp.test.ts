import { describe, expect, it } from 'vitest';
import { supportWhatsAppNumber } from './support-whatsapp';

const read = (value: string | undefined) => (name: string) =>
  name === 'WHATSAPP_BUSINESS_NUMBER' ? value : undefined;

describe('the support WhatsApp number', () => {
  it('is the business number in international digits', () => {
    expect(supportWhatsAppNumber(read('+880 1711-223344'))).toBe('8801711223344');
    expect(supportWhatsAppNumber(read(' 8801711223344 '))).toBe('8801711223344');
  });
  it('is null when nothing usable is set, so nothing is invented', () => {
    expect(supportWhatsAppNumber(read(undefined))).toBeNull();
    expect(supportWhatsAppNumber(read(''))).toBeNull();
    expect(supportWhatsAppNumber(read('call us'))).toBeNull();
    expect(supportWhatsAppNumber(read('12345'))).toBeNull();
  });
});
