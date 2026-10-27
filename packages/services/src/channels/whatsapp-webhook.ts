import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WhatsApp Cloud API webhook codec: the verification handshake, the payload signature and a
 * tolerant reader that turns Meta's envelope into the few facts VisaStack acts on.
 *
 * Shapes follow Meta's webhook reference as recorded in
 * `docs/roadmap/pwa-whatsapp/WHATSAPP-POLICY-RESEARCH.md` (sections 3 to 8). Meta adds fields
 * over time and, since April 2026, may leave the phone number out, so every field is optional
 * here and anything unrecognised is ignored rather than trusted. Nothing in this file touches
 * the database or logs message content.
 */

/** Largest webhook body accepted (Meta batches, but a single delivery is far below this). */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/** WhatsApp's own limit for a text message; anything longer is cut, never rejected. */
export const MAX_TEXT_LENGTH = 4096;

const WAMID_MAX = 128;
const REPLY_ID_MAX = 256;

/**
 * Meta's GET handshake when the webhook URL is registered: echo `hub.challenge` only when the
 * mode is `subscribe` and the token matches ours. Returns the challenge, or null for a 403.
 */
export function verifySubscription(
  params: URLSearchParams,
  expectedToken: string | undefined,
): string | null {
  if (!expectedToken) return null;
  if (params.get('hub.mode') !== 'subscribe') return null;
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  if (!challenge || !constantTimeEqual(token, expectedToken)) return null;
  return challenge;
}

/**
 * Checks `X-Hub-Signature-256` (`sha256=<hex>`, HMAC-SHA256 of the raw body bytes with the app
 * secret). Accepts any of the given secrets so the app secret can be rotated without dropping
 * deliveries. The body must be the exact bytes received, before any JSON parsing.
 */
export function verifyWebhookSignature(
  rawBody: Uint8Array,
  header: string | null,
  secrets: readonly string[],
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  return secrets
    .filter((secret) => secret.length > 0)
    .some((secret) => {
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      return constantTimeEqual(received, expected);
    });
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Who sent a message. `externalUserId` is the stable key VisaStack stores. */
export interface WhatsAppSender {
  /**
   * Meta's business-scoped user id when present (always present since April 2026); otherwise
   * `wa:` plus the phone id, for older payloads. Never matched against a profile phone number.
   */
  readonly externalUserId: string;
  /** Phone id (digits) when Meta included it; absent for many people who use usernames. */
  readonly waId: string | null;
}

export type InboundKind = 'text' | 'reply' | 'media' | 'unsupported';

export interface InboundMessage {
  readonly providerMessageId: string;
  readonly phoneNumberId: string;
  readonly sender: WhatsAppSender;
  readonly sentAt: Date;
  readonly kind: InboundKind;
  /** Text body, trimmed and cut to `MAX_TEXT_LENGTH`; only for `text`. */
  readonly text: string | null;
  /** The id of the button or list row pressed; only for `reply`. Opaque, set by VisaStack. */
  readonly replyId: string | null;
  /** `image`, `document`, `audio`, `video` or `sticker`; only for `media`. The file is never fetched here. */
  readonly mediaType: string | null;
}

export type DeliveryState = 'sent' | 'delivered' | 'read' | 'failed';

export interface StatusUpdate {
  readonly providerMessageId: string;
  readonly state: DeliveryState;
  readonly at: Date;
  readonly recipientUserId: string | null;
  /** Meta error codes on a failed delivery (for example 130403 blocked, 131056 too fast). */
  readonly errorCodes: readonly number[];
  readonly pricingCategory: string | null;
  readonly billable: boolean | null;
}

/** Meta's notice that a person's number or business-scoped id changed. */
export interface IdentityChange {
  readonly kind: 'number_changed' | 'user_id_changed';
  readonly phoneNumberId: string;
  /** The id the person had before (the message sender). */
  readonly externalUserId: string;
  readonly newExternalUserId: string | null;
  readonly newWaId: string | null;
  readonly at: Date;
  readonly providerMessageId: string;
}

export interface ParsedWebhook {
  readonly inbound: readonly InboundMessage[];
  readonly statuses: readonly StatusUpdate[];
  readonly identityChanges: readonly IdentityChange[];
}

type Json = Record<string, unknown>;

/** Reads one field of an untrusted object (missing objects read as undefined). */
function get(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function digits(value: unknown): string | null {
  return typeof value === 'string' && /^\d{6,20}$/.test(value) ? value : null;
}

function userId(value: unknown): string | null {
  // Business-scoped ids: a two-letter country code, a period, then up to 128 letters and digits.
  return typeof value === 'string' && /^[A-Za-z]{2}\.[A-Za-z0-9]{1,128}$/.test(value)
    ? value
    : null;
}

function epochSeconds(value: unknown): Date | null {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function messageId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= WAMID_MAX ? value : null;
}

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'sticker']);
const DELIVERY_STATES = new Set<string>(['sent', 'delivered', 'read', 'failed']);

function senderFor(message: Json, contacts: Json[]): WhatsAppSender | null {
  const waId = digits(get(message, 'from'));
  const contact =
    contacts.find((candidate) => waId !== null && get(candidate, 'wa_id') === waId) ??
    (contacts.length === 1 ? contacts[0] : undefined);
  const scoped = userId(get(message, 'from_user_id')) ?? userId(get(contact, 'user_id'));
  const phone = waId ?? digits(get(contact, 'wa_id'));
  if (scoped) return { externalUserId: scoped, waId: phone };
  if (phone) return { externalUserId: `wa:${phone}`, waId: phone };
  return null;
}

function readInbound(
  message: Json,
  contacts: Json[],
  phoneNumberId: string,
): InboundMessage | IdentityChange | null {
  const providerMessageId = messageId(get(message, 'id'));
  const sentAt = epochSeconds(get(message, 'timestamp'));
  const sender = senderFor(message, contacts);
  if (!providerMessageId || !sentAt || !sender) return null;
  const rawType = get(message, 'type');
  const type = typeof rawType === 'string' ? rawType : '';

  if (type === 'system') {
    const system = get(message, 'system');
    const systemType = get(system, 'type');
    if (systemType !== 'user_changed_number' && systemType !== 'user_changed_user_id') return null;
    return {
      kind: systemType === 'user_changed_number' ? 'number_changed' : 'user_id_changed',
      phoneNumberId,
      externalUserId: sender.externalUserId,
      newExternalUserId: userId(get(system, 'user_id')) ?? userId(get(system, 'new_user_id')),
      newWaId: digits(get(system, 'wa_id')) ?? digits(get(system, 'new_wa_id')),
      at: sentAt,
      providerMessageId,
    };
  }

  const base = { providerMessageId, phoneNumberId, sender, sentAt };
  if (type === 'text') {
    const body = text(get(get(message, 'text'), 'body'), MAX_TEXT_LENGTH);
    return body
      ? { ...base, kind: 'text', text: body, replyId: null, mediaType: null }
      : { ...base, kind: 'unsupported', text: null, replyId: null, mediaType: null };
  }
  if (type === 'interactive' || type === 'button') {
    const interactive = get(message, 'interactive');
    const pressed = get(interactive, 'button_reply') ?? get(interactive, 'list_reply');
    const button = get(message, 'button');
    const replyId =
      text(get(pressed, 'id'), REPLY_ID_MAX) ?? text(get(button, 'payload'), REPLY_ID_MAX);
    if (replyId) return { ...base, kind: 'reply', text: null, replyId, mediaType: null };
  }
  if (MEDIA_TYPES.has(type)) {
    return { ...base, kind: 'media', text: null, replyId: null, mediaType: type };
  }
  return { ...base, kind: 'unsupported', text: null, replyId: null, mediaType: null };
}

function readStatus(status: Json): StatusUpdate | null {
  const providerMessageId = messageId(get(status, 'id'));
  const at = epochSeconds(get(status, 'timestamp'));
  const state = get(status, 'status');
  if (!providerMessageId || !at || typeof state !== 'string' || !DELIVERY_STATES.has(state)) {
    return null;
  }
  const pricing = get(status, 'pricing');
  return {
    providerMessageId,
    state: state as DeliveryState,
    at,
    recipientUserId: userId(get(status, 'recipient_user_id')),
    errorCodes: list(get(status, 'errors'))
      .map((error) => get(error, 'code'))
      .filter((code): code is number => typeof code === 'number' && Number.isInteger(code)),
    pricingCategory: text(get(pricing, 'category'), 40),
    billable: (() => {
      const billable = get(pricing, 'billable');
      return typeof billable === 'boolean' ? billable : null;
    })(),
  };
}

/**
 * Reads a verified webhook body. Never throws on odd input: an unexpected shape yields fewer
 * items, so one malformed entry cannot block the rest of a batch.
 */
export function parseWhatsAppWebhook(payload: unknown): ParsedWebhook {
  const inbound: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const identityChanges: IdentityChange[] = [];
  if (!isObject(payload) || get(payload, 'object') !== 'whatsapp_business_account') {
    return { inbound, statuses, identityChanges };
  }
  for (const entry of list(get(payload, 'entry'))) {
    for (const change of list(get(entry, 'changes'))) {
      if (get(change, 'field') !== 'messages' || !isObject(get(change, 'value'))) continue;
      const value = get(change, 'value');
      if (get(value, 'messaging_product') !== 'whatsapp') continue;
      const metadata = get(value, 'metadata');
      const phoneNumberId = digits(get(metadata, 'phone_number_id'));
      if (!phoneNumberId) continue;
      const contacts = list(get(value, 'contacts'));
      for (const message of list(get(value, 'messages'))) {
        const read = readInbound(message, contacts, phoneNumberId);
        if (!read) continue;
        if ('newExternalUserId' in read) identityChanges.push(read);
        else inbound.push(read);
      }
      for (const status of list(get(value, 'statuses'))) {
        const read = readStatus(status);
        if (read) statuses.push(read);
      }
    }
  }
  return { inbound, statuses, identityChanges };
}
