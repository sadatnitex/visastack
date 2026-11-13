import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-client-invitations surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appClientInvitationsCatalog = defineCatalog({
  en: {
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.agencyaitravellernoteIfYourSignInIs':
      '{agencyAiTravellerNote} If your sign-in is not recent, you will confirm it is you, then tick this again on Sharing.',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.aiTools': 'AI Tools',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.createANewProfile':
      'Create a New Profile',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.leaveBlankToUseTheName':
      'Leave blank to use the name the agency gave',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.profileNameOptional':
      'Profile Name (Optional)',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.whichProfile': 'Which profile?',
    'appClientInvitations.appClientInvitationsAcceptConsentGate.on': 'On',
    'appClientInvitations.appClientInvitationsAcceptConsentGate.turnOnLabel': 'Turn On: {label}',
    'appClientInvitations.appClientInvitationsAcceptPage.ifYouAcceptTheyWillBe':
      'If you accept, they will be able to:',
    'appClientInvitations.appClientInvitationsAcceptPage.invitation': 'Invitation',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationCannotBeShownRight':
      'This invitation cannot be shown right now. Ask the agency to send it again.',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsMissingIts':
      'This invitation link is missing its token.',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsNotValid':
      'This invitation link is not valid.',
    'appClientInvitations.appClientInvitationsAcceptPage.turnTheseOnBeforeAcceptingBoth':
      'Turn these on before accepting (both are required):',
    'appClientInvitations.appClientInvitationsAcceptPage.workWithAnAgency': 'Work with an Agency',
  },
  bn: {
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.aiTools': 'এআই টুল',
    'appClientInvitations.appClientInvitationsAcceptAcceptForm.profileNameOptional':
      'প্রোফাইলের নাম (ঐচ্ছিক)',
    'appClientInvitations.appClientInvitationsAcceptPage.ifYouAcceptTheyWillBe':
      'আপনি গ্রহণ করলে তাঁরা যা করতে পারবেন:',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationCannotBeShownRight':
      'এই আমন্ত্রণ এখন দেখানো যাচ্ছে না। এজেন্সিকে আবার পাঠাতে বলুন।',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsMissingIts':
      'এই আমন্ত্রণ লিংকে টোকেন নেই।',
    'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsNotValid':
      'এই আমন্ত্রণ লিংকটি বৈধ নয়।',
    'appClientInvitations.appClientInvitationsAcceptPage.turnTheseOnBeforeAcceptingBoth':
      'গ্রহণ করার আগে এগুলো চালু করুন (দুটিই আবশ্যক):',
  },
});
