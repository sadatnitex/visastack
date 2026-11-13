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
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOff': 'বন্ধ করুন',
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOffAppname': '{appName} বন্ধ করুন',
    'applicantSharing.appApplicantIdSharingAiConnections.accessChangedTheAppGetsThe':
      'অ্যাক্সেস বদলানো হয়েছে। অ্যাপটি পরের অনুরোধে নতুন অ্যাক্সেস পাবে।',
    'applicantSharing.appApplicantIdSharingAiConnections.aiApps': 'এআই অ্যাপ',
    'applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis':
      'এই রেকর্ডের সঙ্গে আপনার সংযুক্ত করা এআই অ্যাপ। প্রতিটি অ্যাপ শুধু আপনার বেছে নেওয়া অংশ পড়তে পারে। যে অ্যাপকে আপনি পরিবর্তনের পরামর্শ দিতে দিয়েছেন, সেটি আপনার জন্য পরামর্শ, খসড়া ও রিমাইন্ডার রেখে যেতে পারে, আর আপনি অনুমোদন না করা পর্যন্ত কিছুই বদলায় না। কোনো অ্যাপ বন্ধ করলে সেটি সঙ্গে সঙ্গে থেমে যায়।',
    'applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis12cecd':
      'এই রেকর্ডের সঙ্গে আপনার যুক্ত করা এআই অ্যাপ। প্রতিটি শুধু আপনার বেছে নেওয়া অংশ পড়তে পারে এবং VisaStack-এ কিছুই বদলাতে পারে না। কোনোটি বন্ধ করলে সেটি সঙ্গে সঙ্গে থেমে যায়।',
    'applicantSharing.appApplicantIdSharingAiConnections.aiConnections': 'এআই সংযোগ',
    'applicantSharing.appApplicantIdSharingAiConnections.aiConnectionsCannotBeShownRight':
      'এআই সংযোগ এখন দেখানো যাচ্ছে না। পরে আবার চেষ্টা করুন।',
    'applicantSharing.appApplicantIdSharingAiConnections.canRead': 'পড়তে পারেন',
    'applicantSharing.appApplicantIdSharingAiConnections.cases': 'ভিসা ফাইল',
    'applicantSharing.appApplicantIdSharingAiConnections.changeAccess': 'অ্যাক্সেস বদলান',
    'applicantSharing.appApplicantIdSharingAiConnections.changeAccessForClientname':
      '{clientName}-এর অ্যাক্সেস বদলান',
    'applicantSharing.appApplicantIdSharingAiConnections.connected': 'সংযুক্ত',
    'applicantSharing.appApplicantIdSharingAiConnections.ends': 'শেষের তারিখ',
    'applicantSharing.appApplicantIdSharingAiConnections.lastUsed': 'সর্বশেষ ব্যবহার',
    'applicantSharing.appApplicantIdSharingAiConnections.noAiAppsAreConnectedTo':
      'এই রেকর্ডের সঙ্গে কোনো এআই অ্যাপ সংযুক্ত নেই। আপনার এআই অ্যাপ থেকে একটি সংযুক্ত করলে, সেটি কী পড়তে পারে তা সহ এখানে দেখা যাবে।',
    'applicantSharing.appApplicantIdSharingAiConnections.notUsedYet': 'এখনো ব্যবহার করা হয়নি',
    'applicantSharing.appApplicantIdSharingAiConnections.nothingFromThisRecord':
      'এই রেকর্ডের কিছুই নয়',
    'applicantSharing.appApplicantIdSharingAiConnections.recentlyTurnedOffLength':
      'সম্প্রতি বন্ধ করা হয়েছে ({length})',
    'applicantSharing.appApplicantIdSharingAiConnections.turnedOffThatAppCanNo':
      'বন্ধ করা হয়েছে। ওই অ্যাপ এই রেকর্ড আর পড়তে পারবে না।',
    'applicantSharing.appApplicantIdSharingAiConnections.untilYouTurnItOff': 'আপনি বন্ধ না করা পর্যন্ত',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftTextTitle': 'খসড়া লেখা: {title}',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftsFromAiApps': 'এআই অ্যাপের খসড়া',
    'applicantSharing.appApplicantIdSharingAiDrafts.draftsYourAiAppsSavedFor':
      'আপনার এআই অ্যাপ আপনার জন্য যে খসড়া সংরক্ষণ করেছে, যেমন চিঠি ও নোট। এগুলো এখানে শুধু আপনার জন্যই রাখা হয়: কোথাও কিছু পাঠানো হয় না, আর এজেন্সিগুলো এগুলো কখনো দেখে না। আপনি মুছে না ফেলা পর্যন্ত খসড়া থাকে।',
    'applicantSharing.appApplicantIdSharingAiDrafts.noDraftsFromAiApps':
      'এআই অ্যাপ থেকে কোনো খসড়া নেই।',
    'applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCase': 'এই ভিসা ফাইলের অনুমতি দিন',
    'applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCaseTitle':
      'এই ভিসা ফাইলের অনুমতি দিন: {title}',
    'applicantSharing.appApplicantIdSharingCaseExceptions.notShared': 'শেয়ার করা হয়নি',
    'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelSeesThisCaseThroughAnother':
      '{recipientLabel} আপনার দেওয়া অন্য একটি অ্যাক্সেসের মাধ্যমে এই ভিসা ফাইল দেখেন।',
    'applicantSharing.appApplicantIdSharingCaseExceptions.sharedSeparately': 'আলাদাভাবে শেয়ার করা',
    'applicantSharing.appApplicantIdSharingCaseExceptions.thisAccessCoversEveryCaseExcept':
      'নিচেরগুলো ছাড়া সব ভিসা ফাইল এই অ্যাক্সেসের আওতায়। আপনার শেয়ার করা ডকুমেন্ট ও প্রোফাইলের তথ্য শেয়ার করাই থাকে।',
    'applicantSharing.appApplicantIdSharingGrantAiChoice.aiTools': 'এআই টুল',
    'applicantSharing.appApplicantIdSharingGrantForm.30DefaultUpTo90': '৩০ (ডিফল্ট), সর্বোচ্চ ৯০',
    'applicantSharing.appApplicantIdSharingGrantForm.commonReasons': 'সাধারণ কারণ',
    'applicantSharing.appApplicantIdSharingGrantForm.confirmThisAccess': 'এই অ্যাক্সেস নিশ্চিত করুন',
    'applicantSharing.appApplicantIdSharingGrantForm.downloadsAreNotIncludedYouCan':
      'ডাউনলোড এতে অন্তর্ভুক্ত নয়। আপনি যেকোনো সময় ভবিষ্যতের অ্যাক্সেস স্থগিত বা প্রত্যাহার করতে পারেন; আগে ডাউনলোড হয়ে যাওয়া কপি ফিরিয়ে নেওয়া যায় না।',
    'applicantSharing.appApplicantIdSharingGrantForm.eGReviewMyUkStudent':
      'যেমন: আমার যুক্তরাজ্যের স্টুডেন্ট ভিসার ডকুমেন্ট পর্যালোচনা করুন',
    'applicantSharing.appApplicantIdSharingGrantForm.everyDocument': 'প্রতিটি ডকুমেন্ট',
    'applicantSharing.appApplicantIdSharingGrantForm.everyGrantExpiresLeaveBlankFor':
      'প্রতিটি অ্যাক্সেসের মেয়াদ শেষ হয়। ৩০ দিনের ডিফল্টের জন্য ঘরটি ফাঁকা রাখুন; সর্বোচ্চ ৯০ দিন।',
    'applicantSharing.appApplicantIdSharingGrantForm.everythingInMyProfile': 'আমার প্রোফাইলের সবকিছু',
    'applicantSharing.appApplicantIdSharingGrantForm.expiresAfterDays': 'মেয়াদ শেষ হবে (কত দিন পরে)',
    'applicantSharing.appApplicantIdSharingGrantForm.invitationCreated': 'আমন্ত্রণ তৈরি হয়েছে',
    'applicantSharing.appApplicantIdSharingGrantForm.onlyTheDocumentsIChoose':
      'শুধু আমার বেছে নেওয়া ডকুমেন্ট',
    'applicantSharing.appApplicantIdSharingGrantForm.onlyThePartsIChoose': 'শুধু আমার বেছে নেওয়া অংশ',
    'applicantSharing.appApplicantIdSharingGrantForm.permissions': 'অনুমতি',
    'applicantSharing.appApplicantIdSharingGrantForm.pressReviewAndConfirmFirst':
      'আগে পর্যালোচনা ও নিশ্চিত করুন বোতামটি চাপুন।',
    'applicantSharing.appApplicantIdSharingGrantForm.purpose': 'উদ্দেশ্য',
    'applicantSharing.appApplicantIdSharingGrantForm.recipientEmail': 'প্রাপকের ইমেইল',
    'applicantSharing.appApplicantIdSharingGrantForm.reviewAndConfirm': 'পর্যালোচনা ও নিশ্চিত করুন',
    'applicantSharing.appApplicantIdSharingGrantForm.revokingEndsAccessOnVisastackIt':
      'প্রত্যাহার করলে VisaStack-এ অ্যাক্সেস শেষ হয়ে যায়। কেউ আগে যে কপি ডাউনলোড করেছেন তা ফিরিয়ে নেওয়া যায় না।',
    'applicantSharing.appApplicantIdSharingGrantForm.safeCopiesMayBeDownloadedOriginal':
      'নিরাপদ কপি ডাউনলোড করা যেতে পারে; মূল ডকুমেন্ট ডাউনলোড এর অন্তর্ভুক্ত নয়।',
    'applicantSharing.appApplicantIdSharingGrantForm.sharingRequestCreated':
      'শেয়ারিংয়ের অনুরোধ তৈরি হয়েছে',
    'applicantSharing.appApplicantIdSharingGrantForm.themExampleCom': 'them@example.com',
    'applicantSharing.appApplicantIdSharingGrantForm.whatShouldTheySeeFromYour':
      'আপনার প্রোফাইল থেকে তাঁরা কী দেখতে পাবেন?',
    'applicantSharing.appApplicantIdSharingGrantForm.whichDocumentsCanTheyOpen':
      'তাঁরা কোন কোন ডকুমেন্ট খুলতে পারেন?',
    'applicantSharing.appApplicantIdSharingGrantForm.yourAccessSummary': 'আপনার অ্যাক্সেসের সারসংক্ষেপ',
  },
});
