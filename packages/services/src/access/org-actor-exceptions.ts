/**
 * The exported service functions that are told an organization id but do not check, themselves,
 * that the person acting belongs to it (org-actor-ratchet.test.ts). Each says what kind it is and
 * why. Fixed, not a baseline: a new entry needs a reason a reviewer reads, and an entry that is no
 * longer needed fails the ratchet.
 *
 * - `internal`: never exported from the package entry (src/index.ts, held by the ratchet), so only
 *   this package can call it, and only after its own check of the person.
 * - `pure`: reads nothing; it formats, signs or builds from values the caller already holds.
 * - `staff`: a platform staff action or read. The web route checks the staff permission before the
 *   call; the organization is the subject, not something the actor belongs to.
 * - `display`: the agency's public face (name and logo), shown by design to anyone signed in who
 *   reaches an agency page or an invitation from it.
 * - `caller-checked`: called only after the caller's own check of this organization's member or
 *   of platform staff; named here so the next change to it moves the check into the service.
 */
export interface OrgActorException {
  readonly kind: 'internal' | 'pure' | 'staff' | 'display' | 'caller-checked';
  readonly reason: string;
}

export const ORG_ACTOR_EXCEPTIONS: Readonly<Record<string, OrgActorException>> = {
  // --- The agency read rule's own building blocks -----------------------------------------
  'agency#orgGrantPermits': {
    kind: 'caller-checked',
    reason:
      "answers whether an organization's grant reaches a case: a yes or no about the organization, never a record; every caller checks the person first (mayReadOrgCase, loadMissionForOrgWrite, the access gate)",
  },
  'agency#listAssignedMissionIds': {
    kind: 'internal',
    reason:
      'the case ids one member is assigned to, used by access-ends.ts after its own membership check; taken off the package entry in this change (nothing outside used it)',
  },
  'agency#applicantsSharedWithOrganization': {
    kind: 'internal',
    reason:
      'the shared-client set behind listApplicantsForOrganization (admin checked) and the storage and plan counters (quotas, plans, entitlement-enforcement), which return numbers only',
  },
  'access/grant-scope#orgCaseRecordVisibleSql': {
    kind: 'internal',
    reason:
      "a SQL condition (an organization's grant still reaches a case record), placed inside reads that have already checked the person",
  },

  // --- Plan, seat and storage counters (numbers inside a checked write or read) --------------
  'plans#countPendingInvitations': {
    kind: 'internal',
    reason: 'a count for the plan limit checks, called inside writes that checked the actor',
  },
  'plans#countActiveSeats': {
    kind: 'internal',
    reason: 'a count for the plan limit checks, called inside writes that checked the actor',
  },
  'plans#countCasesInPeriod': {
    kind: 'internal',
    reason: 'a count for the plan limit checks, called inside writes that checked the actor',
  },
  'plans#countConcurrentOpenCases': {
    kind: 'internal',
    reason: 'a count for the plan limit checks, called inside writes that checked the actor',
  },
  'entitlement-enforcement#checkSeatEntitlement': {
    kind: 'internal',
    reason:
      'the seat limit, run as the first statement of a membership write whose caller already checked the admin',
  },
  'entitlement-enforcement#checkInvitationEntitlement': {
    kind: 'internal',
    reason:
      'the invitation limit, run inside an invitation write whose caller already checked the admin',
  },
  'entitlement-enforcement#checkCaseCreationEntitlement': {
    kind: 'internal',
    reason:
      "the case limit of the organization that owns a new case, run inside createMission's own checked transaction",
  },
  'quotas#getOrganizationEvidenceBytes': {
    kind: 'caller-checked',
    reason:
      'a storage total in bytes (a number, never a record) for the plan and usage counters, whose own callers check the member',
  },
  'founding-access#assignFoundingAccess': {
    kind: 'internal',
    reason:
      'gives a newly created agency its starting plan, inside the creating transaction of createOrganization',
  },

  // --- Billing run and documents -------------------------------------------------------------
  'billing-standing#lockBillingAccount': {
    kind: 'internal',
    reason:
      "locks the agency's billing account inside the billing run's or a staff action's transaction",
  },
  'billing-standing#overdueInvoices': {
    kind: 'internal',
    reason: 'overdue invoices for the daily billing run and billing.ts reads, never shown directly',
  },
  'billing-standing#toBillingStanding': {
    kind: 'pure',
    reason: 'shapes a standing from rows the caller already read',
  },
  'billing-standing#readBillingStanding': {
    kind: 'internal',
    reason: 'the standing of a billing account the caller has already locked',
  },
  'billing-standing#billingContacts': {
    kind: 'internal',
    reason:
      "who billing notices go to (the agency's active owners and admins), for the billing run and staff billing actions",
  },
  'billing-standing#agencyCode': {
    kind: 'pure',
    reason: 'the first 8 hex characters of an organization id, for invoice references',
  },
  'billing-standing#agencyName': {
    kind: 'internal',
    reason:
      "the agency's name for the opening line of a billing notice, written by the billing run",
  },
  'billing-standing#invoicesPath': {
    kind: 'pure',
    reason: "builds the address of the agency's Invoices page; reads nothing",
  },
  'billing-cycle#cycleInvoiceRef': {
    kind: 'pure',
    reason: 'builds an invoice reference from an organization id and a date',
  },
  'billing-documents#buildInvoiceDocument': {
    kind: 'pure',
    reason: 'builds an invoice document from facts the caller already read and checked',
  },
  'billing-documents#buildReceiptDocument': {
    kind: 'pure',
    reason: 'builds a receipt document from facts the caller already read and checked',
  },
  'receipts#issueReceiptForPayment': {
    kind: 'internal',
    reason:
      "issues the receipt for one recorded payment, inside applyInvoiceCollection's locked transaction",
  },
  'payments#attemptView': {
    kind: 'pure',
    reason: 'shapes one payment attempt row the caller already read for display',
  },
  'billing#isBillingSuspended': {
    kind: 'caller-checked',
    reason:
      "whether the agency's billing reads Suspended: a yes or no about the agency, no record; no web caller",
  },
  'commercial-override#isCommercialOverrideActive': {
    kind: 'caller-checked',
    reason:
      'whether an override is live (a yes or no, no record), for the entitlement checks of writes that checked the actor',
  },
  'commercial-override#listCommercialOverridesForOrganization': {
    kind: 'staff',
    reason:
      "the owner's organization page only, after its isPlatformOwnerAccount check (apps/web admin/organizations/[orgId])",
  },
  'plans#getCurrentPlanForOrganization': {
    kind: 'staff',
    reason:
      "the owner's organization page only, after its isPlatformOwnerAccount check (apps/web admin/organizations/[orgId])",
  },
  'plans#getPendingDowngradeForOrganization': {
    kind: 'caller-checked',
    reason:
      "the owner's organization page (after its platform owner check) and the agency Plan page (after getUsageForOrganization has refused anyone who is not an active member)",
  },

  // --- Platform staff actions on an organization ----------------------------------------------
  'organizations#reviewOrganization': {
    kind: 'staff',
    reason:
      'approve or reject an agency application; the admin action checks ORGANIZATION_REVIEW and step-up first, and the service refuses a member of that agency',
  },
  'organizations#suspendOrganization': {
    kind: 'staff',
    reason: 'suspend an agency; the admin action checks ORGANIZATION_SUSPEND and step-up first',
  },
  'organizations#terminateOrganization': {
    kind: 'staff',
    reason: 'end an agency; the admin action checks its staff permission and step-up first',
  },
  'organizations#getOrganization': {
    kind: 'caller-checked',
    reason:
      'one organization row (name, status), read by the agency console after its membership read and by staff pages after their staff check',
  },

  // --- The agency's public face --------------------------------------------------------------
  'branding#getOrganizationBrandingForDisplay': {
    kind: 'display',
    reason:
      "the agency's name, colour and logo address, shown on its pages and on invitations it sends; no client or case data",
  },
  'branding#readOrganizationLogo': {
    kind: 'display',
    reason:
      "the agency's logo image for the signed-in logo route and invitation pages; no client or case data",
  },
  'branding#organizationLogoPath': {
    kind: 'pure',
    reason: "builds the logo's address from an organization id and a version",
  },

  // --- Writers that record or notify inside an already checked transaction --------------------
  'notifications#enqueueNotification': {
    kind: 'caller-checked',
    reason:
      'queues one notice inside the transaction of the business write it reports on, which checked its own actor; recipients are re-checked when it is sent',
  },
  'notifications#enqueueNotificationBothChannels': {
    kind: 'caller-checked',
    reason: 'the same as enqueueNotification, for the in-app and email copies together',
  },
  'notifications#billingNoticeStillAllowedSql': {
    kind: 'internal',
    reason:
      'a SQL condition that hides a billing notice from someone no longer an active owner or admin; it is itself that membership rule, used inside notice reads',
  },
  'product-events#recordProductEvent': {
    kind: 'caller-checked',
    reason:
      'appends one product event inside the transaction of the checked business write it describes; reads nothing back',
  },
  'invitation-email#queueInvitationEmail': {
    kind: 'internal',
    reason:
      'queues the email of an invitation its caller just created after checking its own actor',
  },

  // --- Send-time and token checks (no person acting) -----------------------------------------
  'access/guest-submission-access#guestSubmissionStillLive': {
    kind: 'caller-checked',
    reason:
      "the notification worker's send-time check that a guest submission is still live for its agency; a yes or no, no record",
  },
  'access/guest-correction-notice#guestCorrectionStillDeliverable': {
    kind: 'internal',
    reason: "the notification worker's send-time check of a guest correction email",
  },
  'access/collection-response-access#agencyMayReceiveAnswers': {
    kind: 'internal',
    reason: 'whether the agency is reviewed (ACTIVE): a yes or no about the agency itself',
  },
  'access/collection-response-access#collectionResponseStillLive': {
    kind: 'internal',
    reason: "the notification worker's send-time check that a response is still live",
  },
  'access/collection-response-access#collectionRecipientAllowed': {
    kind: 'internal',
    reason:
      'whether the signed-in account is the person an agency link was sent to (its email), checked against the link, not a membership',
  },
  'documents#issueEvidenceSubmissionReadRef': {
    kind: 'internal',
    reason:
      'mints the link to a sent evidence copy for a caller that already checked the agency proof and the identity confirmation',
  },
  'document-access-token#signDocumentAccessToken': {
    kind: 'pure',
    reason: 'signs a document access token from fields the caller already authorized',
  },
  'document-access-token#verifyDocumentAccessToken': {
    kind: 'pure',
    reason: "checks a token's signature and expiry; the file route then checks the person",
  },
  'document-access-token#appendDocumentAccessToken': {
    kind: 'pure',
    reason: "adds a token's fields to an address",
  },

  // --- AI settings and entitlements ------------------------------------------------------------
  'ai-feature-settings#aiOrganizationContext': {
    kind: 'internal',
    reason:
      'builds the context of an agency a service has already shown the caller acts for (a live owner or admin membership)',
  },
  'ai-feature-settings#aiEntitlementFor': {
    kind: 'caller-checked',
    reason:
      "what a plan allows for an AI feature, for a subject the caller already resolved; returns limits, never anyone's record",
  },
  'ai-feature-settings#getAiUsageToday': {
    kind: 'caller-checked',
    reason:
      "today's AI use counts for the signed-in account itself (lib/ai-usage.ts passes only that account); counts only",
  },
  'access/agency-ai-scope#agencyAiSettingOn': {
    kind: 'internal',
    reason:
      "whether an agency's own AI setting is on, read inside openAgencyAiScope after its membership check",
  },
  'access/agency-ai-connections#endAgencyAiConnectionsOfMember': {
    kind: 'internal',
    reason:
      "ends a member's AI connections when an admin turns that member off, inside setMembershipActive's checked transaction",
  },
  'entitlements#resolveEntitlements': {
    kind: 'caller-checked',
    reason:
      "what a subject's plan allows now, for callers that checked who the subject is; returns limits and switches, never a record",
  },
  'pack-matching#listFittingAgencyPacks': {
    kind: 'caller-checked',
    reason:
      "the agency's published lists that fit a case's country and purpose; its caller (umpe-pack-selection) passes the case's own agency after the access gate on that case; list names, no client data",
  },
};
