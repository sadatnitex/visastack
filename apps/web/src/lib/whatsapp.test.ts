import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { readWhatsAppConfig } = await import('./whatsapp');

const FULL: Record<string, string> = {
  WHATSAPP_CHANNEL_ENABLED: 'on',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'v',
  WHATSAPP_ACCESS_TOKEN: 'a',
  WHATSAPP_PHONE_NUMBER_ID: '106540352242922',
};
const reader = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe('readWhatsAppConfig', () => {
  it('stays off unless switched on and fully configured', () => {
    expect(readWhatsAppConfig(reader({}))).toBeNull();
    expect(readWhatsAppConfig(reader({ ...FULL, WHATSAPP_CHANNEL_ENABLED: 'yes' }))).toBeNull();
    for (const name of Object.keys(FULL).filter((key) => key !== 'WHATSAPP_CHANNEL_ENABLED')) {
      expect(readWhatsAppConfig(reader({ ...FULL, [name]: '  ' })), name).toBeNull();
    }
    expect(readWhatsAppConfig(reader({ ...FULL, WHATSAPP_PHONE_NUMBER_ID: 'abc' }))).toBeNull();
  });

  it('reads a full configuration with safe defaults', () => {
    const config = readWhatsAppConfig(
      reader({
        ...FULL,
        WHATSAPP_BUSINESS_NUMBER: '+880 1700-000000',
        WHATSAPP_APP_SECRET_PREVIOUS: 'old',
      }),
    );
    expect(config).toMatchObject({
      appSecrets: ['s', 'old'],
      apiVersion: 'v26.0',
      businessNumber: '8801700000000',
      settings: { phoneNumberId: '106540352242922', supportEmail: null },
    });
  });
});
