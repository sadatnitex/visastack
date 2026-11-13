import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-shared surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appSharedCatalog = defineCatalog({
  en: {
    'appShared.appSharedGrantidPage.aSafeCopyIsAPicture':
      'A safe copy is a picture of each page with the parts the traveller chose covered in black. It is made fresh when you download it.',
    'appShared.appSharedGrantidPage.documentVault': 'Document Vault',
    'appShared.appSharedGrantidPage.everyItemBelowIsReChecked':
      "Every item below is re-checked against your grant's permissions on every visit. It never shows more than what was shared with you, and never less than you're entitled to.",
    'appShared.appSharedGrantidPage.expiresFormattimestampdate': ' · expires {formatTimestampDate}',
    'appShared.appSharedGrantidPage.noDocumentsShared': 'No Documents Shared',
    'appShared.appSharedGrantidPage.noProfileDetailsShared': 'No Profile Details Shared',
    'appShared.appSharedGrantidPage.otherDocumentsCannotBePreviewedHere':
      'Other documents cannot be previewed here yet. This list shows which documents your grant covers. A passport photo shared with safe copies can be sized for a visa application above.',
    'appShared.appSharedGrantidPage.profile': 'Profile',
    'appShared.appSharedGrantidPage.safeCopiesAreNotAvailableHere':
      'Safe copies are not available here yet.',
    'appShared.appSharedGrantidPage.safeCopyNotAvailableForThis':
      'Safe Copy Not Available for This File',
    'appShared.appSharedGrantidPage.safeCopyNotPreparedYet': 'Safe Copy: Not Prepared Yet',
    'appShared.appSharedGrantidPage.sharedDocuments': 'Shared Documents',
    'appShared.appSharedGrantidPage.sharedFields': 'Shared Fields',
    'appShared.appSharedGrantidPage.sharedWithYou': '← Shared with you',
    'appShared.appSharedGrantidPage.sharedWorkspace': 'Shared Workspace',
    'appShared.appSharedGrantidPage.thisAccessIsLimitedToA':
      "This access is limited to a specific case. Case-scoped sharing isn't available yet - nothing is shown below until that support ships.",
    'appShared.appSharedGrantidPage.thisPersonHasNotSharedAny':
      'This person has not shared any profile details with you for this purpose.',
    'appShared.appSharedGrantidPage.thisPersonHasNotSharedAnyb926f7':
      'This person has not shared any documents with you for this purpose.',
  },
  bn: {
    'appShared.appSharedGrantidPage.aSafeCopyIsAPicture':
      'নিরাপদ কপি হলো প্রতিটি পাতার একটি ছবি, যেখানে ভ্রমণকারীর বেছে নেওয়া অংশগুলো কালো করে ঢাকা থাকে। আপনি ডাউনলোড করার সময় এটি নতুন করে তৈরি করা হয়।',
    'appShared.appSharedGrantidPage.documentVault': 'ডকুমেন্ট ভল্ট',
    'appShared.appSharedGrantidPage.everyItemBelowIsReChecked':
      'নিচের প্রতিটি আইটেম প্রতিবার দেখার সময় আপনার অ্যাক্সেসের অনুমতির সঙ্গে আবার মিলিয়ে দেখা হয়। আপনার সঙ্গে যা শেয়ার করা হয়েছে এখানে তার বেশি কখনো দেখানো হয় না, আর আপনি যতটুকু পাওয়ার অধিকারী তার কমও নয়।',
    'appShared.appSharedGrantidPage.expiresFormattimestampdate':
      ' · মেয়াদ শেষ {formatTimestampDate}',
    'appShared.appSharedGrantidPage.noDocumentsShared': 'কোনো ডকুমেন্ট শেয়ার করা হয়নি',
    'appShared.appSharedGrantidPage.noProfileDetailsShared': 'প্রোফাইলের কোনো তথ্য শেয়ার করা হয়নি',
    'appShared.appSharedGrantidPage.otherDocumentsCannotBePreviewedHere':
      'অন্যান্য ডকুমেন্টের প্রিভিউ এখানে এখনো দেখা যায় না। এই তালিকায় দেখা যায় আপনার অ্যাক্সেস কোন কোন ডকুমেন্ট কভার করে। নিরাপদ কপিসহ শেয়ার করা পাসপোর্ট ছবি উপরে ভিসা আবেদনের মাপে ঠিক করা যায়।',
    'appShared.appSharedGrantidPage.profile': 'প্রোফাইল',
    'appShared.appSharedGrantidPage.safeCopyNotAvailableForThis':
      'এই ডকুমেন্টের জন্য নিরাপদ কপি পাওয়া যাচ্ছে না',
    'appShared.appSharedGrantidPage.safeCopyNotPreparedYet': 'নিরাপদ কপি: এখনো তৈরি হয়নি',
    'appShared.appSharedGrantidPage.sharedDocuments': 'শেয়ার করা ডকুমেন্ট',
    'appShared.appSharedGrantidPage.sharedFields': 'শেয়ার করা তথ্যের ঘর',
    'appShared.appSharedGrantidPage.sharedWithYou': '← আপনার সঙ্গে শেয়ার করা',
    'appShared.appSharedGrantidPage.sharedWorkspace': 'শেয়ার করা ওয়ার্কস্পেস',
    'appShared.appSharedGrantidPage.thisAccessIsLimitedToA':
      'এই অ্যাক্সেস একটি নির্দিষ্ট ভিসা ফাইলে সীমিত। ভিসা ফাইলভিত্তিক শেয়ারিং এখনো পাওয়া যাচ্ছে না - সেই সুবিধা চালু না হওয়া পর্যন্ত নিচে কিছু দেখানো হবে না।',
    'appShared.appSharedGrantidPage.thisPersonHasNotSharedAny':
      'এই উদ্দেশ্যে এই ব্যক্তি আপনার সঙ্গে প্রোফাইলের কোনো তথ্য শেয়ার করেননি।',
    'appShared.appSharedGrantidPage.thisPersonHasNotSharedAnyb926f7':
      'এই উদ্দেশ্যে এই ব্যক্তি আপনার সঙ্গে কোনো ডকুমেন্ট শেয়ার করেননি।',
  },
});
