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
  bn: {
    'appPrivacy.appPrivacyDeletionPanel.helpsUsImproveNotRequired':
      'আমাদের উন্নতিতে সাহায্য করে - আবশ্যক নয়',
    'appPrivacy.appPrivacyDeletionPanel.requestAccountDeletion': 'অ্যাকাউন্ট মুছে ফেলার অনুরোধ করুন',
    'appPrivacy.appPrivacyDeletionPanel.schedulePermanentDeletionOfYourAccount':
      'আপনার অ্যাকাউন্ট ও মালিকানাধীন সব তথ্য স্থায়ীভাবে মুছে ফেলার সময় নির্ধারণ করবেন? বাতিল করার জন্য আপনি ৭ দিনের অপেক্ষার সময় পাবেন।',
    'appPrivacy.appPrivacyLargeExportPanel.needTheActualDocumentFilesToo':
      'শুধু মেটাডেটা নয়, আসল ডকুমেন্টও দরকার? একটি বড় এক্সপোর্টের অনুরোধ করুন - এটি একটি ZIP, যাতে আগের কপিসহ ব্যবহারযোগ্য প্রতিটি আপলোড করা ডকুমেন্ট থাকে, যা ফরম্যাট পরীক্ষা পাস করেছে (ডকুমেন্টে এখনো ভাইরাস স্ক্যান করা হয় না), সঙ্গে উপরের একই ম্যানিফেস্ট ও CSV টেবিল। প্রস্তুত হতে কয়েক মিনিট লাগে এবং ২৪ ঘণ্টা ডাউনলোডের জন্য থাকে।',
    'appPrivacy.appPrivacyPage.aiUseToday': 'আজ এআই-এর ব্যবহার',
    'appPrivacy.appPrivacyPage.consentHistory': 'সম্মতির ইতিহাস',
    'appPrivacy.appPrivacyPage.consentHistoryEntries': 'সম্মতির ইতিহাসের এন্ট্রি',
    'appPrivacy.appPrivacyPage.deleteYourAccount': 'আপনার অ্যাকাউন্ট মুছে ফেলুন',
    'appPrivacy.appPrivacyPage.deletionIsReversibleDuringA7':
      'মুছে ফেলা ৭ দিনের অপেক্ষার সময়ের মধ্যে ফিরিয়ে নেওয়া যায়, এরপর তা স্থায়ী হয়ে যায়। আইনি হোল্ড চালু থাকলে তা তুলে না নেওয়া পর্যন্ত মুছে ফেলা যায় না।',
    'appPrivacy.appPrivacyPage.downloadACompleteStructuredSnapshotOf':
      'আপনার অ্যাকাউন্টের একটি সম্পূর্ণ ও কাঠামোবদ্ধ কপি ডাউনলোড করুন: পরিচয়, সম্মতি, ভ্রমণকারী, সম্পূর্ণ ইতিহাসসহ মাস্টার প্রোফাইলের তথ্য, ডকুমেন্টের মেটাডেটা এবং আপনার অডিট ট্রেইল।',
    'appPrivacy.appPrivacyPage.downloadExportCsvZip': 'এক্সপোর্ট ডাউনলোড করুন (CSV/ZIP)',
    'appPrivacy.appPrivacyPage.downloadExportJson': 'এক্সপোর্ট ডাউনলোড করুন (JSON)',
    'appPrivacy.appPrivacyPage.eachTimeYouTurnAPermission':
      'প্রতিবার আপনি কোনো অনুমতি চালু বা বন্ধ করলে তা তারিখসহ এখানে রেকর্ড করা হয়।',
    'appPrivacy.appPrivacyPage.erasure': 'স্থায়ীভাবে মুছে ফেলা',
    'appPrivacy.appPrivacyPage.exportEverythingReviewYourConsentHistory':
      'সবকিছু এক্সপোর্ট করুন, আপনার সম্মতির ইতিহাস দেখুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।',
    'appPrivacy.appPrivacyPage.exportYourData': 'আপনার ডেটা এক্সপোর্ট করুন',
    'appPrivacy.appPrivacyPage.howMuchYouUsedEachAi':
      'আজ আপনি প্রতিটি এআই ফিচার কতবার ব্যবহার করেছেন। এই গণনার জন্য শুধু সংখ্যাটি রাখা হয়, কী পড়া হয়েছে তা কখনো রাখা হয় না। এই ফিচারগুলো ছাড়াও VisaStack-এর সবকিছু কাজ করে।',
    'appPrivacy.appPrivacyPage.portability': 'ডেটা পোর্টেবিলিটি',
    'appPrivacy.appPrivacyPage.privacyConsent': 'গোপনীয়তা ও সম্মতি',
    'appPrivacy.appPrivacyPage.reviewYourConsentHistory': 'আপনার সম্মতির ইতিহাস পর্যালোচনা করুন',
    'appPrivacy.appPrivacyPage.transparency': 'স্বচ্ছতা',
    'appPrivacy.appPrivacyPage.whatHappensToYourAuditTrail': 'আপনার অডিট ট্রেইলের কী হয়',
    'appPrivacy.appPrivacyPage.yourAuditTrailIsKeptAs':
      'আইন ও নিরাপত্তার প্রয়োজনে আপনার অডিট ট্রেইল রেখে দেওয়া হয়। এটি আর আপনার অ্যাকাউন্টের সঙ্গে যুক্ত থাকে না, তবে ব্যবহৃত আইপি ঠিকানা ও ডিভাইস, একটি অভ্যন্তরীণ রেফারেন্স নম্বর এবং আমন্ত্রণের ক্ষেত্রে ব্যবহৃত ইমেইল ঠিকানার মতো প্রযুক্তিগত তথ্য এতে থাকে।',
    'appPrivacy.appPrivacyPage.yourRights': 'আপনার অধিকার',
  },
});
