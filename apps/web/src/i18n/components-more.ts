import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the components-more surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const componentsMoreCatalog = defineCatalog({
  en: {
    'componentsMore.caseListRow.nextStep': 'Next: {step}',
    'componentsMore.casePreparationSummary.actualCaseWorkflowState': 'Actual case workflow state',
    'componentsMore.casePreparationSummary.completenessIsNotAnApprovalProbability':
      'Completeness is not an approval probability. Review each requirement below.',
    'componentsMore.casePreparationSummary.evidencePreparationCompleteness':
      'Evidence preparation completeness',
    'componentsMore.casePreparationSummary.evidenceProgress': 'Evidence Progress',
    'componentsMore.casePreparationSummary.howThisIsCounted': 'How This Is Counted',
    'componentsMore.casePreparationSummary.readinessIsCompletenessOnlyNeverAn':
      'Readiness is completeness only - never an approval likelihood.',
    'componentsMore.casePreparationSummary.satisfiedrequiredOfRequiredcount':
      '{satisfiedRequired} of {requiredCount}',
    'componentsMore.casePreparationSummary.theBarCountsRequiredItemsThat':
      'The bar counts required items that are on file. Optional and non-applicable items are counted separately.',
    'componentsMore.grantExpiryAccessEndsNote.accessEndsOnDayTheTraveller':
      'Access ends on {day}. The traveller can extend it.',
    'componentsMore.lifecycleRemovalRecordList.nothingHasBeenRemovedFromThis':
      'Nothing has been removed from this record.',
    'componentsMore.lifecycleRemovalRecordList.showMoreLength': 'Show More ({length})',
    'componentsMore.profilePhotoAccountPhotoCard.addYourself': 'Add Yourself',
    'componentsMore.profilePhotoAccountPhotoCard.addYourselfAsATravellerFirst':
      'Add yourself as a traveller first to add your photo.',
    'componentsMore.profilePhotoAccountPhotoCard.profilePhoto': 'Profile Photo',
    'componentsMore.profilePhotoAccountPhotoCard.shownBesideYourNameInYour':
      'Shown beside your name in your workspace. Only you can see it, and it is never used as a visa photo or shared.',
    'componentsMore.profilePhotoAccountPhotoCard.yourPhoto': 'Your Photo',
    'componentsMore.requestThreadRequestThread.olderSendsAreNotShownHere':
      'Older sends are not shown here.',
    'componentsMore.requestThreadRequestThread.reviewed': 'Reviewed ',
    'componentsMore.requestThreadRequestThread.sentBack': 'Sent back ',
    'componentsMore.requestThreadRequestThread.timeNotKept': 'Time not kept',
    'componentsMore.safeCopyDownload.confirmItIsYou': 'Confirm It Is You',
    'componentsMore.safeCopyDownload.downloadSafeCopy': 'Download Safe Copy',
    'componentsMore.safeCopyDownload.makingYourSafeCopyThisCan':
      'Making your safe copy. This can take up to half a minute.',
    'componentsMore.safeCopyDownload.safeCopyDownloaded': 'Safe copy downloaded.',
    'componentsMore.safeCopyEditor.aSafeCopyIsANew':
      'A safe copy is a new picture of each page with the parts you choose covered in black. It is what people you share safe copies with can download, never the original.',
    'componentsMore.safeCopyEditor.accept': 'Accept',
    'componentsMore.safeCopyEditor.acceptBox': 'Accept Box',
    'componentsMore.safeCopyEditor.acceptBoxNumber': 'Accept box {number}',
    'componentsMore.safeCopyEditor.addBox': 'Add Box',
    'componentsMore.safeCopyEditor.backToEditing': 'Back to Editing',
    'componentsMore.safeCopyEditor.boxesOnThisPage': 'Boxes on This Page',
    'componentsMore.safeCopyEditor.cancelEditing': 'Cancel Editing',
    'componentsMore.safeCopyEditor.changeSafeCopy': 'Change Safe Copy',
    'componentsMore.safeCopyEditor.checkEveryPage': 'Check Every Page',
    'componentsMore.safeCopyEditor.checkEveryPageOnlyTheBlack':
      'Check every page. Only the black boxes are hidden. Suggestions can miss things.',
    'componentsMore.safeCopyEditor.checkEveryPageOnlyTheBlacka8af5a':
      'Check every page. Only the black boxes are hidden.',
    'componentsMore.safeCopyEditor.continuePreparing': 'Continue Preparing',
    'componentsMore.safeCopyEditor.doneOfTotal': '{done} of {total}',
    'componentsMore.safeCopyEditor.drawBoxes': 'Draw Boxes',
    'componentsMore.safeCopyEditor.eachPageIsDrawnOnceWith':
      'Each page is drawn once with its black boxes. Keep this page open; if it closes, choose Continue Preparing to carry on where it stopped.',
    'componentsMore.safeCopyEditor.everyPageMustShowBeforeThe':
      'Every page must show before the safe copy can be saved: {size} of {pageCount} shown so far. Scroll through every page.',
    'componentsMore.safeCopyEditor.loadingThePage': 'Loading the page...',
    'componentsMore.safeCopyEditor.markWhatToHide': 'Mark What to Hide',
    'componentsMore.safeCopyEditor.nextPage': 'Next Page',
    'componentsMore.safeCopyEditor.noBoxesOnThisPageYet': 'No boxes on this page yet.',
    'componentsMore.safeCopyEditor.nothingToHideOnThisDocument': 'Nothing to Hide on This Document',
    'componentsMore.safeCopyEditor.onASelectedBoxArrowKeys':
      'On a selected box, arrow keys move it, Shift with an arrow key changes its size, and Delete removes it. Escape stops a box being drawn and lets go of the selected box.',
    'componentsMore.safeCopyEditor.openingTheDocument': 'Opening the document...',
    'componentsMore.safeCopyEditor.pages': 'Pages',
    'componentsMore.safeCopyEditor.prepareSafeCopy': 'Prepare Safe Copy',
    'componentsMore.safeCopyEditor.preparingTheSafeCopy': 'Preparing the Safe Copy',
    'componentsMore.safeCopyEditor.previousPage': 'Previous Page',
    'componentsMore.safeCopyEditor.remove': 'Remove',
    'componentsMore.safeCopyEditor.removeBox': 'Remove Box',
    'componentsMore.safeCopyEditor.removeBoxNumber': 'Remove box {number}',
    'componentsMore.safeCopyEditor.removeSafeCopy': 'Remove Safe Copy',
    'componentsMore.safeCopyEditor.reviewPages': 'Review Pages',
    'componentsMore.safeCopyEditor.safeCopiesAreNotAvailableHere':
      'Safe copies are not available here yet.',
    'componentsMore.safeCopyEditor.safeCopiesAreNotReadyYet':
      'Safe copies are not ready yet, so nothing can be saved.',
    'componentsMore.safeCopyEditor.safeCopiesCanBeMadeFrom':
      'Safe copies can be made from PDF files and photos only.',
    'componentsMore.safeCopyEditor.safeCopy': 'Safe Copy',
    'componentsMore.safeCopyEditor.saveSafeCopy': 'Save Safe Copy',
    'componentsMore.safeCopyEditor.select': 'Select',
    'componentsMore.safeCopyEditor.selectBoxNumber': 'Select box {number}',
    'componentsMore.safeCopyEditor.selectedBox': 'Selected Box',
    'componentsMore.safeCopyEditor.showThePageAgain': 'Show the Page Again',
    'componentsMore.safeCopyEditor.suggestBoxes': 'Suggest Boxes',
    'componentsMore.safeCopyEditor.thisDocumentIsTooLargeFor':
      'This document is too large for a safe copy. Safe copies take up to 20 pages and 25 MB.',
    'componentsMore.safeCopyEditor.thisPageCouldNotBeShown': 'This page could not be shown.',
    'componentsMore.safeCopyEditor.thisPageShowsWhenYouScroll':
      'This page shows when you scroll to it.',
    'componentsMore.safeCopyEditor.tryAgain': 'Try Again',
    'componentsMore.safeCopyEditor.tryAgainToShowPageNumber': 'Try again to show page {number}',
    'componentsMore.safeCopyEditor.youChoseNothingToHideOn':
      'You chose Nothing to Hide on This Document. Each page is shared as a picture, with no hidden text or file details.',
    'componentsMore.sourceNote.wordsCopiedFromTheSource': 'Words Copied from the Source',
  },
  bn: {
    'componentsMore.casePreparationSummary.actualCaseWorkflowState':
      'ভিসা ফাইলের প্রকৃত কর্মপ্রবাহের অবস্থা',
    'componentsMore.casePreparationSummary.completenessIsNotAnApprovalProbability':
      'সম্পূর্ণতা মানে অনুমোদনের সম্ভাবনা নয়। নিচের প্রতিটি প্রয়োজনীয়তা পর্যালোচনা করুন।',
    'componentsMore.casePreparationSummary.evidencePreparationCompleteness': 'প্রমাণ প্রস্তুতির সম্পূর্ণতা',
    'componentsMore.casePreparationSummary.evidenceProgress': 'প্রমাণের অগ্রগতি',
    'componentsMore.casePreparationSummary.howThisIsCounted': 'এটি কীভাবে গণনা করা হয়',
    'componentsMore.casePreparationSummary.readinessIsCompletenessOnlyNeverAn':
      'প্রস্তুতি মানে শুধু সম্পূর্ণতা - এটি কখনোই অনুমোদনের সম্ভাবনা নয়।',
    'componentsMore.casePreparationSummary.theBarCountsRequiredItemsThat':
      'এই বারে রাখা থাকা আবশ্যক আইটেম গোনা হয়। ঐচ্ছিক ও প্রযোজ্য নয় এমন আইটেম আলাদাভাবে গোনা হয়।',
    'componentsMore.lifecycleRemovalRecordList.nothingHasBeenRemovedFromThis':
      'এই রেকর্ড থেকে কিছু সরানো হয়নি।',
    'componentsMore.lifecycleRemovalRecordList.showMoreLength': 'আরও দেখান ({length})',
    'componentsMore.profilePhotoAccountPhotoCard.addYourself': 'নিজেকে যোগ করুন',
    'componentsMore.profilePhotoAccountPhotoCard.addYourselfAsATravellerFirst':
      'ছবি যোগ করতে আগে নিজেকে ভ্রমণকারী হিসেবে যোগ করুন।',
    'componentsMore.profilePhotoAccountPhotoCard.profilePhoto': 'প্রোফাইল ছবি',
    'componentsMore.profilePhotoAccountPhotoCard.shownBesideYourNameInYour':
      'আপনার ওয়ার্কস্পেসে আপনার নামের পাশে দেখানো হয়। শুধু আপনি এটি দেখতে পান, আর এটি কখনো ভিসার ছবি হিসেবে ব্যবহার বা শেয়ার করা হয় না।',
    'componentsMore.profilePhotoAccountPhotoCard.yourPhoto': 'আপনার ছবি',
    'componentsMore.requestThreadRequestThread.olderSendsAreNotShownHere':
      'আগে পাঠানোগুলো এখানে দেখানো হয় না।',
    'componentsMore.requestThreadRequestThread.timeNotKept': 'সময় রাখা হয়নি',
    'componentsMore.safeCopyDownload.downloadSafeCopy': 'নিরাপদ কপি ডাউনলোড করুন',
    'componentsMore.safeCopyDownload.makingYourSafeCopyThisCan':
      'আপনার নিরাপদ কপি তৈরি করা হচ্ছে। এতে আধা মিনিট পর্যন্ত লাগতে পারে।',
    'componentsMore.safeCopyDownload.safeCopyDownloaded': 'নিরাপদ কপি ডাউনলোড করা হয়েছে।',
    'componentsMore.safeCopyEditor.aSafeCopyIsANew':
      'নিরাপদ কপি হলো প্রতিটি পাতার একটি নতুন ছবি, যাতে আপনার বেছে নেওয়া অংশগুলো কালো রঙে ঢাকা থাকে। আপনি যাঁদের সঙ্গে নিরাপদ কপি শেয়ার করেন, তাঁরা এটিই ডাউনলোড করতে পারেন, মূল ডকুমেন্ট কখনো নয়।',
    'componentsMore.safeCopyEditor.acceptBox': 'বক্স গ্রহণ করুন',
    'componentsMore.safeCopyEditor.addBox': 'বক্স যোগ করুন',
    'componentsMore.safeCopyEditor.backToEditing': 'সম্পাদনায় ফিরে যান',
    'componentsMore.safeCopyEditor.boxesOnThisPage': 'এই পাতার বক্স',
    'componentsMore.safeCopyEditor.cancelEditing': 'সম্পাদনা বাতিল করুন',
    'componentsMore.safeCopyEditor.changeSafeCopy': 'নিরাপদ কপি বদলান',
    'componentsMore.safeCopyEditor.checkEveryPage': 'প্রতিটি পাতা দেখে নিন',
    'componentsMore.safeCopyEditor.checkEveryPageOnlyTheBlack':
      'প্রতিটি পাতা দেখে নিন। শুধু কালো বক্সের অংশই লুকানো হয়। পরামর্শে কিছু বাদ পড়তে পারে।',
    'componentsMore.safeCopyEditor.checkEveryPageOnlyTheBlacka8af5a':
      'প্রতিটি পাতা দেখে নিন। শুধু কালো বক্সের অংশই লুকানো হয়।',
    'componentsMore.safeCopyEditor.drawBoxes': 'বক্স আঁকুন',
    'componentsMore.safeCopyEditor.eachPageIsDrawnOnceWith':
      'প্রতিটি পাতা তার কালো বক্সসহ একবার আঁকা হয়। এই পাতাটি খোলা রাখুন; বন্ধ হয়ে গেলে যেখানে থেমেছিল সেখান থেকে চালিয়ে যেতে "প্রস্তুত করা চালিয়ে যান" বেছে নিন।',
    'componentsMore.safeCopyEditor.everyPageMustShowBeforeThe':
      'নিরাপদ কপি সংরক্ষণ করার আগে প্রতিটি পাতা দেখাতে হবে: এ পর্যন্ত {pageCount}টির মধ্যে {size}টি দেখানো হয়েছে। প্রতিটি পাতা স্ক্রল করে দেখুন।',
    'componentsMore.safeCopyEditor.loadingThePage': 'পাতা লোড হচ্ছে...',
    'componentsMore.safeCopyEditor.markWhatToHide': 'কী লুকাবেন চিহ্নিত করুন',
    'componentsMore.safeCopyEditor.nextPage': 'পরবর্তী পাতা',
    'componentsMore.safeCopyEditor.noBoxesOnThisPageYet': 'এই পাতায় এখনো কোনো বক্স নেই।',
    'componentsMore.safeCopyEditor.nothingToHideOnThisDocument': 'এই ডকুমেন্টে লুকানোর কিছু নেই',
    'componentsMore.safeCopyEditor.onASelectedBoxArrowKeys':
      'নির্বাচিত বক্সে অ্যারো কী চাপলে সেটি সরে যায়, অ্যারো কী-র সঙ্গে শিফট চাপলে এর আকার বদলায়, আর ডিলিট চাপলে সেটি মুছে যায়। এসকেপ চাপলে বক্স আঁকা থেমে যায় এবং নির্বাচিত বক্সটি ছেড়ে দেওয়া হয়।',
    'componentsMore.safeCopyEditor.openingTheDocument': 'ডকুমেন্ট খোলা হচ্ছে...',
    'componentsMore.safeCopyEditor.pages': 'পাতা',
    'componentsMore.safeCopyEditor.prepareSafeCopy': 'নিরাপদ কপি তৈরি করুন',
    'componentsMore.safeCopyEditor.preparingTheSafeCopy': 'নিরাপদ কপি তৈরি করা হচ্ছে',
    'componentsMore.safeCopyEditor.previousPage': 'আগের পাতা',
    'componentsMore.safeCopyEditor.removeBox': 'বক্স সরান',
    'componentsMore.safeCopyEditor.removeSafeCopy': 'নিরাপদ কপি সরান',
    'componentsMore.safeCopyEditor.reviewPages': 'পাতাগুলো পর্যালোচনা করুন',
    'componentsMore.safeCopyEditor.safeCopiesAreNotAvailableHere': 'নিরাপদ কপি এখানে এখনো পাওয়া যায় না।',
    'componentsMore.safeCopyEditor.safeCopiesAreNotReadyYet':
      'নিরাপদ কপি এখনও প্রস্তুত নয়, তাই কিছু সংরক্ষণ করা যাচ্ছে না।',
    'componentsMore.safeCopyEditor.safeCopiesCanBeMadeFrom':
      'শুধু PDF ডকুমেন্ট ও ছবি থেকেই নিরাপদ কপি তৈরি করা যায়।',
    'componentsMore.safeCopyEditor.safeCopy': 'নিরাপদ কপি',
    'componentsMore.safeCopyEditor.saveSafeCopy': 'নিরাপদ কপি সংরক্ষণ করুন',
    'componentsMore.safeCopyEditor.selectedBox': 'বেছে নেওয়া বক্স',
    'componentsMore.safeCopyEditor.suggestBoxes': 'বক্সের পরামর্শ দিন',
    'componentsMore.safeCopyEditor.thisDocumentIsTooLargeFor':
      'এই ডকুমেন্ট নিরাপদ কপির জন্য খুব বড়। নিরাপদ কপিতে সর্বোচ্চ ২০ পাতা ও ২৫ MB থাকতে পারে।',
    'componentsMore.safeCopyEditor.thisPageCouldNotBeShown': 'এই পাতাটি দেখানো যায়নি।',
    'componentsMore.safeCopyEditor.thisPageShowsWhenYouScroll': 'স্ক্রল করে এই পাতায় এলে এটি দেখা যাবে।',
    'componentsMore.safeCopyEditor.tryAgain': 'আবার চেষ্টা করুন',
    'componentsMore.sourceNote.wordsCopiedFromTheSource': 'উৎস থেকে কপি করা শব্দ',
  },
});
