/**
 * Outgoing WhatsApp messages, as the channel services need them. `WhatsAppCloudPort` in
 * `@visastack/adapters` sends them through Meta's Cloud API; tests use `RecordingWhatsAppPort`.
 *
 * Limits are Meta's (research file section 8): at most 3 reply buttons with titles of 20
 * characters, at most 10 list rows with titles of 24 and descriptions of 72 characters, and a
 * body of at most 1,024 characters for interactive messages. `checkOutgoing` enforces them, so a
 * bad message fails in VisaStack's own tests rather than at Meta.
 */

export interface WhatsAppRecipient {
  /** The phone id Meta gave on the person's latest message. */
  readonly waId: string;
}

export interface ReplyButton {
  readonly id: string;
  readonly title: string;
}

export interface ListRow {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
}

export type WhatsAppOutgoing =
  | { readonly kind: 'text'; readonly to: WhatsAppRecipient; readonly body: string }
  | {
      readonly kind: 'buttons';
      readonly to: WhatsAppRecipient;
      readonly body: string;
      readonly buttons: readonly ReplyButton[];
    }
  | {
      readonly kind: 'list';
      readonly to: WhatsAppRecipient;
      readonly body: string;
      readonly buttonLabel: string;
      readonly rows: readonly ListRow[];
    }
  | {
      readonly kind: 'link';
      readonly to: WhatsAppRecipient;
      readonly body: string;
      readonly label: string;
      /** Always an absolute HTTPS VisaStack link built with the deep-link routes. */
      readonly url: string;
    };

export interface WhatsAppSendResult {
  readonly providerMessageId: string;
}

export interface WhatsAppPort {
  /** Sends from the given business number. Throws `WhatsAppSendError` on refusal. */
  send(phoneNumberId: string, message: WhatsAppOutgoing): Promise<WhatsAppSendResult>;
}

/** Meta refused or could not take a message. `code` is Meta's error code when it gave one. */
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

/** Meta error codes this channel acts on (research file sections 14 and 18). */
export const WHATSAPP_ERROR = {
  /** The person blocked the business: never send again until they write first. */
  BLOCKED: 130403,
  /** Too many messages to one person in a short time. */
  PAIR_RATE_LIMIT: 131056,
  /** Business throughput limit reached. */
  THROUGHPUT: 130429,
} as const;

export const LIMITS = {
  body: 1024,
  text: 4096,
  buttons: 3,
  buttonTitle: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  replyId: 256,
  listButton: 20,
  linkLabel: 20,
} as const;

/** Throws when a message would break Meta's limits. */
export function checkOutgoing(message: WhatsAppOutgoing): void {
  const fail = (what: string) => {
    throw new Error(`WhatsApp message breaks a limit: ${what}`);
  };
  if (!/^\d{6,20}$/.test(message.to.waId)) fail('recipient');
  if (message.kind === 'text') {
    if (message.body.length === 0 || message.body.length > LIMITS.text) fail('text length');
    return;
  }
  if (message.body.length === 0 || message.body.length > LIMITS.body) fail('body length');
  if (message.kind === 'buttons') {
    if (message.buttons.length === 0 || message.buttons.length > LIMITS.buttons) fail('buttons');
    for (const button of message.buttons) {
      if (button.title.length > LIMITS.buttonTitle) fail('button title');
      if (button.id.length > LIMITS.replyId) fail('button id');
    }
  }
  if (message.kind === 'list') {
    if (message.buttonLabel.length > LIMITS.listButton) fail('list button');
    if (message.rows.length === 0 || message.rows.length > LIMITS.rows) fail('rows');
    for (const row of message.rows) {
      if (row.title.length > LIMITS.rowTitle) fail('row title');
      if ((row.description?.length ?? 0) > LIMITS.rowDescription) fail('row description');
      if (row.id.length > LIMITS.replyId) fail('row id');
    }
  }
  if (message.kind === 'link') {
    if (message.label.length > LIMITS.linkLabel) fail('link label');
    if (!message.url.startsWith('https://')) fail('link must be https');
  }
}
