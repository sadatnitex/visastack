import 'server-only';
import { WhatsAppCloudPort } from '@visastack/adapters';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type Db,
  type SystemScope,
  type WhatsAppChannelSettings,
  type WhatsAppInboxResult,
  processWhatsAppInbox,
} from '@visastack/services';
import { resolveBaseUrl } from './base-url';
import { createKeyManagementPort } from './providers';
import { reportServerError } from './server-error';

/**
 * WhatsApp channel settings (Lane D). Off unless `WHATSAPP_CHANNEL_ENABLED=on` and every required
 * value is present, so a half-configured environment does nothing rather than half-working.
 *
 * - `WHATSAPP_CHANNEL_ENABLED`: `on` to run the channel; anything else keeps it off.
 * - `WHATSAPP_APP_SECRET` (and optional `WHATSAPP_APP_SECRET_PREVIOUS` during a rotation): checks
 *   Meta's signature on every webhook delivery.
 * - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: the token entered in Meta's webhook setup.
 * - `WHATSAPP_ACCESS_TOKEN`: a system user token for sending.
 * - `WHATSAPP_PHONE_NUMBER_ID`: Meta's id for VisaStack's business number.
 * - `WHATSAPP_GRAPH_API_VERSION`: optional, default `v26.0`.
 * - `WHATSAPP_BUSINESS_NUMBER`: optional, the number in international digits, for the
 *   "open WhatsApp with the code ready" link.
 * - `WHATSAPP_SUPPORT_EMAIL`: optional, where Talk to a Person sends people.
 *
 * Values are never logged.
 */
export interface WhatsAppConfig {
  readonly appSecrets: readonly string[];
  readonly verifyToken: string;
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly settings: WhatsAppChannelSettings;
  readonly businessNumber: string | null;
}

type Read = (name: string) => string | undefined;

const defaultRead: Read = (name) => process.env[name];

export function readWhatsAppConfig(read: Read = defaultRead): WhatsAppConfig | null {
  if (read('WHATSAPP_CHANNEL_ENABLED')?.trim().toLowerCase() !== 'on') return null;
  const value = (name: string) => read(name)?.trim() || undefined;
  const appSecret = value('WHATSAPP_APP_SECRET');
  const verifyToken = value('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  const accessToken = value('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = value('WHATSAPP_PHONE_NUMBER_ID');
  if (!appSecret || !verifyToken || !accessToken || !phoneNumberId) return null;
  if (!/^\d{6,20}$/.test(phoneNumberId)) return null;
  const previous = value('WHATSAPP_APP_SECRET_PREVIOUS');
  const businessNumber = value('WHATSAPP_BUSINESS_NUMBER')?.replace(/\D/g, '') ?? '';
  return {
    appSecrets: previous ? [appSecret, previous] : [appSecret],
    verifyToken,
    accessToken,
    apiVersion: value('WHATSAPP_GRAPH_API_VERSION') ?? 'v26.0',
    settings: {
      phoneNumberId,
      baseUrl: resolveBaseUrl(),
      supportEmail: value('WHATSAPP_SUPPORT_EMAIL') ?? null,
    },
    businessNumber: /^\d{6,20}$/.test(businessNumber) ? businessNumber : null,
  };
}

const EMPTY: WhatsAppInboxResult = {
  status: 'unavailable',
  handled: 0,
  failed: 0,
  sent: 0,
  sendFailed: 0,
  purged: 0,
};

/**
 * One pass of the WhatsApp inbox on its own short-lived connection (like the other job triggers:
 * never the request's pool, which may already be closed in an `after()` callback). Errors are
 * reported, never thrown: deliveries stay in the inbox for the next pass.
 */
export async function triggerWhatsAppInbox(
  scope: SystemScope<'process-whatsapp-inbox'>,
  options: { readonly limit?: number; readonly timeBudgetMs?: number } = {},
): Promise<WhatsAppInboxResult> {
  const config = readWhatsAppConfig();
  const encryption = createKeyManagementPort();
  const connectionString = resolveDatabaseUrl(process.env);
  if (!config || !encryption || !connectionString) return EMPTY;

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerWhatsAppInbox', error, { step: 'idle pool connection error' });
  });
  try {
    return await processWhatsAppInbox(scope, db as unknown as Db, {
      encryption,
      whatsapp: new WhatsAppCloudPort({
        accessToken: config.accessToken,
        apiVersion: config.apiVersion,
      }),
      settings: config.settings,
      ...options,
    });
  } catch (error) {
    reportServerError('triggerWhatsAppInbox', error, { step: 'inbox pass failed' });
    return EMPTY;
  } finally {
    await pool.end();
  }
}
