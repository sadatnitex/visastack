import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the invitation surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const invitationCatalog = defineCatalog({
  en: {
    'invitation.invitationClientInvitationOffer.aCompleteChecklistOrAFile':
      'A complete checklist, or a file marked ready, is not an approval. Only the embassy or visa office decides.',
    'invitation.invitationClientInvitationOffer.agencynameInvitedYou': '{agencyName} Invited You',
    'invitation.invitationClientInvitationOffer.agencynameWantsToWorkOnYour':
      '{agencyName} wants to work on your visa case with you.',
    'invitation.invitationClientInvitationOffer.anAdministratorAtAgencynameInvitedYou':
      'An administrator at {agencyName} invited you to share part of your VisaStack record with them. If you accept:',
    'invitation.invitationClientInvitationOffer.beforeYouStart': 'Before You Start',
    'invitation.invitationClientInvitationOffer.createAnAccountOrSignIn':
      'Create an account or sign in with the email address that received this invitation.',
    'invitation.invitationClientInvitationOffer.createAnAccountToReview':
      'Create an Account to Review',
    'invitation.invitationClientInvitationOffer.done': '(Done)',
    'invitation.invitationClientInvitationOffer.eachOfTheseWouldNeedA':
      'Each of these would need a separate choice from you.',
    'invitation.invitationClientInvitationOffer.ifYouResetYourPasswordOpen':
      'If you reset your password, open this invitation link again afterwards.',
    'invitation.invitationClientInvitationOffer.invitedYouToWorkTogetherOn':
      'invited you to work together on VisaStack. VisaStack has not finished reviewing them, so you cannot accept yet.',
    'invitation.invitationClientInvitationOffer.nothingIsSharedUntilYouAccept':
      'Nothing is shared until you accept.',
    'invitation.invitationClientInvitationOffer.openingThisLinkAcceptsNothingYou':
      'Opening this link accepts nothing. You decide after you review.',
    'invitation.invitationClientInvitationOffer.reviewYourInvitation': 'Review Your Invitation',
    'invitation.invitationClientInvitationOffer.signIn': 'Sign In',
    'invitation.invitationClientInvitationOffer.theyCould': 'They Could',
    'invitation.invitationClientInvitationOffer.theyCouldNot': 'They Could Not',
    'invitation.invitationClientInvitationOffer.thisAgencyIsStillBeingReviewed':
      'This Agency Is Still Being Reviewed',
    'invitation.invitationClientInvitationOffer.thisInvitationIsNoLongerOpen':
      'This Invitation Is No Longer Open',
    'invitation.invitationClientInvitationOffer.useTheEmailAddressThatReceived':
      'Use the email address that received this invitation.',
    'invitation.invitationClientInvitationOffer.visastackInvitation': 'VisaStack Invitation',
    'invitation.invitationClientInvitationOffer.whatHappensNext': 'What Happens Next',
    'invitation.invitationClientInvitationOffer.youCanStopSharingAtAny':
      'You can stop sharing at any time.',
    'invitation.invitationClientInvitationOffer.youChooseWhichOfYourProfiles':
      'You choose which of your profiles this applies to, or start a new one.',
    'invitation.invitationClientInvitationOffer.youStayInControl': 'You Stay in Control',
    'invitation.invitationLink.copyLink': 'Copy Link',
    'invitation.invitationLink.privateInvitationLink': 'Private Invitation Link',
    'invitation.invitationLink.shareOnlyWithYourInviteeRevoking':
      'Share only with your invitee. Revoking the invitation stops this link from working.',
    'invitation.invitationPage.goToTheHomePage': 'Go to the Home Page',
    'invitation.invitationPage.incompleteInvitationLink': 'Incomplete Invitation Link',
    'invitation.invitationPage.invitationsExpireAfter7DaysIf':
      'Invitations expire after 7 days. If this one has expired or was revoked, ask the sender for a new invitation.',
    'invitation.invitationPage.whatToExpect': 'What to Expect',
    'invitation.invitationSwitchAccount.notYou': 'Not you?',
    'invitation.invitingAgency.poweredByVisastack': 'Powered by VisaStack',
  },
  bn: {
    'invitation.invitationClientInvitationOffer.ifYouResetYourPasswordOpen':
      'আপনি পাসওয়ার্ড রিসেট করলে, এরপর এই আমন্ত্রণের লিংকটি আবার খুলুন।',
    'invitation.invitationClientInvitationOffer.reviewYourInvitation': 'আপনার আমন্ত্রণ পর্যালোচনা করুন',
    'invitation.invitationClientInvitationOffer.thisAgencyIsStillBeingReviewed':
      'এই এজেন্সির পর্যালোচনা এখনো চলছে',
    'invitation.invitationClientInvitationOffer.thisInvitationIsNoLongerOpen':
      'এই আমন্ত্রণ আর খোলা নেই',
    'invitation.invitationClientInvitationOffer.visastackInvitation': 'VisaStack আমন্ত্রণ',
    'invitation.invitationClientInvitationOffer.whatHappensNext': 'এরপর কী হবে',
    'invitation.invitationLink.copyLink': 'লিংক কপি করুন',
    'invitation.invitationLink.privateInvitationLink': 'ব্যক্তিগত আমন্ত্রণ লিংক',
    'invitation.invitationLink.shareOnlyWithYourInviteeRevoking':
      'শুধু আপনার আমন্ত্রিত ব্যক্তির সঙ্গে শেয়ার করুন। আমন্ত্রণ প্রত্যাহার করলে এই লিংক আর কাজ করে না।',
    'invitation.invitationPage.incompleteInvitationLink': 'অসম্পূর্ণ আমন্ত্রণ লিংক',
    'invitation.invitingAgency.poweredByVisastack': 'VisaStack দ্বারা চালিত',
  },
});
