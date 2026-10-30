/**
 * How every VisaStack email looks and reads. One design for all of them: a calm branded header, a
 * heading that says what happened in plain words, the specific fact, why it matters, one clear
 * button, what happens next, and a footer that reminds the reader they stay in control.
 *
 * Every piece of text is escaped before it goes into the HTML, so a name, a case title or a reason
 * typed by a person can never become markup. Each email also carries the same words as plain text.
 * No tracking pixel, no link wrapping, no remote fonts. The one image is the VisaStack mark from
 * the product's own address, the same file for everyone (no identifier in it); the email reads the
 * same with images off.
 */

import type { NotificationEventType } from './notifications';

/** The brand's own colours (the product's tokens), written out because email cannot read CSS variables. */
const INK = '#13243d';
const BODY = '#516174';
const MUTED = '#596879';
const ACCENT = '#1d4c98';
const PAGE = '#f7f9fe';
const CARD = '#ffffff';
const HAIRLINE = '#e4e9f1';

export interface EmailContent {
  /** The hidden line many inboxes show after the subject. */
  readonly preheader: string;
  /** A short label above the heading, for example "Your Case". */
  readonly eyebrow: string;
  readonly heading: string;
  /** The specific fact: which case, which document, which date. */
  readonly fact: string;
  /** Why it matters, in one or two calm sentences. */
  readonly why?: string;
  readonly action: { readonly label: string; readonly url: string };
  /** What happens next, or a reassurance. */
  readonly after?: string;
}

export interface RenderedEmail {
  readonly text: string;
  readonly html: string;
}

const FOOTER =
  'VisaStack keeps one visa record you reuse for every application. You decide what is shared, with whom and for how long.';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The product's own origin, read with the URL parser (never by trimming text). */
function productOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

/** Only a web address on this product's own origin may sit behind the button. */
function safeUrl(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    if (parsed.origin !== base.origin || !/^https?:$/.test(parsed.protocol)) return base.href;
    return parsed.href;
  } catch {
    return baseUrl;
  }
}

export function renderEmail(
  content: EmailContent,
  context: { readonly baseUrl: string; readonly recipient: string },
): RenderedEmail {
  const url = safeUrl(content.action.url, context.baseUrl);
  const logo = `${productOrigin(context.baseUrl)}/icons/icon-192.png`;
  const sentTo = `This email was sent to ${context.recipient}.`;

  const text = [
    content.heading,
    '',
    content.fact,
    ...(content.why ? ['', content.why] : []),
    '',
    `${content.action.label}: ${url}`,
    ...(content.after ? ['', content.after] : []),
    '',
    // "-- " is the standard signature line, so replies leave the footer out.
    '-- ',
    'VisaStack',
    FOOTER,
    sentTo,
  ].join('\n');

  const e = escapeHtml;
  const paragraph = (value: string, color: string, size: number, margin: string) =>
    `<p style="margin:${margin};font-size:${size}px;line-height:1.55;color:${color};">${e(value)}</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE};">${e(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td style="background:${INK};border-radius:16px 16px 0 0;padding:20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="${e(logo)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px;"></td>
<td style="vertical-align:middle;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">VisaStack</td>
</tr></table>
</td></tr>
<tr><td style="background:${CARD};border:1px solid ${HAIRLINE};border-top:0;border-radius:0 0 16px 16px;padding:32px 28px 28px;">
<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">${e(content.eyebrow)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${INK};">${e(content.heading)}</h1>
${paragraph(content.fact, INK, 16, '0 0 12px')}
${content.why ? paragraph(content.why, BODY, 15, '0 0 24px') : '<div style="height:12px;"></div>'}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:980px;background:${ACCENT};">
<a href="${e(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:980px;">${e(content.action.label)}</a>
</td></tr></table>
${content.after ? paragraph(content.after, BODY, 14, '24px 0 0') : ''}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">If the button does not open, copy this address into your browser:<br><a href="${e(url)}" style="color:${ACCENT};word-break:break-all;">${e(url)}</a></p>
</td></tr>
<tr><td style="padding:20px 28px 0;">
${paragraph(FOOTER, MUTED, 12, '0 0 6px')}
${paragraph(sentTo, MUTED, 12, '0')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { text, html };
}

/** The notification as it is stored: the in-app title, its one-line fact and where it leads. */
export interface NotificationEmailInput {
  readonly eventType: string;
  readonly subject: string;
  readonly summary: string;
  readonly url: string;
  /** Task and invoice reminders: whether the due day is ahead, today or past. */
  readonly timing?: 'upcoming' | 'today' | 'overdue';
  /** The heading this one notice asked for (billing status changes, the 7-day reminder; S30). */
  readonly heading?: string;
}

interface Copy {
  readonly eyebrow: string;
  readonly heading: string | ((input: NotificationEmailInput) => string);
  readonly why?: string;
  readonly action: string;
  readonly after?: string;
}

/**
 * The words around each kind of notification. The specific fact (`summary`) comes from the event
 * itself; these say what it means and what to do. Honest: no promise of an outcome, no urgency or
 * count the event does not carry. Keyed by every kind of email the product sends, so a new kind
 * without its own words does not compile; anything else still gets the full design.
 */
type EmailEventType =
  | NotificationEventType
  | 'INACTIVE_ACCOUNT_NOTICE'
  | 'LEGAL_HOLD_REVIEW_REMINDER'
  | 'TEAM_MEMBER_ADDED'
  | 'WHATSAPP_CONNECTED'
  | 'TEAM_INVITATION_CREATED'
  | 'CLIENT_INVITATION_CREATED'
  | 'SHARING_INVITATION_CREATED'
  | 'CONTRIBUTOR_REQUEST_CREATED';

export const NOTIFICATION_EMAIL_COPY: Readonly<Record<EmailEventType, Copy>> = {
  EVIDENCE_REQUEST_CREATED: {
    eyebrow: 'Your Case',
    heading: 'Your agency needs something from you',
    why: 'You can reply with documents you already keep in VisaStack. You choose exactly what to send.',
    action: 'See the Request',
    after: 'Nothing is shared until you send it.',
  },
  EVIDENCE_REVIEW_ACCEPTED: {
    eyebrow: 'Your Case',
    heading: 'Good news: what you sent was accepted',
    why: 'One more piece of your file is in place.',
    action: 'See Your Case',
    after: "Accepted by your agency's reviewer for your file. It is not a decision on your visa.",
  },
  EVIDENCE_REPLACEMENT_REQUESTED: {
    eyebrow: 'Your Case',
    heading: 'Your agency needs a fresh copy',
    why: 'The reviewer says what to change. A quick replacement keeps your case moving.',
    action: 'See What to Replace',
  },
  MISSION_STATUS_CHANGED: {
    eyebrow: 'Your Case',
    heading: 'There is an update on your case',
    why: 'Open your case to see what was recorded and anything you can do next.',
    action: 'See the Update',
  },
  APPOINTMENT_SCHEDULED: {
    eyebrow: 'Your Case',
    heading: 'An appointment is set for you',
    why: 'See the time and the place, and add it to your calendar in one tap.',
    action: 'See the Appointment',
  },
  TASK_DEADLINE: {
    eyebrow: 'Your Case',
    heading: ({ timing }) =>
      timing === 'today'
        ? 'A task on your case is due today'
        : timing === 'overdue'
          ? 'A task on your case is past its date'
          : 'A task on your case is coming up',
    why: 'Keeping each step on time keeps the whole case moving. It takes a minute to check.',
    action: 'Open Your Case',
    after: 'Already done? Mark it done on your case and these reminders stop.',
  },
  DOCUMENT_EXPIRY: {
    eyebrow: 'Your Documents',
    heading: 'A document is close to its expiry date',
    why: 'Renewing in good time keeps every application you prepare ready to go.',
    action: 'Check the Date',
  },
  VERIFICATION_EXPIRY: {
    eyebrow: 'Your Documents',
    heading: 'An issuer confirmation is about to run out',
    why: 'Once it runs out, the document stays in your record but is no longer shown as confirmed.',
    action: 'Check the Confirmation',
  },
  CASE_RETENTION_NOTICE: {
    eyebrow: 'Your Case',
    heading: 'A closed case is due to be cleared',
    action: 'Open the Case',
    after: 'Your profile and documents stay; only the closed case records go.',
  },
  INACTIVE_ACCOUNT_NOTICE: {
    eyebrow: 'Your Account',
    heading: 'Your account has been quiet for a while',
    why: 'Signing in once keeps your account and everything in it.',
    action: 'Sign In',
  },
  DOWNGRADE_SCHEDULED: {
    eyebrow: 'Your Agency',
    heading: 'A plan change is coming up',
    action: 'See Your Plan',
  },
  DOWNGRADE_EXECUTED: {
    eyebrow: 'Your Agency',
    heading: 'Your plan has changed',
    action: 'See Your Plan',
  },
  INVOICE_ISSUED: {
    eyebrow: 'Your Agency',
    heading: 'A new invoice is ready',
    why: 'Open your invoices to see it and the ways to pay.',
    action: 'Pay Invoice',
  },
  INVOICE_REMINDER: {
    eyebrow: 'Your Agency',
    heading: ({ timing, heading }) =>
      heading ??
      (timing === 'today'
        ? 'An invoice is due today'
        : timing === 'overdue'
          ? 'An invoice is past its due date'
          : 'An invoice is due soon'),
    why: 'Open your invoices to see it and the ways to pay.',
    action: 'Pay Invoice',
    after:
      'Already paid? Thank you. A payment made another way shows in your invoices once we confirm it.',
  },
  BILLING_STATUS_CHANGED: {
    eyebrow: 'Your Agency',
    heading: ({ heading }) => heading ?? 'Your billing status has changed',
    action: 'Open Invoices',
  },
  INVOICE_REFUNDED: {
    eyebrow: 'Your Agency',
    heading: 'A refund was made on an invoice',
    why: 'Open your invoices to see the refund and what the invoice shows now.',
    action: 'Open Invoices',
  },
  INVOICE_CREDIT_APPLIED: {
    eyebrow: 'Your Agency',
    heading: 'An earlier payment was applied to an invoice',
    why: 'Money you paid before was counted towards this invoice. Open your invoices to see what is left to pay.',
    action: 'Open Invoices',
  },
  LEGAL_HOLD_REVIEW_REMINDER: {
    eyebrow: 'Platform',
    heading: 'A legal hold is due for review',
    action: 'Review the Hold',
  },
  PLATFORM_ROLE_GRANTED: {
    eyebrow: 'Your Account',
    heading: 'You have a new role on VisaStack',
    action: 'Open Your Account',
    after: 'Not expecting this? Tell your administrator.',
  },
  PLATFORM_ROLE_REVOKED: {
    eyebrow: 'Your Account',
    heading: 'A role on your account has ended',
    action: 'Open Your Account',
    after: 'Not expecting this? Tell your administrator.',
  },
  TEAM_MEMBER_ADDED: {
    eyebrow: 'Your Agency',
    heading: 'Welcome to the team',
    action: 'Open VisaStack',
  },
  WHATSAPP_CONNECTED: {
    eyebrow: 'Your Account',
    heading: 'WhatsApp is now connected',
    action: 'Review WhatsApp Settings',
  },
  TEAM_INVITATION_CREATED: {
    eyebrow: 'Invitation',
    heading: 'You are invited to join an agency team',
    action: 'Open Your Invitation',
  },
  CLIENT_INVITATION_CREATED: {
    eyebrow: 'Invitation',
    heading: 'An agency would like to work with you',
    action: 'Open Your Invitation',
  },
  SHARING_INVITATION_CREATED: {
    eyebrow: 'Invitation',
    heading: 'You are invited to review shared information',
    action: 'Open Your Invitation',
  },
  CONTRIBUTOR_REQUEST_CREATED: {
    eyebrow: 'A Request for You',
    heading: 'Someone asked you for one document',
    action: 'See the Request',
  },
};

export function notificationEmail(input: NotificationEmailInput): EmailContent {
  const copy = (NOTIFICATION_EMAIL_COPY as Readonly<Record<string, Copy | undefined>>)[
    input.eventType
  ];
  const heading = copy
    ? typeof copy.heading === 'function'
      ? copy.heading(input)
      : copy.heading
    : input.subject;
  return {
    preheader: input.summary,
    eyebrow: copy?.eyebrow ?? 'VisaStack',
    heading,
    fact: input.summary,
    ...(copy?.why ? { why: copy.why } : {}),
    action: { label: copy?.action ?? 'Open VisaStack', url: input.url },
    ...(copy?.after ? { after: copy.after } : {}),
  };
}
