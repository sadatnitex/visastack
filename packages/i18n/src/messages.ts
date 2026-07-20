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
  'consent.required': 'Consent is required before we can continue.',
  'mission.readiness.missing': '{count} requirement(s) still needed',
  'mission.readiness.ready': 'All required items are provided.',
  'document.scanning': 'This document is being scanned for safety.',
  'document.quarantined': 'This document was flagged and needs attention.',
  'grant.pending': 'Waiting for {recipient} to accept.',
  'grant.revoked': 'Access has been revoked.',
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
  'consent.required': 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।',
  'mission.readiness.missing': '{count}টি প্রয়োজনীয় নথি এখনও বাকি',
  'mission.readiness.ready': 'সমস্ত প্রয়োজনীয় নথি প্রদান করা হয়েছে।',
  'document.scanning': 'নিরাপত্তার জন্য এই নথিটি স্ক্যান করা হচ্ছে।',
  'document.quarantined': 'এই নথিটি চিহ্নিত করা হয়েছে এবং মনোযোগ প্রয়োজন।',
  'grant.pending': '{recipient} গ্রহণ করার অপেক্ষায়।',
  'grant.revoked': 'অ্যাক্সেস প্রত্যাহার করা হয়েছে।',
  // 'legalHold.active' intentionally omitted to exercise English fallback.
};

export const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: EN,
  bn: BN,
};
