import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the components surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const componentsCatalog = defineCatalog({
  en: {
    'components.activityLog.anyResult': 'Any Result',
    'components.activityLog.anyone': 'Anyone',
    'components.activityLog.clearFilters': 'Clear Filters',
    'components.activityLog.everything': 'Everything',
    'components.activityLog.findAnActivity': 'Find an Activity',
    'components.activityLog.moreOfLabel': 'More of {label}',
    'components.activityLog.nothingMatchesTheseFilters': 'Nothing matches these filters.',
    'components.activityLog.result': 'Result',
    'components.activityLog.search': 'Search',
    'components.activityLog.searchThisLog': 'Search this log',
    'components.activityLog.showNewestEntries': 'Show Newest Entries',
    'components.activityLog.showOlderEntries': 'Show Older Entries',
    'components.activityLog.showingLengthOfTheLength2Which':
      'Showing {length} of the {length2} {which} entries{reach}.{total}',
    'components.activityLog.theLengthWhichEntriesReachTotal':
      '{length, plural, =1 {The {length} {which} entry{reach}.{total}} other {The {length} {which} entries{reach}.{total}}}',
    'components.activityLog.whatHappened': 'What Happened',
    'components.activityLog.when': 'When',
    'components.activityLog.who': 'Who',
    'components.aiAccessChoices.allCurrentCases': 'All Current Cases',
    'components.aiAccessChoices.cases': 'Cases',
    'components.aiAccessChoices.changes': 'Changes',
    'components.aiAccessChoices.documents': 'Documents',
    'components.aiAccessChoices.howLong': 'How Long',
    'components.aiAccessChoices.kindDatesAndStatusOnlyNo':
      'Kind, dates and status only. No file is shared.',
    'components.aiAccessChoices.noCases': 'No Cases',
    'components.aiAccessChoices.onlyTitle': 'Only {title}',
    'components.aiAccessChoices.sensitiveShowsWholePassportAndId':
      'Sensitive: shows whole passport and ID numbers instead of the last three characters. You confirm it is you before this is allowed.',
    'components.aiAccessChoices.sensitiveTheWordsReadFromDocuments':
      'Sensitive: the words read from documents in the parts you allow above. Protected document types are never included.',
    'components.aiAccessChoices.whatAppnameCanRead': 'What {appName} Can Read',
    'components.capturePreview.checkYourPhoto': 'Check Your Photo',
    'components.capturePreview.isTheWholeCardOrPage':
      'Is the whole card or page inside the outline, and is the writing easy to read? If not, retake it.',
    'components.capturePreview.previewOfWhatYouJustCaptured':
      'Preview of what you just captured, shown so you can check it before it is sent',
    'components.capturePreview.retake': 'Retake',
    'components.capturePreview.thisDeviceCannotShowThePhoto':
      'This device cannot show the photo here, so check it on your phone first. If it looks right, press Use This. If not, retake it.',
    'components.capturePreview.useThis': 'Use This',
    'components.capturePreview.weCheckTheFileAgainAfter':
      'We check the file again after you send it, so a photo that looks fine here can still be turned away.',
    'components.checklistCorrectionForm.checklistItem': 'Checklist Item',
    'components.checklistCorrectionForm.chooseOne': 'Choose One',
    'components.checklistCorrectionForm.doNotIncludeNamesPassportNumbers':
      'Do not include names, passport numbers or other personal details.',
    'components.checklistCorrectionForm.officialPageOptional': 'Official Page (Optional)',
    'components.checklistCorrectionForm.somethingMissingFromTheChecklist':
      'Something Missing from the Checklist',
    'components.checklistCorrectionForm.theGovernmentEmbassyOrOfficialApplication':
      'The government, embassy or official application page that shows it.',
    'components.checklistCorrectionForm.whatLooksWrongForitem': 'What Looks Wrong{forItem}',
    'components.checklistCorrectionForm.whatShouldItSayOptional': 'What Should It Say (Optional)',
    'components.countryBrowser.allCountries': 'All Countries',
    'components.countryBrowser.clearTheSearchOrChooseAnother':
      'Clear the search or choose another filter.',
    'components.countryBrowser.filterByEntryRule': 'Filter by entry rule',
    'components.countryBrowser.forExampleJapan': 'For example: Japan',
    'components.countryBrowser.needsChecking': 'Needs Checking',
    'components.countryBrowser.noCountriesMatch': 'No countries match.',
    'components.countryBrowser.noCountriesMatche4ae64': 'No Countries Match',
    'components.countryBrowser.searchCountries': 'Search Countries',
    'components.documentReviewPanel.chooseADocument': 'Choose a Document',
    'components.documentReviewPanel.contentsAppearOnlyAfterPermissionAnd':
      'Contents appear only after permission and safety checks.',
    'components.documentReviewPanel.documentDetails': 'Document details',
    'components.documentReviewPanel.findADocument': 'Find a Document',
    'components.documentReviewPanel.noDocumentsMatchTryAnotherName':
      'No documents match. Try another name or clear your search.',
    'components.documentReviewPanel.openSecurePreview': 'Open Secure Preview',
    'components.documentReviewPanel.privateDocument': 'Private document',
    'components.documentReviewPanel.reviewAndPreview': 'Review and Preview',
    'components.documentReviewPanel.thisDocumentIsNotAvailableTo':
      'This document is not available to preview. Review its status in the document list.',
    'components.documentReviewPanel.uploadADocumentToReviewIts':
      'Upload a document to review its details here.',
    'components.documentReviewPanel.yourDocument': 'Your Document',
    'components.documentWalletBrowser.aboutThisFile': 'About This File',
    'components.documentWalletBrowser.addEachPaperOnce': 'Add each paper once.',
    'components.documentWalletBrowser.allCategories': 'All Categories',
    'components.documentWalletBrowser.backToDocuments': 'Back to Documents',
    'components.documentWalletBrowser.category': 'Category',
    'components.documentWalletBrowser.clearTheSearchOrChooseAnother':
      'Clear the search or choose another category or status.',
    'components.documentWalletBrowser.documentMetadataList': 'Document metadata list',
    'components.documentWalletBrowser.documentPages': 'Document pages',
    'components.documentWalletBrowser.documentStateFilters': 'Document state filters',
    'components.documentWalletBrowser.fileFormatIsCheckedWhenThe':
      'File format is checked when the file is opened. A verified format is not recorded in this metadata view.',
    'components.documentWalletBrowser.next': 'Next',
    'components.documentWalletBrowser.noDocumentsMatch': 'No Documents Match',
    'components.documentWalletBrowser.noDocumentsYet': 'No Documents Yet',
    'components.documentWalletBrowser.notSetYet': 'Not Set Yet',
    'components.documentWalletBrowser.notsortedAgreeAKind':
      '{notSorted, plural, one {# Needs a Kind} other {# Need a Kind}}',
    'components.documentWalletBrowser.notsortedDocumentsHaveNoKindSet':
      '{notSorted, plural, =1 {{notSorted} document has no kind set yet, so it is in no category and left out when you share by category. Open a document and choose its kind.} other {{notSorted} documents have no kind set yet, so they are in no category and left out when you share by category. Open a document and choose its kind.}}',
    'components.documentWalletBrowser.openTheSecurePreviewBelowPermission':
      'Open the secure preview below. Permission and current safety are checked again before bytes are served.',
    'components.documentWalletBrowser.previewIsBlockedForThisFile':
      'Preview is blocked for this file.',
    'components.documentWalletBrowser.previewIsBlockedWhileThisFile':
      'Preview is blocked while this file is unsafe, still processing or otherwise unavailable.',
    'components.documentWalletBrowser.previous': 'Previous',
    'components.documentWalletBrowser.reviewSharingPermissions': 'Review Sharing Permissions',
    'components.documentWalletBrowser.selectAnAvailableRowToReview':
      'Select an available row to review its metadata and authorized actions.',
    'components.documentWalletBrowser.selectedDocument': 'Selected Document',
    'components.documentWalletBrowser.selectedDocumentDetails': 'Selected document details',
    'components.documentWalletBrowser.selectedDocumentIsUnavailable':
      'Selected Document Is Unavailable',
    'components.documentWalletBrowser.sharingRequiresConsentAnExactReviewed':
      'Sharing requires consent, an exact reviewed scope and recipient acceptance. AI suggestions never update your profile until you approve them.',
    'components.documentWalletBrowser.showAll': 'Show All',
    'components.documentWalletBrowser.showThem':
      '{notSorted, plural, =1 {Show It} other {Show Them}}',
    'components.documentWalletBrowser.viewSelectedDetails': 'View Selected Details →',
    'components.documentWalletBrowser.why': 'Why?',
    'components.documentWalletBrowser.yourSelectedDocumentIsOutsideThe':
      'Your selected document is outside the current list filter.',
    'components.loadingSlowNote.stillLoadingYouCanKeepThis':
      'Still loading. You can keep this page open.',
    'components.purposeChoice.morePurposes': 'More Purposes',
    'components.purposeChoice.showCommonPurposes': 'Show Common Purposes',
    'components.purposeSelect.chooseAPurpose': 'Choose a Purpose',
    'components.receiptCard.done': 'Done',
    'components.receiptCard.reference': 'Reference',
    'components.receiptCard.when': 'When',
    'components.referenceCode.copy': 'Copy',
    'components.referenceCode.copyReferenceCode': 'Copy Reference {code}',
    'components.safeCopyDownload.confirmItIsYou': 'Confirm It Is You',
    'components.siteNavigation.menu': 'Menu',
    'components.siteNavigation.site': 'Site',
    'components.timeZoneSelect.chooseATimeZone': 'Choose a Time Zone',
    'components.timeZoneSelect.common': 'Common',
    'components.timeZoneSelect.utc': 'UTC',
    'components.toast.dismiss': 'Dismiss',
    'components.versionNotice.aboutThisVersion': 'About this version',
    'components.versionNotice.hideThisNotice': 'Hide This Notice',
    'components.versionNotice.whatWorksToday': 'What Works Today',
    'components.visaPhotoSizes.backgroundBackgroundrule': 'Background: {backgroundRule}',
    'components.visaPhotoSizes.checkingYourPhoto': 'Checking your photo...',
    'components.visaPhotoSizes.chooseTheSizeYourApplicationAsks':
      'Choose the size your application asks for, then move and zoom until your head and shoulders sit in the middle. The photo itself is never edited.',
    'components.visaPhotoSizes.downloadThisSize': 'Download This Size',
    'components.visaPhotoSizes.makingYourPhoto': 'Making your photo...',
    'components.visaPhotoSizes.moveAndZoom': 'Move and Zoom',
    'components.visaPhotoSizes.moveDown': 'Move Down',
    'components.visaPhotoSizes.moveLeft': 'Move Left',
    'components.visaPhotoSizes.moveRight': 'Move Right',
    'components.visaPhotoSizes.moveUp': 'Move Up',
    'components.visaPhotoSizes.noProblemsFoundByTheseBasic':
      'No problems found by these basic checks.',
    'components.visaPhotoSizes.photoChecks': 'Photo Checks',
    'components.visaPhotoSizes.photoSize': 'Photo Size',
    'components.visaPhotoSizes.previewOfThePhotoCroppedTo':
      'Preview of the photo cropped to {sizeLabel}',
    'components.visaPhotoSizes.resetCrop': 'Reset Crop',
    'components.visaPhotoSizes.theseChecksAreAGuideOnly':
      'These checks are a guide only. They cannot tell you whether the photo will be accepted.',
    'components.visaPhotoSizes.visaPhotoSizes': 'Visa Photo Sizes',
    'components.visaPhotoSizes.zoomIn': 'Zoom In',
    'components.visaPhotoSizes.zoomOut': 'Zoom Out',
  },
  bn: {
    'components.activityLog.anyResult': 'যেকোনো ফলাফল',
    'components.activityLog.anyone': 'যে কেউ',
    'components.activityLog.clearFilters': 'ফিল্টার মুছে দিন',
    'components.activityLog.everything': 'সবকিছু',
    'components.activityLog.findAnActivity': 'কার্যকলাপ খুঁজুন',
    'components.activityLog.nothingMatchesTheseFilters': 'এই ফিল্টারগুলোর সঙ্গে কিছুই মেলেনি।',
    'components.activityLog.result': 'ফলাফল',
    'components.activityLog.search': 'খুঁজুন',
    'components.activityLog.searchThisLog': 'এই লগে খুঁজুন',
    'components.activityLog.showNewestEntries': 'সবচেয়ে নতুন এন্ট্রি দেখান',
    'components.activityLog.showOlderEntries': 'পুরোনো এন্ট্রি দেখান',
    'components.activityLog.whatHappened': 'কী ঘটেছে',
    'components.activityLog.when': 'কখন',
    'components.activityLog.who': 'কে',
    'components.capturePreview.checkYourPhoto': 'আপনার ছবি দেখে নিন',
    'components.capturePreview.previewOfWhatYouJustCaptured':
      'আপনি এইমাত্র যা তুলেছেন তার প্রিভিউ, পাঠানোর আগে দেখে নেওয়ার জন্য দেখানো হচ্ছে',
    'components.capturePreview.weCheckTheFileAgainAfter':
      'আপনি পাঠানোর পর আমরা ডকুমেন্টটি আবার পরীক্ষা করি, তাই এখানে ঠিক দেখালেও কোনো ছবি পরে ফিরিয়ে দেওয়া হতে পারে।',
    'components.checklistCorrectionForm.checklistItem': 'চেকলিস্টের আইটেম',
    'components.checklistCorrectionForm.chooseOne': 'একটি বেছে নিন',
    'components.checklistCorrectionForm.doNotIncludeNamesPassportNumbers':
      'নাম, পাসপোর্ট নম্বর বা অন্য কোনো ব্যক্তিগত তথ্য লিখবেন না।',
    'components.checklistCorrectionForm.whatShouldItSayOptional': 'এতে কী লেখা থাকবে (ঐচ্ছিক)',
    'components.countryBrowser.allCountries': 'সব দেশ',
    'components.countryBrowser.clearTheSearchOrChooseAnother': 'খোঁজা মুছে দিন বা অন্য ফিল্টার বেছে নিন।',
    'components.countryBrowser.filterByEntryRule': 'প্রবেশের নিয়ম অনুযায়ী ফিল্টার করুন',
    'components.countryBrowser.forExampleJapan': 'যেমন: জাপান',
    'components.countryBrowser.needsChecking': 'দেখে নেওয়া দরকার',
    'components.countryBrowser.noCountriesMatch': 'কোনো দেশ মেলেনি।',
    'components.countryBrowser.noCountriesMatche4ae64': 'কোনো দেশ মেলেনি',
    'components.documentReviewPanel.chooseADocument': 'একটি ডকুমেন্ট বেছে নিন',
    'components.documentReviewPanel.contentsAppearOnlyAfterPermissionAnd':
      'অনুমতি ও নিরাপত্তা পরীক্ষার পরেই কেবল বিষয়বস্তু দেখা যায়।',
    'components.documentReviewPanel.documentDetails': 'ডকুমেন্টের বিবরণ',
    'components.documentReviewPanel.findADocument': 'একটি ডকুমেন্ট খুঁজুন',
    'components.documentReviewPanel.noDocumentsMatchTryAnotherName':
      'কোনো ডকুমেন্ট মেলেনি। অন্য নাম দিয়ে চেষ্টা করুন বা খোঁজ মুছে দিন।',
    'components.documentReviewPanel.openSecurePreview': 'সুরক্ষিত প্রিভিউ খুলুন',
    'components.documentReviewPanel.privateDocument': 'ব্যক্তিগত ডকুমেন্ট',
    'components.documentReviewPanel.reviewAndPreview': 'পর্যালোচনা ও প্রিভিউ',
    'components.documentReviewPanel.thisDocumentIsNotAvailableTo':
      'এই ডকুমেন্টের প্রিভিউ দেখা যাচ্ছে না। ডকুমেন্টের তালিকায় এর অবস্থা দেখে নিন।',
    'components.documentReviewPanel.uploadADocumentToReviewIts':
      'এখানে বিবরণ পর্যালোচনা করতে একটি ডকুমেন্ট আপলোড করুন।',
    'components.documentReviewPanel.yourDocument': 'আপনার ডকুমেন্ট',
    'components.documentWalletBrowser.aboutThisFile': 'এই ডকুমেন্ট সম্পর্কে',
    'components.documentWalletBrowser.addEachPaperOnce': 'প্রতিটি কাগজ একবারই যোগ করুন।',
    'components.documentWalletBrowser.allCategories': 'সব ক্যাটাগরি',
    'components.documentWalletBrowser.backToDocuments': 'ডকুমেন্টে ফিরে যান',
    'components.documentWalletBrowser.category': 'ক্যাটাগরি',
    'components.documentWalletBrowser.clearTheSearchOrChooseAnother':
      'খোঁজা মুছে দিন বা অন্য কোনো বিভাগ বা অবস্থা বেছে নিন।',
    'components.documentWalletBrowser.documentMetadataList': 'ডকুমেন্টের মেটাডেটা তালিকা',
    'components.documentWalletBrowser.documentPages': 'ডকুমেন্টের পাতা',
    'components.documentWalletBrowser.documentStateFilters': 'ডকুমেন্টের অবস্থা অনুযায়ী ফিল্টার',
    'components.documentWalletBrowser.fileFormatIsCheckedWhenThe':
      'ডকুমেন্ট খোলার সময় এর ফরম্যাট পরীক্ষা করা হয়। যাচাই করা ফরম্যাটের তথ্য এই মেটাডেটা অংশে রেকর্ড করা হয় না।',
    'components.documentWalletBrowser.next': 'পরবর্তী',
    'components.documentWalletBrowser.noDocumentsMatch': 'কোনো ডকুমেন্ট মেলেনি',
    'components.documentWalletBrowser.noDocumentsYet': 'এখনও কোনো ডকুমেন্ট নেই',
    'components.documentWalletBrowser.notSetYet': 'এখনও ঠিক করা হয়নি',
    'components.documentWalletBrowser.openTheSecurePreviewBelowPermission':
      'নিচের নিরাপদ প্রিভিউ খুলুন। ডকুমেন্টের বিষয়বস্তু দেখানোর আগে অনুমতি এবং বর্তমান নিরাপত্তা আবার পরীক্ষা করা হয়।',
    'components.documentWalletBrowser.previewIsBlockedForThisFile':
      'এই ডকুমেন্টের প্রিভিউ ব্লক করা আছে।',
    'components.documentWalletBrowser.previewIsBlockedWhileThisFile':
      'এই ডকুমেন্টটি ঝুঁকিপূর্ণ হলে, এখনো প্রক্রিয়াধীন থাকলে বা অন্য কোনো কারণে পাওয়া না গেলে প্রিভিউ বন্ধ থাকে।',
    'components.documentWalletBrowser.previous': 'আগের',
    'components.documentWalletBrowser.reviewSharingPermissions': 'শেয়ারিংয়ের অনুমতি পর্যালোচনা করুন',
    'components.documentWalletBrowser.selectAnAvailableRowToReview':
      'এর মেটাডেটা ও অনুমতিপ্রাপ্ত কাজ দেখতে একটি উপলব্ধ সারি নির্বাচন করুন।',
    'components.documentWalletBrowser.selectedDocument': 'নির্বাচিত ডকুমেন্ট',
    'components.documentWalletBrowser.selectedDocumentDetails': 'নির্বাচিত ডকুমেন্টের বিস্তারিত',
    'components.documentWalletBrowser.selectedDocumentIsUnavailable':
      'বেছে নেওয়া ডকুমেন্টটি পাওয়া যাচ্ছে না',
    'components.documentWalletBrowser.sharingRequiresConsentAnExactReviewed':
      'শেয়ার করতে সম্মতি, পর্যালোচনা করা সুনির্দিষ্ট পরিসর এবং প্রাপকের গ্রহণ দরকার। আপনি অনুমোদন না করা পর্যন্ত এআই-এর পরামর্শ কখনো আপনার প্রোফাইল হালনাগাদ করে না।',
    'components.documentWalletBrowser.showAll': 'সব দেখান',
    'components.documentWalletBrowser.viewSelectedDetails': 'নির্বাচিত বিবরণ দেখুন →',
    'components.documentWalletBrowser.why': 'কেন?',
    'components.documentWalletBrowser.yourSelectedDocumentIsOutsideThe':
      'আপনার বেছে নেওয়া ডকুমেন্টটি বর্তমান তালিকার ফিল্টারের বাইরে।',
    'components.purposeChoice.morePurposes': 'আরও উদ্দেশ্য',
    'components.purposeChoice.showCommonPurposes': 'সাধারণ উদ্দেশ্যগুলো দেখান',
    'components.receiptCard.reference': 'রেফারেন্স',
    'components.receiptCard.when': 'কখন',
    'components.referenceCode.copy': 'কপি করুন',
    'components.referenceCode.copyReferenceCode': 'রেফারেন্স {code} কপি করুন',
    'components.siteNavigation.menu': 'মেনু',
    'components.siteNavigation.site': 'সাইট',
    'components.timeZoneSelect.chooseATimeZone': 'টাইম জোন বেছে নিন',
    'components.toast.dismiss': 'বন্ধ করুন',
    'components.versionNotice.aboutThisVersion': 'এই সংস্করণ সম্পর্কে',
    'components.versionNotice.hideThisNotice': 'এই নোটিশ লুকান',
    'components.visaPhotoSizes.checkingYourPhoto': 'আপনার ছবি পরীক্ষা করা হচ্ছে...',
    'components.visaPhotoSizes.chooseTheSizeYourApplicationAsks':
      'আপনার আবেদনে যে মাপ চাওয়া হয়েছে তা বেছে নিন, তারপর মাথা ও কাঁধ মাঝখানে না আসা পর্যন্ত সরান ও জুম করুন। ছবিটি নিজে কখনো এডিট করা হয় না।',
    'components.visaPhotoSizes.downloadThisSize': 'এই সাইজে ডাউনলোড করুন',
    'components.visaPhotoSizes.moveAndZoom': 'সরান ও জুম করুন',
    'components.visaPhotoSizes.moveDown': 'নিচে সরান',
    'components.visaPhotoSizes.moveLeft': 'বাঁয়ে সরান',
    'components.visaPhotoSizes.moveRight': 'ডানে সরান',
    'components.visaPhotoSizes.moveUp': 'উপরে সরান',
    'components.visaPhotoSizes.noProblemsFoundByTheseBasic':
      'এই সাধারণ পরীক্ষাগুলোতে কোনো সমস্যা পাওয়া যায়নি।',
    'components.visaPhotoSizes.photoChecks': 'ছবির পরীক্ষা',
    'components.visaPhotoSizes.photoSize': 'ছবির মাপ',
    'components.visaPhotoSizes.previewOfThePhotoCroppedTo': '{sizeLabel} মাপে ক্রপ করা ছবির প্রিভিউ',
    'components.visaPhotoSizes.resetCrop': 'ক্রপ রিসেট করুন',
    'components.visaPhotoSizes.theseChecksAreAGuideOnly':
      'এই পরীক্ষাগুলো শুধু একটি দিকনির্দেশনা। ছবিটি গ্রহণ করা হবে কি না, তা এগুলো বলতে পারে না।',
    'components.visaPhotoSizes.visaPhotoSizes': 'ভিসা ছবির মাপ',
    'components.visaPhotoSizes.zoomIn': 'জুম ইন করুন',
    'components.visaPhotoSizes.zoomOut': 'ছোট করে দেখুন',
  },
});
