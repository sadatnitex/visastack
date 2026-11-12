import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the pilot-access-denied surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const pilotAccessDeniedCatalog = defineCatalog({
  en: {
    'pilotAccessDenied.pilotAccessDeniedPage.backToHome': 'Back to Home',
    'pilotAccessDenied.pilotAccessDeniedPage.controlledPilot': 'Controlled Pilot',
    'pilotAccessDenied.pilotAccessDeniedPage.signOut': 'Sign Out',
    'pilotAccessDenied.pilotAccessDeniedPage.thisPilotIsInviteOnly': 'This pilot is invite-only',
  },
  bn: {
    'pilotAccessDenied.pilotAccessDeniedPage.backToHome': 'হোমে ফিরে যান',
    'pilotAccessDenied.pilotAccessDeniedPage.controlledPilot': 'নিয়ন্ত্রিত পাইলট',
    'pilotAccessDenied.pilotAccessDeniedPage.signOut': 'সাইন আউট করুন',
    'pilotAccessDenied.pilotAccessDeniedPage.thisPilotIsInviteOnly': 'এই পাইলট শুধু আমন্ত্রিতদের জন্য',
  },
});
