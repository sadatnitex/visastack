import {
  type WhatsAppOutgoing,
  type WhatsAppPort,
  WhatsAppSendError,
  type WhatsAppSendResult,
  checkOutgoing,
} from '@visastack/services';

export interface WhatsAppCloudPortOptions {
  /** A system user access token with `whatsapp_business_messaging`. */
  readonly accessToken: string;
  /** Graph API version, for example `v26.0` (research file section 1). */
  readonly apiVersion: string;
  /** Injectable for tests; defaults to the real API. */
  readonly apiBaseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Abort a send that takes longer than this. */
  readonly timeoutMs?: number;
}

interface GraphSendResponse {
  readonly messages?: readonly { readonly id?: string }[];
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** Errors Meta may succeed on later: throttling and its own temporary failures. */
const RETRYABLE_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131056]);

/**
 * Sends WhatsApp messages through Meta's Cloud API (`POST /{phone-number-id}/messages`) with a
 * single `fetch`, like `ResendEmailPort`, instead of an SDK. Never logs the recipient or the
 * message. The request shapes follow Meta's message reference as recorded in the research file
 * (sections 5 and 8) and must be re-checked against the live reference before go-live.
 */
export class WhatsAppCloudPort implements WhatsAppPort {
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WhatsAppCloudPortOptions) {
    if (!options.accessToken) throw new Error('WhatsApp access token is missing');
    if (!/^v\d+\.\d+$/.test(options.apiVersion)) throw new Error('WhatsApp API version is invalid');
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://graph.facebook.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(phoneNumberId: string, message: WhatsAppOutgoing): Promise<WhatsAppSendResult> {
    if (!/^\d{6,20}$/.test(phoneNumberId)) throw new Error('WhatsApp phone number id is invalid');
    checkOutgoing(message);
    const url = `${this.apiBaseUrl}/${this.apiVersion}/${phoneNumberId}/messages`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toGraphMessage(message)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new WhatsAppSendError('WhatsApp could not be reached', null, true);
    }
    const body = (await response.json().catch(() => ({}))) as GraphSendResponse;
    const id = body.messages?.[0]?.id;
    if (response.ok && typeof id === 'string' && id.length > 0) return { providerMessageId: id };
    const code = typeof body.error?.code === 'number' ? body.error.code : null;
    const retryable = response.status >= 500 || (code !== null && RETRYABLE_CODES.has(code));
    throw new WhatsAppSendError(
      `WhatsApp refused the message (HTTP ${response.status})`,
      code,
      retryable,
    );
  }
}

/** Meta's request body for each kind of message VisaStack sends. */
export function toGraphMessage(message: WhatsAppOutgoing): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: message.to.waId };
  switch (message.kind) {
    case 'text':
      return { ...base, type: 'text', text: { body: message.body, preview_url: false } };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.body },
          action: {
            buttons: message.buttons.map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.body },
          action: {
            button: message.buttonLabel,
            sections: [
              {
                title: 'VisaStack',
                rows: message.rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  ...(row.description ? { description: row.description } : {}),
                })),
              },
            ],
          },
        },
      };
    case 'link':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: message.body },
          action: {
            name: 'cta_url',
            parameters: { display_text: message.label, url: message.url },
          },
        },
      };
  }
}
