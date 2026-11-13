import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-memory surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantMemoryCatalog = defineCatalog({
  en: {
    'applicantMemory.appApplicantIdMemoryComparePage.1DetailIsStillTheVersion':
      '1 detail is still the version this snapshot used.',
    'applicantMemory.appApplicantIdMemoryComparePage.aNoteWasSavedHiddenHere':
      'A note was saved (hidden here to keep it private)',
    'applicantMemory.appApplicantIdMemoryComparePage.asOf': 'As Of',
    'applicantMemory.appApplicantIdMemoryComparePage.beforeOrAfterTax': 'Before or After Tax',
    'applicantMemory.appApplicantIdMemoryComparePage.compare': 'Compare',
    'applicantMemory.appApplicantIdMemoryComparePage.compareNameThenAndNow':
      'Compare {name}, then and now',
    'applicantMemory.appApplicantIdMemoryComparePage.currency': 'Currency',
    'applicantMemory.appApplicantIdMemoryComparePage.hiddenHereToKeepItPrivate':
      'Hidden here to keep it private',
    'applicantMemory.appApplicantIdMemoryComparePage.howItWasSaved': 'How It Was Saved',
    'applicantMemory.appApplicantIdMemoryComparePage.inSnapshotVersion': 'In Snapshot {version}',
    'applicantMemory.appApplicantIdMemoryComparePage.missiontitleThisDetailAsSnapshotVersion':
      '{missionTitle}: this detail as snapshot {version} recorded it, beside the version in use today.',
    'applicantMemory.appApplicantIdMemoryComparePage.missiontitleWhatDiffersTodayFromSnapshot':
      '{missionTitle}: what differs today from snapshot {version}, taken on {formatTimestampDate}. Names only; open a detail to compare it.',
    'applicantMemory.appApplicantIdMemoryComparePage.none': 'None',
    'applicantMemory.appApplicantIdMemoryComparePage.notRecorded': 'Not recorded',
    'applicantMemory.appApplicantIdMemoryComparePage.noteSavedWithIt': 'Note Saved with It',
    'applicantMemory.appApplicantIdMemoryComparePage.nothingDiffersByVersionEveryDetail':
      'Nothing differs by version: every detail and document in this snapshot is still the one in use.',
    'applicantMemory.appApplicantIdMemoryComparePage.openTheCase': 'Open the Case',
    'applicantMemory.appApplicantIdMemoryComparePage.result': 'Result',
    'applicantMemory.appApplicantIdMemoryComparePage.savedOn': 'Saved On',
    'applicantMemory.appApplicantIdMemoryComparePage.sinceSnapshotVersion':
      'Since Snapshot {version}',
    'applicantMemory.appApplicantIdMemoryComparePage.snapshotVersionKeepsExactlyWhatIt':
      'Snapshot {version} keeps exactly what it held. Updating a detail adds a new version and never changes a snapshot.',
    'applicantMemory.appApplicantIdMemoryComparePage.thenAndNow': 'Then and Now',
    'applicantMemory.appApplicantIdMemoryComparePage.thisComparesWhatWasRecordedIt':
      'This compares what was recorded. It does not say which value is true.',
    'applicantMemory.appApplicantIdMemoryComparePage.thisComparisonCannotBeShownRight':
      'This comparison cannot be shown right now. Try again later.',
    'applicantMemory.appApplicantIdMemoryComparePage.thisOlderSnapshotDidNotRecord':
      'This older snapshot did not record exact versions, so the changes cannot be listed.',
    'applicantMemory.appApplicantIdMemoryComparePage.today': 'Today',
    'applicantMemory.appApplicantIdMemoryComparePage.trueFrom': 'True From',
    'applicantMemory.appApplicantIdMemoryComparePage.unchangeddetailcountDetailsAreStillTheVersions':
      '{unchangedDetailCount} details are still the versions this snapshot used.',
    'applicantMemory.appApplicantIdMemoryComparePage.updateThisDetail': 'Update This Detail',
    'applicantMemory.appApplicantIdMemoryComparePage.value': 'Value',
    'applicantMemory.appApplicantIdMemoryComparePage.viewSnapshotVersion':
      'View Snapshot {version}',
    'applicantMemory.appApplicantIdMemoryComparePage.whatToDoNext': 'What to Do Next',
    'applicantMemory.appApplicantIdMemoryComparePage.whatWasWrittenAtTheTime':
      'What was written at the time. A statement, not proof.',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.case': 'Case',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.compareWithToday': 'Compare with Today',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.nothingHasBeenPreparedForThis':
      'Nothing has been prepared for this case yet.',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.recordsOfTitle': 'Records of {title}',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.thisCaseSFilesWereRemoved':
      "This case's files were removed at the end of its keep period. The record of what happened stays.",
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.viewSnapshotSnapshotversion':
      'View Snapshot {snapshotVersion}',
    'applicantMemory.appApplicantIdMemoryPage.caseHistory': 'Case History',
    'applicantMemory.appApplicantIdMemoryPage.cases': 'Cases',
    'applicantMemory.appApplicantIdMemoryPage.everyCaseForThisPersonWhat':
      'Every case for this person: what was prepared, what you confirmed, who it was shared with, and what you reported as submitted. A snapshot never changes after it is taken.',
    'applicantMemory.appApplicantIdMemoryPage.noCasesYet': 'No Cases Yet',
    'applicantMemory.appApplicantIdMemoryPage.openSharing': 'Open Sharing',
    'applicantMemory.appApplicantIdMemoryPage.sharedOutsideACase': 'Shared Outside a Case',
    'applicantMemory.appApplicantIdMemoryPage.theseSharesAreOfThisPerson':
      "These shares are of this person's record, not of one case.",
    'applicantMemory.appApplicantIdMemoryPage.whenYouPrepareACaseEach':
      'When you prepare a case, each snapshot you take and confirm is kept here exactly as it was.',
  },
  bn: {
    'applicantMemory.appApplicantIdMemoryComparePage.1DetailIsStillTheVersion':
      '১টি তথ্য এখনো এই স্ন্যাপশটে ব্যবহৃত সংস্করণেই আছে।',
    'applicantMemory.appApplicantIdMemoryComparePage.aNoteWasSavedHiddenHere':
      'একটি নোট সংরক্ষণ করা হয়েছে (গোপনীয়তার জন্য এখানে লুকানো আছে)',
    'applicantMemory.appApplicantIdMemoryComparePage.howItWasSaved': 'যেভাবে সংরক্ষণ করা হয়েছে',
    'applicantMemory.appApplicantIdMemoryComparePage.inSnapshotVersion': 'স্ন্যাপশট {version}-এ',
    'applicantMemory.appApplicantIdMemoryComparePage.missiontitleThisDetailAsSnapshotVersion':
      '{missionTitle}: স্ন্যাপশট {version}-এ এই তথ্য যেভাবে রেকর্ড করা ছিল, আজ ব্যবহৃত সংস্করণের পাশে।',
    'applicantMemory.appApplicantIdMemoryComparePage.none': 'নেই',
    'applicantMemory.appApplicantIdMemoryComparePage.noteSavedWithIt': 'এর সঙ্গে সংরক্ষিত নোট',
    'applicantMemory.appApplicantIdMemoryComparePage.nothingDiffersByVersionEveryDetail':
      'সংস্করণের দিক থেকে কোনো পার্থক্য নেই: এই স্ন্যাপশটের প্রতিটি তথ্য ও ডকুমেন্ট এখনো ব্যবহারে থাকা সংস্করণই।',
    'applicantMemory.appApplicantIdMemoryComparePage.result': 'ফলাফল',
    'applicantMemory.appApplicantIdMemoryComparePage.savedOn': 'সংরক্ষণের তারিখ',
    'applicantMemory.appApplicantIdMemoryComparePage.sinceSnapshotVersion':
      'স্ন্যাপশট {version}-এর পর থেকে',
    'applicantMemory.appApplicantIdMemoryComparePage.snapshotVersionKeepsExactlyWhatIt':
      'স্ন্যাপশট {version}-এ যা ছিল ঠিক তা-ই থাকে। কোনো তথ্য হালনাগাদ করলে একটি নতুন সংস্করণ যোগ হয়, কিন্তু কোনো স্ন্যাপশট কখনো বদলায় না।',
    'applicantMemory.appApplicantIdMemoryComparePage.thisOlderSnapshotDidNotRecord':
      'এই পুরোনো স্ন্যাপশটে হুবহু সংস্করণের তথ্য রাখা হয়নি, তাই পরিবর্তনগুলোর তালিকা দেওয়া যাচ্ছে না।',
    'applicantMemory.appApplicantIdMemoryComparePage.viewSnapshotVersion': 'স্ন্যাপশট {version} দেখুন',
    'applicantMemory.appApplicantIdMemoryMemoryCaseList.nothingHasBeenPreparedForThis':
      'এই ভিসা ফাইলের জন্য এখনো কিছু তৈরি করা হয়নি।',
    'applicantMemory.appApplicantIdMemoryPage.caseHistory': 'ভিসা ফাইলের ইতিহাস',
    'applicantMemory.appApplicantIdMemoryPage.everyCaseForThisPersonWhat':
      'এই ব্যক্তির প্রতিটি ভিসা ফাইল: কী প্রস্তুত করা হয়েছে, আপনি কী নিশ্চিত করেছেন, কার সঙ্গে শেয়ার করা হয়েছে, এবং আপনি কী জমা দিয়েছেন বলে জানিয়েছেন। একটি কপি একবার নেওয়ার পর আর কখনো বদলায় না।',
    'applicantMemory.appApplicantIdMemoryPage.noCasesYet': 'এখনো কোনো ভিসা ফাইল নেই',
    'applicantMemory.appApplicantIdMemoryPage.openSharing': 'শেয়ারিং খুলুন',
    'applicantMemory.appApplicantIdMemoryPage.sharedOutsideACase': 'ভিসা ফাইলের বাইরে শেয়ার করা',
    'applicantMemory.appApplicantIdMemoryPage.theseSharesAreOfThisPerson':
      'এই শেয়ারগুলো এই ব্যক্তির রেকর্ডের, কোনো একটি ভিসা ফাইলের নয়।',
  },
});
