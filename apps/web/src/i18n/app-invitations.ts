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
