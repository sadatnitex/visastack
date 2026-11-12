import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-sharing surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantSharingCatalog = defineCatalog({
  en: {
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.keepItOn': 'Keep It On',
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOff': 'Turn Off',
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOffAppname':
      'Turn Off {appName}',
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOffAppnameFromItsNext':
      'Turn off {appName}? From its next request it can no longer read this record. To use it again, connect it again from the app.',
    'applicantSharing.appApplicantIdSharingAiConnections.accessChangedTheAppGetsThe':
      'Access changed. The app gets the new access on its next request.',
    'applicantSharing.appApplicantIdSharingAiConnections.aiApps': 'AI Apps',
    'applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis':
      'AI apps you connected to this record. Each one can read only what you chose. An app you let suggest changes can leave suggestions, drafts and reminders for you, and nothing changes until you approve it. Turning one off stops it straight away.',
    'applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis12cecd':
      'AI apps you connected to this record. Each one can read only what you chose and cannot change anything in VisaStack. Turning one off stops it straight away.',
    'applicantSharing.appApplicantIdSharingAiConnections.aiConnections': 'AI Connections',
    'applicantSharing.appApplicantIdSharingAiConnections.aiConnectionsCannotBeShownRight':
      'AI connections cannot be shown right now. Try again later.',
    'applicantSharing.appApplicantIdSharingAiConnections.aifileslineButTurnedOffRightNow':
      '{aiFilesLine}, but turned off right now',
    'applicantSharing.appApplicantIdSharingAiConnections.canRead': 'Can Read',
    'applicantSharing.appApplicantIdSharingAiConnections.cases': 'Cases',
    'applicantSharing.appApplicantIdSharingAiConnections.changeAccess': 'Change Access',
    'applicantSharing.appApplicantIdSharingAiConnections.changeAccessForClientname':
      'Change Access for {clientName}',
    'applicantSharing.appApplicantIdSharingAiConnections.connected': 'Connected',
    'applicantSharing.appApplicantIdSharingAiConnections.ends': 'Ends',
    'applicantSharing.appApplicantIdSharingAiConnections.lastUsed': 'Last Used',
    'applicantSharing.appApplicantIdSharingAiConnections.no': 'No',
    'applicantSharing.appApplicantIdSharingAiConnections.noAiAppsAreConnectedTo':
      'No AI apps are connected to this record. When you connect one from your AI app, it appears here with what it can read.',
    'applicantSharing.appApplicantIdSharingAiConnections.notUsedYet': 'Not Used Yet',
    'applicantSharing.appApplicantIdSharingAiConnections.nothingFromThisRecord':
      'Nothing from this record',
    'applicantSharing.appApplicantIdSharingAiConnections.recentlyTurnedOffLength':
      'Recently Turned Off ({length})',
    'applicantSharing.appApplicantIdSharingAiConnections.turnedOffThatAppCanNo':
      'Turned off. That app can no longer read this record.',
    'applicantSharing.appApplicantIdSharingAiConnections.untilYouTurnItOff':
      'Until You Turn It Off',
    'applicantSharing.appApplicantIdSharingAiConnections.yes': 'Yes',
    'applicantSharing.appApplicantIdSharingAiConnections.yesButTurnedOffRightNow':
      'Yes, but turned off right now',
    'applicantSharing.appApplicantIdSharingAiDrafts.andPluralNotShownHereDelete':
      'And {plural}, not shown here. Delete ones you no longer need to see the rest.',
    'applicantSharing.appApplicantIdSharingAiDrafts.copyDraft': 'Copy Draft',
    'applicantSharing.appApplicantIdSharingAiDrafts.copyDraftTitle': 'Copy Draft: {title}',
    'applicantSharing.appApplicantIdSharingAiDrafts.deleteDraftTitle': 'Delete Draft: {title}',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftTextTitle': 'Draft text: {title}',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftsFromAiApps': 'Drafts from AI Apps',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftsYourAiAppsSavedFor':
      'Drafts your AI apps saved for you, such as letters and notes. They are kept here for you only: nothing is sent anywhere, and agencies never see them. Drafts stay until you delete them.',
    'applicantSharing.appApplicantIdSharingAiDrafts.noDraftsFromAiApps': 'No drafts from AI apps.',
    'applicantSharing.appApplicantIdSharingAiDrafts.showDraft': 'Show Draft',
    'applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCase': 'Allow This Case',
    'applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCaseTitle':
      'Allow This Case: {title}',
    'applicantSharing.appApplicantIdSharingCaseExceptions.keepItPrivate': 'Keep It Private',
    'applicantSharing.appApplicantIdSharingCaseExceptions.notShared': 'Not Shared',
    'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelSeesThisCaseThroughAnother':
      '{recipientLabel} sees this case through another access you gave.',
    'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelWillBeAbleToSee':
      '{recipientLabel} will be able to see this case and its records.',
    'applicantSharing.appApplicantIdSharingCaseExceptions.sharedSeparately': 'Shared Separately',
    'applicantSharing.appApplicantIdSharingCaseExceptions.thisAccessCoversEveryCaseExcept':
      'This access covers every case except the ones below. Documents and profile details you shared stay shared.',
    'applicantSharing.appApplicantIdSharingGrantAiChoice.aiTools': 'AI Tools',
    'applicantSharing.appApplicantIdSharingGrantAiChoice.saveAiToolsChoiceForAgencyname':
      'Save AI Tools Choice for {agencyName}',
    'applicantSharing.appApplicantIdSharingGrantForm.30DefaultUpTo90': '30 (default), up to 90',
    'applicantSharing.appApplicantIdSharingGrantForm.commonReasons': 'Common Reasons',
    'applicantSharing.appApplicantIdSharingGrantForm.confirmThisAccess': 'Confirm This Access',
    'applicantSharing.appApplicantIdSharingGrantForm.downloadsAreNotIncludedYouCan':
      'Downloads are not included. You can pause or revoke future access at any time; copies already downloaded cannot be recalled.',
    'applicantSharing.appApplicantIdSharingGrantForm.eGReviewMyUkStudent':
      'e.g. Review my UK student visa documents',
    'applicantSharing.appApplicantIdSharingGrantForm.everyDocument': 'Every document',
    'applicantSharing.appApplicantIdSharingGrantForm.everyGrantExpiresLeaveBlankFor':
      'Every grant expires. Leave blank for the 30-day default; the maximum is 90 days.',
    'applicantSharing.appApplicantIdSharingGrantForm.everythingInMyProfile':
      'Everything in my profile',
    'applicantSharing.appApplicantIdSharingGrantForm.expiresAfterDays': 'Expires After (Days)',
    'applicantSharing.appApplicantIdSharingGrantForm.invitationCreated': 'Invitation Created',
    'applicantSharing.appApplicantIdSharingGrantForm.onlyTheDocumentsIChoose':
      'Only the documents I choose',
    'applicantSharing.appApplicantIdSharingGrantForm.onlyThePartsIChoose':
      'Only the parts I choose',
    'applicantSharing.appApplicantIdSharingGrantForm.permissions': 'Permissions',
    'applicantSharing.appApplicantIdSharingGrantForm.pressReviewAndConfirmFirst':
      'Press Review and Confirm first.',
    'applicantSharing.appApplicantIdSharingGrantForm.purpose': 'Purpose',
    'applicantSharing.appApplicantIdSharingGrantForm.recipientEmail': 'Recipient Email',
    'applicantSharing.appApplicantIdSharingGrantForm.reviewAndConfirm': 'Review and Confirm',
    'applicantSharing.appApplicantIdSharingGrantForm.revokingEndsAccessOnVisastackIt':
      'Revoking ends access on VisaStack. It cannot take back copies someone already downloaded.',
    'applicantSharing.appApplicantIdSharingGrantForm.safeCopiesMayBeDownloadedOriginal':
      'Safe copies may be downloaded; original downloads are not included.',
    'applicantSharing.appApplicantIdSharingGrantForm.sharingRequestCreated':
      'Sharing Request Created',
    'applicantSharing.appApplicantIdSharingGrantForm.themExampleCom': 'them@example.com',
    'applicantSharing.appApplicantIdSharingGrantForm.whatShouldTheySeeFromYour':
      'What should they see from your profile?',
    'applicantSharing.appApplicantIdSharingGrantForm.whichDocumentsCanTheyOpen':
      'Which documents can they open?',
    'applicantSharing.appApplicantIdSharingGrantForm.yourAccessSummary': 'Your Access Summary',
    'applicantSharing.appApplicantIdSharingGrantOpButtons.keepAccess': 'Keep Access',
    'applicantSharing.appApplicantIdSharingGrantPane.acceptedFormattimestampdate':
      'Accepted {formatTimestampDate}',
    'applicantSharing.appApplicantIdSharingGrantPane.organization': ' (organization)',
    'applicantSharing.appApplicantIdSharingScopeExpansionForm.lengthNewDocumentsNowMatchThis':
      '{length, plural, =1 {{length} new document now match this grant category. They stay hidden from the recipient until you confirm including them.} other {{length} new documents now match this grant categories. They stay hidden from the recipient until you confirm including them.}}',
  },
  bn: {
    'applicantSharing.appApplicantIdSharingGrantForm.eGReviewMyUkStudent':
      'যেমন: আমার যুক্তরাজ্যের স্টুডেন্ট ভিসার ডকুমেন্ট পর্যালোচনা করুন',
    'applicantSharing.appApplicantIdSharingGrantForm.recipientEmail': 'প্রাপকের ইমেইল',
    'applicantSharing.appApplicantIdSharingGrantForm.themExampleCom': 'them@example.com',
  },
});
