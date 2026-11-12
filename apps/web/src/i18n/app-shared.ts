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
    'appShared.appSharedGrantidPage.documentVault': 'ডকুমেন্ট ভল্ট',
    'appShared.appSharedGrantidPage.profile': 'প্রোফাইল',
    'appShared.appSharedGrantidPage.sharedDocuments': 'শেয়ার করা ডকুমেন্ট',
    'appShared.appSharedGrantidPage.sharedFields': 'শেয়ার করা তথ্যের ঘর',
    'appShared.appSharedGrantidPage.sharedWithYou': '← আপনার সঙ্গে শেয়ার করা',
    'appShared.appSharedGrantidPage.sharedWorkspace': 'শেয়ার করা ওয়ার্কস্পেস',
  },
});
