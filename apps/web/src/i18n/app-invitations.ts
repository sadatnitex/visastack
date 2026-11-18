import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-invitations surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appInvitationsCatalog = defineCatalog({
  en: {
    'appInvitations.appInvitationsAcceptPage.invitation': 'Invitation',
    'appInvitations.appInvitationsAcceptPage.joinAnOrganization': 'Join an Organization',
    'appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsMissingIts':
      'This invitation link is missing its token.',
    'appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsNotValid':
      'This invitation link is not valid.',
    // DECL1: saying no on the accept screen (Bengali through the register only).
    'appInvitations.appInvitationsDecl1.decline': 'Decline',
    'appInvitations.appInvitationsDecl1.explain':
      'Say no to joining? You will not become a member, and this link stops working.',
    'appInvitations.appInvitationsDecl1.confirm': 'Decline Invitation',
    'appInvitations.appInvitationsDecl1.busy': 'Declining…',
    'appInvitations.appInvitationsDecl1.declinedTitle': 'Invitation Declined',
    'appInvitations.appInvitationsDecl1.declinedBody':
      'You said no. No access was given, and the link no longer works.',
    'appInvitations.appInvitationsDecl1.returnToYourWorkspace': 'Return to Your Workspace',
    // end DECL1
  },
  bn: {
    'appInvitations.appInvitationsAcceptPage.invitation': 'আমন্ত্রণ',
    'appInvitations.appInvitationsAcceptPage.joinAnOrganization': 'একটি প্রতিষ্ঠানে যোগ দিন',
    'appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsMissingIts':
      'এই আমন্ত্রণ লিংকে টোকেন নেই।',
    'appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsNotValid':
      'এই আমন্ত্রণ লিংকটি বৈধ নয়।',
  },
});
