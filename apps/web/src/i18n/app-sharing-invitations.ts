import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-sharing-invitations surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appSharingInvitationsCatalog = defineCatalog({
  en: {
    'appSharingInvitations.appSharingInvitationsAcceptAcceptForm.iHaveReviewedThePurposePermissions':
      'I have reviewed the purpose, permissions, document scope and expiry and agree to this access.',
    'appSharingInvitations.appSharingInvitationsAcceptPage.accessEnds': 'Access Ends',
    'appSharingInvitations.appSharingInvitationsAcceptPage.allDocumentsInThisProfile':
      'All documents in this profile',
    'appSharingInvitations.appSharingInvitationsAcceptPage.allProfileCategories':
      'All profile categories',
    'appSharingInvitations.appSharingInvitationsAcceptPage.askTheSenderForANew':
      'Ask the sender for a new link or sign in with the invited email address.',
    'appSharingInvitations.appSharingInvitationsAcceptPage.documents': 'Documents',
    'appSharingInvitations.appSharingInvitationsAcceptPage.invitationExpires': 'Invitation Expires',
    'appSharingInvitations.appSharingInvitationsAcceptPage.invitationUnavailable':
      'Invitation Unavailable',
    'appSharingInvitations.appSharingInvitationsAcceptPage.leaveWithoutAccepting':
      'Leave Without Accepting',
    'appSharingInvitations.appSharingInvitationsAcceptPage.openingThisInvitationGrantsNoAccess':
      'Opening this invitation grants no access. Review everything before accepting.',
    'appSharingInvitations.appSharingInvitationsAcceptPage.permissions': 'Permissions',
    'appSharingInvitations.appSharingInvitationsAcceptPage.pluralCapturedWhenInvited':
      '{plural} captured when invited',
    'appSharingInvitations.appSharingInvitationsAcceptPage.profileCategories': 'Profile Categories',
    'appSharingInvitations.appSharingInvitationsAcceptPage.purpose': 'Purpose',
    'appSharingInvitations.appSharingInvitationsAcceptPage.returnToYourWorkspace':
      'Return to Your Workspace',
    'appSharingInvitations.appSharingInvitationsAcceptPage.reviewSharedAccess':
      'Review Shared Access',
    'appSharingInvitations.appSharingInvitationsAcceptPage.sharedBy': 'Shared By',
    'appSharingInvitations.appSharingInvitationsAcceptPage.signInWithTheInvitedEmail':
      'Sign In with the Invited Email',
  },
  bn: {
    'appSharingInvitations.appSharingInvitationsAcceptPage.accessEnds': 'অ্যাক্সেস শেষ হবে',
    'appSharingInvitations.appSharingInvitationsAcceptPage.askTheSenderForANew':
      'প্রেরকের কাছে নতুন একটি লিংক চান, অথবা আমন্ত্রণ পাওয়া ইমেইল ঠিকানা দিয়ে সাইন ইন করুন।',
    'appSharingInvitations.appSharingInvitationsAcceptPage.invitationExpires':
      'আমন্ত্রণের মেয়াদ শেষ হবে',
    'appSharingInvitations.appSharingInvitationsAcceptPage.invitationUnavailable':
      'আমন্ত্রণ পাওয়া যাচ্ছে না',
    'appSharingInvitations.appSharingInvitationsAcceptPage.openingThisInvitationGrantsNoAccess':
      'এই আমন্ত্রণ খুললে কোনো অ্যাক্সেস দেওয়া হয় না। গ্রহণ করার আগে সবকিছু পর্যালোচনা করুন।',
    'appSharingInvitations.appSharingInvitationsAcceptPage.permissions': 'অনুমতি',
  },
});
