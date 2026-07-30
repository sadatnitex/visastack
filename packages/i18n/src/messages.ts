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
  'consent.core.title': 'Core processing consent',
  'consent.ai.title': 'AI extraction consent',
  'consent.sharing.title': 'Sharing consent',
  'consent.marketing.title': 'Marketing consent',
  'consent.required': 'Consent is required before we can continue.',
  'consent.action.grant': 'Grant',
  'consent.action.revoke': 'Revoke',
  'mission.readiness.missing': '{count} requirement(s) still needed',
  'mission.readiness.ready': 'All required items are provided.',
  'document.scanning': 'This document is being scanned for safety.',
  'document.quarantined': 'This document was flagged and needs attention.',
  'document.status.clean': 'Clean',
  'document.status.pending': 'Pending',
  'document.status.scanning': 'Scanning',
  'document.status.quarantined': 'Quarantined',
  'grant.pending': 'Waiting for {recipient} to accept.',
  'grant.revoked': 'Access has been revoked.',
  'grant.status.pendingAcceptance': 'Pending acceptance',
  'grant.status.awaitingYourAcceptance': 'Awaiting your acceptance',
  'grant.status.active': 'Active',
  'grant.status.paused': 'Paused',
  'grant.status.revoked': 'Revoked',
  'grant.status.expired': 'Expired',
  'legalHold.active': 'This record is under legal hold and cannot be deleted.',
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
  'consent.sharing.title': 'শেয়ারিং সম্মতি',
  'consent.marketing.title': 'মার্কেটিং সম্মতি',
  'consent.required': 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।',
  'consent.action.grant': 'প্রদান করুন',
  'consent.action.revoke': 'প্রত্যাহার করুন',
  'mission.readiness.missing': '{count}টি প্রয়োজনীয় নথি এখনও বাকি',
  'mission.readiness.ready': 'সমস্ত প্রয়োজনীয় নথি প্রদান করা হয়েছে।',
  'document.scanning': 'নিরাপত্তার জন্য এই নথিটি স্ক্যান করা হচ্ছে।',
  'document.quarantined': 'এই নথিটি চিহ্নিত করা হয়েছে এবং মনোযোগ প্রয়োজন।',
  'document.status.clean': 'পরিষ্কার',
  'document.status.pending': 'মুলতুবি',
  'document.status.scanning': 'স্ক্যান করা হচ্ছে',
  'document.status.quarantined': 'চিহ্নিত',
  'grant.pending': '{recipient} গ্রহণ করার অপেক্ষায়।',
  'grant.revoked': 'অ্যাক্সেস প্রত্যাহার করা হয়েছে।',
  'grant.status.pendingAcceptance': 'গ্রহণের অপেক্ষায়',
  'grant.status.awaitingYourAcceptance': 'আপনার গ্রহণের অপেক্ষায়',
  'grant.status.active': 'সক্রিয়',
  'grant.status.paused': 'বিরত',
  'grant.status.revoked': 'প্রত্যাহৃত',
  'grant.status.expired': 'মেয়াদ উত্তীর্ণ',
  // 'legalHold.active' intentionally omitted to exercise English fallback.
};

export const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: EN,
  bn: BN,
};
