/**
 * Bilingual message catalog (Build Spec §9; PRD §6 — English/Bangla).
 *
 * English is the canonical catalog; its keys define the `MessageKey` union so a
 * missing translation is a type-visible gap, and the runtime falls back to
 * English. Messages support `{token}` interpolation. Keep these UI-agnostic —
 * any surface (web, email, docs) can consume them.
 */

export const LOCALES = ['en', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Canonical English catalog. Keys here are the source of truth. */
export const EN = {
  'consent.core.title': 'Core Processing Consent',
  'consent.ai.title': 'AI Extraction Consent',
  'consent.ocr.title': 'AI OCR Consent',
  'consent.sharing.title': 'Sharing Consent',
  'consent.marketing.title': 'Marketing Consent',
  'consent.issuerContact.title': 'Issuer Contact Consent',
  'consent.required': 'Consent is required before we can continue.',
  'consent.action.grant': 'Grant',
  'consent.action.revoke': 'Revoke',
  'mission.readiness.missing': '{count} requirement(s) still needed',
  'mission.readiness.ready': 'All required items are provided.',
  'mission.readiness.needsReview': '{count} requirement(s) need more information to confirm.',
  'mission.readiness.manualOnly': 'This case is not automatically assessed.',
  'document.scanning': 'This document is being scanned for safety.',
  'document.quarantined': 'This document was flagged and needs attention.',
  'document.status.clean': 'No Problems Found',
  'document.status.pending': 'Pending',
  'document.status.scanning': 'Scanning',
  'document.status.quarantined': 'Held for Safety',
  'document.processing.uploading': 'Uploading',
  'document.processing.quarantined': 'Checking the File',
  'document.processing.scanning': 'Checking the File',
  'document.processing.normalizing': 'Checking the File',
  'document.processing.extracting': 'Reading the File',
  'document.processing.awaitingReview': 'Needs Review',
  'document.processing.ready': 'Reviewed and Approved',
  'document.processing.needsAttention': 'Needs Attention',
  'document.processing.failed': 'Failed',
  'document.processing.rejected': 'Rejected',
  'grant.pending': 'Waiting for {recipient} to accept.',
  'grant.revoked': 'Access has been revoked.',
  'grant.status.pendingAcceptance': 'Pending Acceptance',
  'grant.status.awaitingYourAcceptance': 'Awaiting Your Acceptance',
  'grant.status.active': 'Active',
  'grant.status.paused': 'Paused',
  'grant.status.revoked': 'Revoked',
  'grant.status.expired': 'Expired',
  'legalHold.active': 'This record is under legal hold and cannot be deleted.',
  'applicant.relationship.self': 'Myself',
  'applicant.relationship.familyMember': 'Family Member',
  'applicant.relationship.minorGuardian': 'Minor (Guardian)',
  'nav.signIn': 'Sign In',
  'nav.workspace': 'Workspace',
  'error.generic.title': 'Something went wrong',
  'error.generic.body': "This wasn't caused by anything you did, and your data was not affected.",
  'error.notFound.title': 'Page not found',
} as const;

export type MessageKey = keyof typeof EN;

/**
 * Bangla catalog. Intentionally `Partial` — any missing key falls back to
 * English at runtime, so translations can land incrementally without breaking
 * the type or the UI.
 */
export const BN: Partial<Record<MessageKey, string>> = {
  'consent.core.title': 'মূল প্রক্রিয়াকরণ সম্মতি',
  'consent.ai.title': 'এআই নিষ্কাশন সম্মতি',
  'consent.ocr.title': 'এআই ওসিআর সম্মতি',
  'consent.sharing.title': 'শেয়ারিং সম্মতি',
  'consent.marketing.title': 'মার্কেটিং সম্মতি',
  'consent.issuerContact.title': 'ইস্যুকারী যোগাযোগ সম্মতি',
  'consent.required': 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।',
  'consent.action.grant': 'প্রদান করুন',
  'consent.action.revoke': 'প্রত্যাহার করুন',
  'mission.readiness.missing': '{count}টি প্রয়োজনীয় নথি এখনও বাকি',
  'mission.readiness.ready': 'সমস্ত প্রয়োজনীয় নথি প্রদান করা হয়েছে।',
  'mission.readiness.needsReview': '{count}টি বিষয় নিশ্চিত করতে আরও তথ্য প্রয়োজন।',
  'mission.readiness.manualOnly': 'এই কেসটি স্বয়ংক্রিয়ভাবে মূল্যায়ন করা হয় না।',
  'document.scanning': 'নিরাপত্তার জন্য এই নথিটি স্ক্যান করা হচ্ছে।',
  'document.quarantined': 'এই নথিটি চিহ্নিত করা হয়েছে এবং মনোযোগ প্রয়োজন।',
  'document.status.clean': 'পরিষ্কার',
  'document.status.pending': 'মুলতুবি',
  'document.status.scanning': 'স্ক্যান করা হচ্ছে',
  'document.status.quarantined': 'চিহ্নিত',
  'document.processing.uploading': 'আপলোড হচ্ছে',
  'document.processing.quarantined': 'কোয়ারেন্টাইনে',
  'document.processing.scanning': 'স্ক্যান করা হচ্ছে',
  'document.processing.normalizing': 'কাঠামোগত যাচাই',
  'document.processing.extracting': 'প্রক্রিয়াকরণ হচ্ছে',
  'document.processing.awaitingReview': 'পর্যালোচনা প্রয়োজন',
  'document.processing.ready': 'প্রস্তুত',
  'document.processing.needsAttention': 'মনোযোগ প্রয়োজন',
  'document.processing.failed': 'ব্যর্থ হয়েছে',
  'document.processing.rejected': 'প্রত্যাখ্যাত',
  'grant.pending': '{recipient} গ্রহণ করার অপেক্ষায়।',
  'grant.revoked': 'অ্যাক্সেস প্রত্যাহার করা হয়েছে।',
  'grant.status.pendingAcceptance': 'গ্রহণের অপেক্ষায়',
  'grant.status.awaitingYourAcceptance': 'আপনার গ্রহণের অপেক্ষায়',
  'grant.status.active': 'সক্রিয়',
  'grant.status.paused': 'বিরত',
  'grant.status.revoked': 'প্রত্যাহৃত',
  'grant.status.expired': 'মেয়াদ উত্তীর্ণ',
  // 'legalHold.active' intentionally omitted to exercise English fallback.
  'applicant.relationship.self': 'নিজে',
  'applicant.relationship.familyMember': 'পরিবারের সদস্য',
  'applicant.relationship.minorGuardian': 'নাবালক (অভিভাবক)',
  'nav.signIn': 'সাইন ইন',
  'nav.workspace': 'ওয়ার্কস্পেস',
  'error.generic.title': 'কিছু ভুল হয়েছে',
  'error.generic.body': 'এটি আপনার কারণে ঘটেনি, এবং আপনার তথ্য প্রভাবিত হয়নি।',
  'error.notFound.title': 'পৃষ্ঠা পাওয়া যায়নি',
};

export const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: EN,
  bn: BN,
};
