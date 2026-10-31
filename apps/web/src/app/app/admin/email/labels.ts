/**
 * Plain words for the Email Delivery page. Stored event types and diagnostics are never shown
 * as they are: each maps to a name or a reason a staff member can act on.
 */

export const EMAIL_KIND_LABELS: Readonly<Record<string, string>> = {
  CLIENT_INVITATION_CREATED: 'Client Invitation',
  TEAM_INVITATION_CREATED: 'Team Invitation',
  TEAM_MEMBER_ADDED: 'Added to Team',
  SHARING_INVITATION_CREATED: 'Sharing Invitation',
  EVIDENCE_REQUEST_CREATED: 'Document Request',
  EVIDENCE_REVIEW_ACCEPTED: 'Document Accepted',
  EVIDENCE_REPLACEMENT_REQUESTED: 'Document Replacement Asked',
  MISSION_STATUS_CHANGED: 'Case Update',
  APPOINTMENT_SCHEDULED: 'Appointment',
  PLATFORM_ROLE_GRANTED: 'Staff Role Given',
  PLATFORM_ROLE_REVOKED: 'Staff Role Removed',
  DOWNGRADE_SCHEDULED: 'Plan Change Scheduled',
  DOWNGRADE_EXECUTED: 'Plan Changed',
  TASK_DEADLINE: 'Task Reminder',
  DOCUMENT_EXPIRY: 'Document Expiry Reminder',
  VERIFICATION_EXPIRY: 'Check Expiry Reminder',
  INACTIVE_ACCOUNT_NOTICE: 'Inactive Account Notice',
  CASE_RETENTION_NOTICE: 'Case Retention Notice',
  LEGAL_HOLD_REVIEW_REMINDER: 'Legal Hold Reminder',
  WHATSAPP_CONNECTED: 'WhatsApp Connected',
  CONTRIBUTOR_REQUEST_CREATED: 'Document Request to Someone Else',
  INVOICE_ISSUED: 'New Invoice',
  INVOICE_REMINDER: 'Invoice Reminder',
  BILLING_STATUS_CHANGED: 'Billing Status Change',
  INVOICE_REFUNDED: 'Invoice Refund',
  INVOICE_CREDIT_APPLIED: 'Credit Applied',
  PERSON_PLAN_RENEWAL_DUE: 'Plan Renewal Reminder',
  PERSON_PLAN_ENDED: 'Paid Plan Ended',
  PERSON_REFUND_RECORDED: 'Traveller Refund',
};

export const OTHER_EMAIL_KIND = 'Other Email';

export function emailKindLabel(eventType: string): string {
  return Object.hasOwn(EMAIL_KIND_LABELS, eventType)
    ? (EMAIL_KIND_LABELS[eventType] ?? OTHER_EMAIL_KIND)
    : OTHER_EMAIL_KIND;
}

const BOUNCED_REASON =
  'The receiving address refused it. Check the address with the person before asking them to try again.';
const UNKNOWN_REASON = 'The email could not be sent. No more detail was kept.';

/** A plain reason for a failed or retrying email. The stored text itself is never shown. */
export function emailProblemReason(status: string, lastError: string | null): string {
  if (status === 'BOUNCED') return BOUNCED_REASON;
  const error = lastError ?? '';
  if (error === 'recipient no longer authorized') {
    return 'The person no longer has access to what this email was about, so it was not sent.';
  }
  if (error === 'no recipient email resolvable') {
    return 'There was no email address to send it to.';
  }
  if (error === 'Email provider not configured') {
    return 'Email sending is not set up here yet.';
  }
  if (error === 'Email provider unavailable or request timed out') {
    return 'The email service did not answer in time.';
  }
  if (/^Email provider returned status 5\d\d$/.test(error)) {
    return 'The email service had a problem on its side.';
  }
  if (/^Email provider returned status 4\d\d$/.test(error)) {
    return 'The email service turned the email away.';
  }
  if (error === 'The email provider rejected this message.') {
    return 'The email service turned the email away after accepting it.';
  }
  if (
    error === 'Email provider did not confirm acceptance' ||
    error === 'Email delivery failed; provider acceptance was not confirmed'
  ) {
    return 'The email service did not confirm it took the email.';
  }
  if (error === 'Invalid email idempotency key') {
    return 'The email could not be prepared for sending.';
  }
  return UNKNOWN_REASON;
}
