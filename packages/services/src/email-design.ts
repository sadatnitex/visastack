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

import { isAccessibleAccentColor } from './branding';
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
  /** A one-time code to type, shown large on its own (UMPE P8 guest code). */
  readonly code?: string;
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

/**
 * The agency an email speaks for (UMPE G3, A19): its name, and its accent colour when it has one.
 * Give it only for an agency VisaStack has reviewed (ACTIVE); the caller reads both live.
 */
export interface EmailAgencyBrand {
  readonly name: string;
  readonly accentColor: string | null;
}

/** The longest agency name an email shows; longer names are cut, never wrapped into the layout. */
const AGENCY_NAME_LIMIT = 120;

/** An agency name as every email writes it: one line, no extra spaces, at most 120 characters. */
export function cleanAgencyName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, AGENCY_NAME_LIMIT).trim();
}

/**
 * The agency brand an email may show, or null: a name with no line breaks or extra spaces, and an
 * accent only when it is a plain `#rrggbb` colour readable with white text on it (the product's own
 * accent rule). Anything else falls back to VisaStack's own colours.
 */
export function emailAgencyBrand(
  brand: EmailAgencyBrand | null | undefined,
): { readonly name: string; readonly accent: string | null } | null {
  if (!brand) return null;
  const name = cleanAgencyName(brand.name);
  if (name.length === 0) return null;
  const accent =
    typeof brand.accentColor === 'string' && isAccessibleAccentColor(brand.accentColor)
      ? brand.accentColor.toLowerCase()
      : null;
  return { name, accent };
}

const POWERED_BY = 'Powered by VisaStack';

export function renderEmail(
  content: EmailContent,
  context: {
    readonly baseUrl: string;
    readonly recipient: string;
    /** UMPE G3: the reviewed agency this email is sent for. */
    readonly agency?: EmailAgencyBrand | null;
  },
): RenderedEmail {
  const url = safeUrl(content.action.url, context.baseUrl);
  const logo = `${productOrigin(context.baseUrl)}/icons/icon-192.png`;
  const sentTo = `This email was sent to ${context.recipient}.`;
  const agency = emailAgencyBrand(context.agency);
  const accent = agency?.accent ?? ACCENT;
  const footer = agency
    ? `${agency.name} sent this request through VisaStack. You decide what is shared with them, and nothing is shared until you send it.`
    : FOOTER;

  const text = [
    content.heading,
    '',
    content.fact,
    ...(content.code ? ['', `Your code: ${content.code}`] : []),
    ...(content.why ? ['', content.why] : []),
    '',
    `${content.action.label}: ${url}`,
    ...(content.after ? ['', content.after] : []),
    '',
    // "-- " is the standard signature line, so replies leave the footer out.
    '-- ',
    ...(agency ? [agency.name, POWERED_BY] : ['VisaStack']),
    footer,
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
${
  agency
    ? `<tr><td style="background:${CARD};border:1px solid ${HAIRLINE};border-bottom:0;border-top:4px solid ${accent};border-radius:16px 16px 0 0;padding:20px 28px 0;">
<p style="margin:0;font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${INK};">${e(agency.name)}</p>
</td></tr>`
    : `<tr><td style="background:${INK};border-radius:16px 16px 0 0;padding:20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="${e(logo)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px;"></td>
<td style="vertical-align:middle;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">VisaStack</td>
</tr></table>
</td></tr>`
}
<tr><td style="background:${CARD};border:1px solid ${HAIRLINE};border-top:0;border-radius:0 0 16px 16px;padding:32px 28px 28px;">
<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${accent};">${e(content.eyebrow)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${INK};">${e(content.heading)}</h1>
${paragraph(content.fact, INK, 16, '0 0 12px')}
${content.code ? `<p style="margin:8px 0 20px;font-size:32px;line-height:1.2;font-weight:700;letter-spacing:0.3em;font-family:Menlo,Consolas,monospace;color:${INK};">${e(content.code)}</p>` : ''}
${content.why ? paragraph(content.why, BODY, 15, '0 0 24px') : '<div style="height:12px;"></div>'}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:980px;background:${accent};">
<a href="${e(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:980px;">${e(content.action.label)}</a>
</td></tr></table>
${content.after ? paragraph(content.after, BODY, 14, '24px 0 0') : ''}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">If the button does not open, copy this address into your browser:<br><a href="${e(url)}" style="color:${accent};word-break:break-all;">${e(url)}</a></p>
</td></tr>
<tr><td style="padding:20px 28px 0;">
${paragraph(footer, MUTED, 12, '0 0 6px')}
${paragraph(sentTo, MUTED, 12, '0')}
${agency ? `<p style="margin:12px 0 0;font-size:11px;line-height:1.5;color:${MUTED};"><img src="${e(logo)}" width="14" height="14" alt="" style="display:inline-block;vertical-align:-2px;border:0;border-radius:3px;margin-right:6px;">${POWERED_BY}</p>` : ''}
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
  /** A guest's one-time code, unsealed at send time (UMPE P8). */
  readonly code?: string;
}

interface Copy {
  readonly eyebrow: string;
  readonly heading: string | ((input: NotificationEmailInput) => string);
  readonly why?: string;
  readonly action: string | ((input: NotificationEmailInput) => string);
  readonly after?: string | ((input: NotificationEmailInput) => string | undefined);
}

/** An expiry reminder that leads to Replace With a Newer Document (lane LC-B). */
function opensReplace(input: NotificationEmailInput): boolean {
  try {
    return (
      new URL(input.url, 'https://placeholder.invalid').searchParams.get('action') === 'REPLACE'
    );
  } catch {
    return false;
  }
}

/**
 * The words around each kind of notification. The specific fact (`summary`) comes from the event
 * itself; these say what it means and what to do. Honest: no promise of an outcome, no urgency or
 * count the event does not carry. Keyed by every kind of email the product sends, so a new kind
 * without its own words does not compile; anything else still gets the full design.
 */
export type EmailEventType =
  | NotificationEventType
  | 'INACTIVE_ACCOUNT_NOTICE'
  | 'LEGAL_HOLD_REVIEW_REMINDER'
  | 'TEAM_MEMBER_ADDED'
  | 'WHATSAPP_CONNECTED'
  | 'DOCUMENT_SELF_DELETED'
  | 'TEAM_INVITATION_CREATED'
  | 'CLIENT_INVITATION_CREATED'
  | 'SHARING_INVITATION_CREATED'
  | 'CONTRIBUTOR_REQUEST_CREATED'
  | 'TRIP_COMPANION_INVITATION_CREATED'
  | 'AGENCY_COLLECTION_REQUEST_SENT'
  | 'AGENCY_COLLECTION_GUEST_CODE'
  | 'AGENCY_COLLECTION_GUEST_CORRECTION';

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
  // Lane D: never the person, the kind of file, the file name or any reason; the agency opens the request.
  EVIDENCE_RESPONSE_RECEIVED: {
    eyebrow: 'Your Agency',
    heading: 'Evidence arrived for one of your requests',
    why: 'Open the request to see the exact copy that was sent. Received is not accepted until a reviewer accepts it.',
    action: 'Open the Request',
  },
  // Sharing that ends within a week. Never a link that changes anything: it opens the sharing
  // page, where the person taps the button themselves.
  GRANT_ENDING_REMINDER: {
    eyebrow: 'Your Sharing',
    heading: 'Your sharing is about to end',
    why: 'After that date they cannot see what you shared. Keeping it going takes one tap.',
    action: 'Keep Sharing for 30 More Days',
    after: 'Not needed any more? Do nothing and it ends on its own.',
  },
  // For the agency's owners and admins; the agency cannot extend its own access.
  AGENCY_ACCESS_ENDING: {
    eyebrow: 'Your Agency',
    heading: 'Access to a client is about to end',
    why: 'After that date you cannot open the case.',
    action: 'Open the Case',
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
    action: (input) => (opensReplace(input) ? 'Replace It' : 'Check the Date'),
    after: (input) =>
      opensReplace(input)
        ? 'Renewed already? Replace It puts the new one in place, and each case that used the old one asks you to confirm it again.'
        : undefined,
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
  PERSON_PLAN_RENEWAL_DUE: {
    eyebrow: 'Your Plan',
    heading: ({ timing }) =>
      timing === 'overdue'
        ? 'Your paid plan has ended: you can still renew it'
        : timing === 'today'
          ? 'Your paid plan ends today'
          : 'Your paid plan ends soon',
    why: 'Renew it to keep your extra room. Nothing is charged unless you pay.',
    action: 'Renew Your Plan',
    after:
      'Do not want it any more? Choose Stop Renewing on Plan & Usage and we stop reminding you.',
  },
  PERSON_REFUND_RECORDED: {
    eyebrow: 'Your Plan',
    heading: 'A refund was made',
    why: 'Your Billing History shows the refund. It can take a few days to reach the account you paid from.',
    action: 'See Billing History',
  },
  PERSON_PLAN_ENDED: {
    eyebrow: 'Your Plan',
    heading: 'Your paid plan has ended',
    why: 'You are on Traveller Free again. Everything you stored is kept.',
    action: 'See Your Plan',
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
  // The fact (reference code and moment) comes from the event; no file name, kind or person is ever
  // in this email. The fact already carries the plain step if the owner did not do it.
  DOCUMENT_SELF_DELETED: {
    eyebrow: 'Your Record',
    heading: 'A document was removed from your record',
    why: 'The file is hidden at once and its stored copies are erased and checked. A removal cannot be undone. Backup copies expire within 90 days and are never brought back.',
    action: 'See Removal Records',
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
  // UMPE UX6: never the organiser, the trip, the route or the other people. Joining and what is
  // shared are the invited person's choice; nobody gets access to anyone's documents.
  TRIP_COMPANION_INVITATION_CREATED: {
    eyebrow: 'Invitation',
    heading: 'Someone added you to a trip',
    why: 'You choose whether to join and what to share. Nobody gets access to your documents.',
    action: 'Open Your Invitation',
    after: 'Not expecting this? Ignore this email and nothing happens.',
  },
  // UMPE P6: never the route, the documents or the person; opening the link shares nothing.
  AGENCY_COLLECTION_REQUEST_SENT: {
    eyebrow: 'A Request for You',
    heading: 'An agency asked you for documents',
    action: 'Open the Request',
  },
  // UMPE P7: never the person, the route or what was shared; the agency opens the request to see.
  AGENCY_COLLECTION_RESPONSE_SUBMITTED: {
    eyebrow: 'Your Agency',
    heading: 'An answer was submitted to your agency',
    why: 'Open the request to see exactly what was shared. Submitted means it arrived, not that anyone has reviewed it.',
    action: 'Open the Request',
  },
  // UMPE P8: the code only, never the person, the route or the documents.
  AGENCY_COLLECTION_GUEST_CODE: {
    eyebrow: 'Your Code',
    heading: 'Your one-time code',
    why: 'Type it on the page where you asked for it. It works once, for 10 minutes.',
    action: 'Return to the Request',
    after: 'VisaStack will never ask you for this code by phone or message.',
  },
  // UMPE G3: the agency asked a guest to correct what they sent. Never the notes, the documents,
  // the person or the route: the guest reads the notes on the request page after their code.
  AGENCY_COLLECTION_GUEST_CORRECTION: {
    eyebrow: 'Your Documents',
    heading: 'A correction was asked for',
    why: 'The agency added a note to what you sent. Open the request to see what to change, then send it again.',
    action: 'Open the Request',
    after:
      'Use the request link the agency sent you if the button asks for it. Nothing you sent before was changed.',
  },
  CASE_PACKAGE_CHANGED: {
    eyebrow: 'Your Trip',
    heading: 'Something changed for one of your trips',
    why: 'A document, an answer or the checklist behind your trip package changed.',
    action: 'Review the Trip Package',
    after: 'Nothing was shared or sent to anyone. Your earlier choices stay as they were.',
  },
  // UMPE P11: the rule change only, never the person's documents or answers.
  CASE_RULE_CHANGED: {
    eyebrow: 'Your Trip',
    heading: 'A checklist for one of your trips was updated',
    why: 'A newer official checklist was published. Your trip still follows the earlier one until you review it.',
    action: 'Review the Trip Package',
    after: 'Nothing in your trip was changed, shared or sent to anyone.',
  },
  // UMPE G4: a family file waits for Which Person?; never its name or who it might be.
  DOCUMENT_HELD_REMINDER: {
    eyebrow: 'Your Documents',
    heading: 'A file is waiting for you to choose who it belongs to',
    why: 'You added it for your family and it has waited a week. Only you can see it.',
    action: 'Choose Who It Belongs To',
    after: 'Files nobody chooses for are removed after 30 days.',
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
  const after = typeof copy?.after === 'function' ? copy.after(input) : copy?.after;
  return {
    preheader: input.summary,
    eyebrow: copy?.eyebrow ?? 'VisaStack',
    heading,
    fact: input.summary,
    ...(input.code ? { code: input.code } : {}),
    ...(copy?.why ? { why: copy.why } : {}),
    action: {
      label: copy
        ? typeof copy.action === 'function'
          ? copy.action(input)
          : copy.action
        : 'Open VisaStack',
      url: input.url,
    },
    ...(after ? { after } : {}),
  };
}
