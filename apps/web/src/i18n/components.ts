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
    'components.checklistCorrectionForm.https': 'https://',
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
    'components.depthSwitch.i': 'i',
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
    'components.documentWalletBrowser.notsortedAgreeAKind': '{notSorted} {agree} a Kind',
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
    'components.safeCopyDownload.downloadSafeCopy': 'Download Safe Copy',
    'components.safeCopyDownload.makingYourSafeCopyThisCan':
      'Making your safe copy. This can take up to half a minute.',
    'components.safeCopyDownload.safeCopyDownloaded': 'Safe copy downloaded.',
    'components.safeCopyEditor.aSafeCopyIsANew':
      'A safe copy is a new picture of each page with the parts you choose covered in black. It is what people you share safe copies with can download, never the original.',
    'components.safeCopyEditor.accept': 'Accept',
    'components.safeCopyEditor.acceptBox': 'Accept Box',
    'components.safeCopyEditor.addBox': 'Add Box',
    'components.safeCopyEditor.backToEditing': 'Back to Editing',
    'components.safeCopyEditor.boxesOnThisPage': 'Boxes on This Page',
    'components.safeCopyEditor.cancelEditing': 'Cancel Editing',
    'components.safeCopyEditor.changeSafeCopy': 'Change Safe Copy',
    'components.safeCopyEditor.checkEveryPage': 'Check Every Page',
    'components.safeCopyEditor.checkEveryPageOnlyTheBlack':
      'Check every page. Only the black boxes are hidden. Suggestions can miss things.',
    'components.safeCopyEditor.checkEveryPageOnlyTheBlacka8af5a':
      'Check every page. Only the black boxes are hidden.',
    'components.safeCopyEditor.continuePreparing': 'Continue Preparing',
    'components.safeCopyEditor.doneOfTotal': '{done} of {total}',
    'components.safeCopyEditor.drawBoxes': 'Draw Boxes',
    'components.safeCopyEditor.eachPageIsDrawnOnceWith':
      'Each page is drawn once with its black boxes. Keep this page open; if it closes, choose Continue Preparing to carry on where it stopped.',
    'components.safeCopyEditor.everyPageMustShowBeforeThe':
      'Every page must show before the safe copy can be saved: {size} of {pageCount} shown so far. Scroll through every page.',
    'components.safeCopyEditor.loadingThePage': 'Loading the page...',
    'components.safeCopyEditor.markWhatToHide': 'Mark What to Hide',
    'components.safeCopyEditor.nextPage': 'Next Page',
    'components.safeCopyEditor.noBoxesOnThisPageYet': 'No boxes on this page yet.',
    'components.safeCopyEditor.nothingToHideOnThisDocument': 'Nothing to Hide on This Document',
    'components.safeCopyEditor.onASelectedBoxArrowKeys':
      'On a selected box, arrow keys move it, Shift with an arrow key changes its size, and Delete removes it. Escape stops a box being drawn and lets go of the selected box.',
    'components.safeCopyEditor.openingTheDocument': 'Opening the document...',
    'components.safeCopyEditor.pages': 'Pages',
    'components.safeCopyEditor.prepareSafeCopy': 'Prepare Safe Copy',
    'components.safeCopyEditor.preparingTheSafeCopy': 'Preparing the Safe Copy',
    'components.safeCopyEditor.previousPage': 'Previous Page',
    'components.safeCopyEditor.remove': 'Remove',
    'components.safeCopyEditor.removeBox': 'Remove Box',
    'components.safeCopyEditor.removeSafeCopy': 'Remove Safe Copy',
    'components.safeCopyEditor.reviewPages': 'Review Pages',
    'components.safeCopyEditor.safeCopiesAreNotAvailableHere':
      'Safe copies are not available here yet.',
    'components.safeCopyEditor.safeCopiesAreNotReadyYet':
      'Safe copies are not ready yet, so nothing can be saved.',
    'components.safeCopyEditor.safeCopiesCanBeMadeFrom':
      'Safe copies can be made from PDF files and photos only.',
    'components.safeCopyEditor.safeCopy': 'Safe Copy',
    'components.safeCopyEditor.saveSafeCopy': 'Save Safe Copy',
    'components.safeCopyEditor.select': 'Select',
    'components.safeCopyEditor.selectedBox': 'Selected Box',
    'components.safeCopyEditor.showThePageAgain': 'Show the Page Again',
    'components.safeCopyEditor.suggestBoxes': 'Suggest Boxes',
    'components.safeCopyEditor.thisDocumentIsTooLargeFor':
      'This document is too large for a safe copy. Safe copies take up to 20 pages and 25 MB.',
    'components.safeCopyEditor.thisPageCouldNotBeShown': 'This page could not be shown.',
    'components.safeCopyEditor.thisPageShowsWhenYouScroll':
      'This page shows when you scroll to it.',
    'components.safeCopyEditor.tryAgain': 'Try Again',
    'components.safeCopyEditor.youChoseNothingToHideOn':
      'You chose Nothing to Hide on This Document. Each page is shared as a picture, with no hidden text or file details.',
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
    'components.activityLog.everything': 'সবকিছু',
    'components.activityLog.findAnActivity': 'কার্যকলাপ খুঁজুন',
    'components.activityLog.result': 'ফলাফল',
    'components.activityLog.searchThisLog': 'এই লগে খুঁজুন',
    'components.activityLog.showOlderEntries': 'পুরোনো এন্ট্রি দেখান',
    'components.activityLog.whatHappened': 'কী ঘটেছে',
    'components.activityLog.when': 'কখন',
    'components.activityLog.who': 'কে',
    'components.capturePreview.previewOfWhatYouJustCaptured':
      'আপনি এইমাত্র যা তুলেছেন তার প্রিভিউ, পাঠানোর আগে দেখে নেওয়ার জন্য দেখানো হচ্ছে',
    'components.checklistCorrectionForm.chooseOne': 'একটি বেছে নিন',
    'components.checklistCorrectionForm.https': 'https://',
    'components.checklistCorrectionForm.whatShouldItSayOptional': 'এতে কী লেখা থাকবে (ঐচ্ছিক)',
    'components.countryBrowser.allCountries': 'সব দেশ',
    'components.countryBrowser.filterByEntryRule': 'প্রবেশের নিয়ম অনুযায়ী ফিল্টার করুন',
    'components.countryBrowser.forExampleJapan': 'যেমন: জাপান',
    'components.countryBrowser.needsChecking': 'দেখে নেওয়া দরকার',
    'components.depthSwitch.i': 'i',
    'components.documentReviewPanel.chooseADocument': 'একটি ডকুমেন্ট বেছে নিন',
    'components.documentWalletBrowser.aboutThisFile': 'এই ডকুমেন্ট সম্পর্কে',
    'components.documentWalletBrowser.addEachPaperOnce': 'প্রতিটি কাগজ একবারই যোগ করুন।',
    'components.documentWalletBrowser.allCategories': 'সব ক্যাটাগরি',
    'components.documentWalletBrowser.backToDocuments': 'ডকুমেন্টে ফিরে যান',
    'components.documentWalletBrowser.category': 'ক্যাটাগরি',
    'components.documentWalletBrowser.documentMetadataList': 'ডকুমেন্টের মেটাডেটা তালিকা',
    'components.documentWalletBrowser.documentStateFilters': 'ডকুমেন্টের অবস্থা অনুযায়ী ফিল্টার',
    'components.documentWalletBrowser.next': 'পরবর্তী',
    'components.documentWalletBrowser.noDocumentsYet': 'এখনও কোনো ডকুমেন্ট নেই',
    'components.documentWalletBrowser.notSetYet': 'এখনও ঠিক করা হয়নি',
    'components.documentWalletBrowser.previous': 'আগের',
    'components.documentWalletBrowser.selectAnAvailableRowToReview':
      'এর মেটাডেটা ও অনুমতিপ্রাপ্ত কাজ দেখতে একটি উপলব্ধ সারি নির্বাচন করুন।',
    'components.documentWalletBrowser.selectedDocument': 'নির্বাচিত ডকুমেন্ট',
    'components.documentWalletBrowser.selectedDocumentDetails': 'নির্বাচিত ডকুমেন্টের বিস্তারিত',
    'components.documentWalletBrowser.viewSelectedDetails': 'নির্বাচিত বিবরণ দেখুন →',
    'components.documentWalletBrowser.why': 'কেন?',
    'components.purposeChoice.morePurposes': 'আরও উদ্দেশ্য',
    'components.receiptCard.reference': 'রেফারেন্স',
    'components.receiptCard.when': 'কখন',
    'components.referenceCode.copy': 'কপি করুন',
    'components.referenceCode.copyReferenceCode': 'রেফারেন্স {code} কপি করুন',
    'components.safeCopyDownload.downloadSafeCopy': 'নিরাপদ কপি ডাউনলোড করুন',
    'components.safeCopyDownload.makingYourSafeCopyThisCan':
      'আপনার নিরাপদ কপি তৈরি করা হচ্ছে। এতে আধা মিনিট পর্যন্ত লাগতে পারে।',
    'components.safeCopyDownload.safeCopyDownloaded': 'নিরাপদ কপি ডাউনলোড করা হয়েছে।',
    'components.safeCopyEditor.accept': 'গ্রহণ করুন',
    'components.safeCopyEditor.acceptBox': 'বক্স গ্রহণ করুন',
    'components.safeCopyEditor.changeSafeCopy': 'নিরাপদ কপি বদলান',
    'components.safeCopyEditor.everyPageMustShowBeforeThe':
      'নিরাপদ কপি সংরক্ষণ করার আগে প্রতিটি পাতা দেখাতে হবে: এ পর্যন্ত {pageCount}টির মধ্যে {size}টি দেখানো হয়েছে। প্রতিটি পাতা স্ক্রল করে দেখুন।',
    'components.safeCopyEditor.prepareSafeCopy': 'নিরাপদ কপি তৈরি করুন',
    'components.safeCopyEditor.preparingTheSafeCopy': 'নিরাপদ কপি তৈরি করা হচ্ছে',
    'components.safeCopyEditor.previousPage': 'আগের পাতা',
    'components.safeCopyEditor.remove': 'সরান',
    'components.safeCopyEditor.removeBox': 'বাক্স সরান',
    'components.safeCopyEditor.removeSafeCopy': 'নিরাপদ কপি সরান',
    'components.safeCopyEditor.safeCopiesAreNotReadyYet':
      'নিরাপদ কপি এখনও প্রস্তুত নয়, তাই কিছু সংরক্ষণ করা যাচ্ছে না।',
    'components.safeCopyEditor.safeCopy': 'নিরাপদ কপি',
    'components.safeCopyEditor.saveSafeCopy': 'নিরাপদ কপি সংরক্ষণ করুন',
    'components.safeCopyEditor.select': 'নির্বাচন করুন',
    'components.safeCopyEditor.thisDocumentIsTooLargeFor':
      'এই ডকুমেন্ট নিরাপদ কপির জন্য খুব বড়। নিরাপদ কপিতে সর্বোচ্চ ২০ পাতা ও ২৫ MB থাকতে পারে।',
    'components.siteNavigation.menu': 'মেনু',
    'components.siteNavigation.site': 'সাইট',
    'components.timeZoneSelect.chooseATimeZone': 'টাইম জোন বেছে নিন',
    'components.versionNotice.aboutThisVersion': 'এই সংস্করণ সম্পর্কে',
    'components.versionNotice.hideThisNotice': 'এই নোটিশ লুকান',
  },
});
