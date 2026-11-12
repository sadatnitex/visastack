import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-privacy surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appPrivacyCatalog = defineCatalog({
  en: {
    'appPrivacy.appPrivacyDeletionPanel.helpsUsImproveNotRequired':
      'Helps us improve - not required',
    'appPrivacy.appPrivacyDeletionPanel.keepMyAccount': 'Keep My Account',
    'appPrivacy.appPrivacyDeletionPanel.reasonOptional': 'Reason (Optional)',
    'appPrivacy.appPrivacyDeletionPanel.requestAccountDeletion': 'Request Account Deletion',
    'appPrivacy.appPrivacyDeletionPanel.schedulePermanentDeletionOfYourAccount':
      'Schedule permanent deletion of your account and all owned data? You will have a 7-day grace window to cancel.',
    'appPrivacy.appPrivacyLargeExportPanel.couldNotBeMade': 'Could not be made',
    'appPrivacy.appPrivacyLargeExportPanel.downloadZip': 'Download ZIP',
    'appPrivacy.appPrivacyLargeExportPanel.expired': 'Expired',
    'appPrivacy.appPrivacyLargeExportPanel.expiresFormatdatetime': 'expires {formatDateTime}',
    'appPrivacy.appPrivacyLargeExportPanel.needTheActualDocumentFilesToo':
      'Need the actual document files too, not just their metadata? Request a large export - a ZIP with every usable document file, including earlier copies, that passed the file format check (files are not scanned for viruses yet) alongside the same manifest and CSV tables above. It takes a few minutes to prepare and stays downloadable for 24 hours.',
    'appPrivacy.appPrivacyLargeExportPanel.preparing': 'Preparing…',
    'appPrivacy.appPrivacyPage.aboutThis': 'About This',
    'appPrivacy.appPrivacyPage.account': 'Account',
    'appPrivacy.appPrivacyPage.aiUseToday': 'AI Use Today',
    'appPrivacy.appPrivacyPage.consentHistory': 'Consent History',
    'appPrivacy.appPrivacyPage.consentHistoryEntries': 'Consent History Entries',
    'appPrivacy.appPrivacyPage.deleteYourAccount': 'Delete Your Account',
    'appPrivacy.appPrivacyPage.deletionIsReversibleDuringA7':
      'Deletion is reversible during a 7-day grace window, then permanent. An active legal hold blocks deletion until released.',
    'appPrivacy.appPrivacyPage.downloadACompleteStructuredSnapshotOf':
      'Download a complete, structured snapshot of your account: identity, consents, travellers, Master Profile facts with full history, document metadata, and your audit trail.',
    'appPrivacy.appPrivacyPage.downloadExportCsvZip': 'Download Export (CSV/ZIP)',
    'appPrivacy.appPrivacyPage.downloadExportJson': 'Download Export (JSON)',
    'appPrivacy.appPrivacyPage.eachTimeYouTurnAPermission':
      'Each time you turn a permission on or off, it is recorded here with the date.',
    'appPrivacy.appPrivacyPage.erasure': 'Erasure',
    'appPrivacy.appPrivacyPage.exportEverythingReviewYourConsentHistory':
      'Export everything, review your consent history, or delete your account.',
    'appPrivacy.appPrivacyPage.exportYourData': 'Export Your Data',
    'appPrivacy.appPrivacyPage.howMuchYouUsedEachAi':
      'How much you used each AI feature today. For this count, only the number is kept, never what was read. Everything in VisaStack works without these features.',
    'appPrivacy.appPrivacyPage.noChangesYet': 'No Changes Yet',
    'appPrivacy.appPrivacyPage.portability': 'Portability',
    'appPrivacy.appPrivacyPage.privacyConsent': 'Privacy & Consent',
    'appPrivacy.appPrivacyPage.reviewYourConsentHistory': 'Review Your Consent History',
    'appPrivacy.appPrivacyPage.transparency': 'Transparency',
    'appPrivacy.appPrivacyPage.whatHappensToYourAuditTrail': 'What Happens to Your Audit Trail',
    'appPrivacy.appPrivacyPage.yourAuditTrailIsKeptAs':
      'Your audit trail is kept, as the law and security require. It no longer links to your account, but it still holds technical details such as the IP address and device used, an internal reference number, and for invitations, the email address used.',
    'appPrivacy.appPrivacyPage.yourRights': 'Your rights',
  },
  bn: {},
});
