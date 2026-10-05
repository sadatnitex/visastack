import { defineCatalog } from '../catalog';

/**
 * Privacy actions: exporting data, deleting the account, the legal-hold
 * notices that can block a deletion, and the consent history.
 *
 * These are statements about a person's data rights and about what the platform
 * will do with and to their data, including the meaning of a legal hold. The
 * Bangla must be reviewed by a qualified Bangla-speaking legal and privacy
 * professional before public launch (`review.ts`).
 */
export const privacy = defineCatalog(
  { id: 'privacy', review: ['PRIVACY', 'LEGAL', 'CONSENT'] },
  {
    'privacy.eyebrow': 'Privacy',
    'privacy.title': 'Your data rights',
    'privacy.subtitle': 'Export everything, review your consent history, or delete your account.',

    'privacy.export.kicker': 'Portability',
    'privacy.export.title': 'Export your data',
    'privacy.export.body':
      'Download a complete, structured snapshot of your account: identity, consents, applicants, Master Profile facts with full history, document metadata, and your audit trail.',
    'privacy.export.json': 'Download export (JSON)',
    'privacy.export.csv': 'Download export (CSV/ZIP)',

    'privacy.large.body':
      'Need the actual document files too, not just their metadata? Request a large export - a ZIP containing every current, safe document file alongside the same manifest and CSV tables above. It takes a few minutes to prepare and stays downloadable for 24 hours.',
    'privacy.large.request': 'Request large export (with files)',
    'privacy.large.requesting': 'Requesting…',
    'privacy.large.preparing': 'Preparing…',
    'privacy.large.download': 'Download ZIP',
    'privacy.large.expires': 'expires {when}',
    'privacy.large.failed': 'Failed - request a new one',
    'privacy.large.expired': 'Expired',
    'privacy.large.started': 'Preparing your export. This can take a few minutes.',

    'privacy.erase.kicker': 'Erasure',
    'privacy.erase.title': 'Delete your account',
    'privacy.erase.body':
      'Deletion is reversible during a 7-day grace window, then permanent. Your audit trail is preserved and anonymized. An active legal hold blocks deletion until released.',

    'privacy.history.kicker': 'Transparency',
    'privacy.history.title': 'Consent history',
    'privacy.history.empty': 'No consent changes recorded yet.',
    'privacy.history.granted': 'Granted',
    'privacy.history.revoked': 'Revoked',
    'privacy.consent.core': 'Core processing',
    'privacy.consent.ai': 'AI extraction',
    'privacy.consent.ocr': 'AI OCR',
    'privacy.consent.sharing': 'Sharing',
    'privacy.consent.marketing': 'Marketing',
    'privacy.consent.issuerContact': 'Issuer contact',

    'privacy.deletion.pending':
      '<b>Deletion pending.</b> Your account and all owned data are scheduled for permanent deletion on {when}. Cancel any time before then to keep your account.',
    'privacy.deletion.cancel': 'Cancel deletion',
    'privacy.deletion.cancelling': 'Cancelling…',
    'privacy.deletion.cancelled': 'Deletion request cancelled.',
    'privacy.deletion.blocked.one':
      '<b>Deletion is blocked.</b> The following applicant record has an active legal hold and cannot be deleted until it is released:',
    'privacy.deletion.blocked.other':
      '<b>Deletion is blocked.</b> The following applicant records have an active legal hold and cannot be deleted until it is released:',
    'privacy.deletion.hold':
      '<b>{name}</b> - {reason}, scoped to {scope} (placed {placed}, next review {review}, accessible to {accessible})',
    'privacy.deletion.scope.case': 'case "{title}" only',
    'privacy.deletion.scope.document': 'document "{name}" only',
    'privacy.deletion.scope.profile': 'this whole profile',
    'privacy.deletion.review.none': 'not yet scheduled',
    'privacy.deletion.access.none': 'nobody right now',
    'privacy.deletion.warning':
      '<b>This deletes your entire account.</b> There is no partial deletion - every applicant you own goes with it.',
    'privacy.deletion.impact.applicants.one': '{count} applicant ({names})',
    'privacy.deletion.impact.applicants.other': '{count} applicants ({names})',
    'privacy.deletion.impact.none': 'none',
    'privacy.deletion.impact.cases.one': '{count} case',
    'privacy.deletion.impact.cases.other': '{count} cases',
    'privacy.deletion.impact.documents.one': '{count} document',
    'privacy.deletion.impact.documents.other': '{count} documents',
    'privacy.deletion.impact.roles.one':
      '{count} active platform-admin role grant (will be revoked)',
    'privacy.deletion.impact.roles.other':
      '{count} active platform-admin role grants (will be revoked)',
    'privacy.deletion.impact.notes.one':
      '{count} note you left on other cases (kept, author cleared)',
    'privacy.deletion.impact.notes.other':
      '{count} notes you left on other cases (kept, author cleared)',
    'privacy.deletion.copy':
      'Want a copy first? <link>Download your export</link> before deleting - it will not be possible afterward.',
    'privacy.deletion.confirm':
      'Schedule permanent deletion of your account and all owned data? You will have a 7-day grace window to cancel.',
    'privacy.deletion.reason': 'Reason (optional)',
    'privacy.deletion.reasonPlaceholder': 'Helps us improve - not required',
    'privacy.deletion.request': 'Request account deletion',
    'privacy.deletion.requesting': 'Scheduling…',
    'privacy.deletion.scheduled':
      'Deletion scheduled for {when}. You can cancel any time before then.',

    'privacy.error.alreadyPending': 'A deletion request is already pending.',
    'privacy.error.holdBlocks': 'An active legal hold blocks deletion.',
    'privacy.error.noPending': 'There is no pending deletion request.',

    'legalHold.active': 'This record is under legal hold and cannot be deleted.',
  },
  {
    'privacy.eyebrow': 'গোপনীয়তা',
    'privacy.title': 'আপনার তথ্যের অধিকার',
    'privacy.subtitle': 'সবকিছু এক্সপোর্ট করুন, আপনার সম্মতির ইতিহাস দেখুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।',

    'privacy.export.kicker': 'তথ্য স্থানান্তর',
    'privacy.export.title': 'আপনার তথ্য এক্সপোর্ট করুন',
    'privacy.export.body':
      'আপনার অ্যাকাউন্টের একটি সম্পূর্ণ, কাঠামোবদ্ধ কপি ডাউনলোড করুন: পরিচয়, সম্মতি, আবেদনকারী, পূর্ণ ইতিহাসসহ মাস্টার প্রোফাইলের তথ্য, নথির মেটাডেটা এবং আপনার অডিট ট্রেইল।',
    'privacy.export.json': 'এক্সপোর্ট ডাউনলোড করুন (JSON)',
    'privacy.export.csv': 'এক্সপোর্ট ডাউনলোড করুন (CSV/ZIP)',

    'privacy.large.body':
      'শুধু মেটাডেটা নয়, আসল নথির ফাইলগুলোও কি দরকার? বড় এক্সপোর্টের অনুরোধ করুন। এটি একটি ZIP ফাইল, যাতে ওপরের একই ম্যানিফেস্ট ও CSV টেবিলের সঙ্গে প্রতিটি বর্তমান, নিরাপদ নথির ফাইল থাকে। এটি তৈরি হতে কয়েক মিনিট লাগে এবং ২৪ ঘণ্টা ডাউনলোড করা যায়।',
    'privacy.large.request': 'বড় এক্সপোর্টের অনুরোধ করুন (ফাইলসহ)',
    'privacy.large.requesting': 'অনুরোধ করা হচ্ছে…',
    'privacy.large.preparing': 'তৈরি হচ্ছে…',
    'privacy.large.download': 'ZIP ডাউনলোড করুন',
    'privacy.large.expires': 'মেয়াদ শেষ: {when}',
    'privacy.large.failed': 'ব্যর্থ হয়েছে - নতুন করে অনুরোধ করুন',
    'privacy.large.expired': 'মেয়াদ শেষ',
    'privacy.large.started': 'আপনার এক্সপোর্ট তৈরি হচ্ছে। এতে কয়েক মিনিট লাগতে পারে।',

    'privacy.erase.kicker': 'মুছে ফেলা',
    'privacy.erase.title': 'আপনার অ্যাকাউন্ট মুছে ফেলুন',
    'privacy.erase.body':
      'মুছে ফেলার অনুরোধ ৭ দিনের অবকাশকালের মধ্যে ফিরিয়ে নেওয়া যায়, এরপর তা স্থায়ী হয়ে যায়। আপনার অডিট ট্রেইল সংরক্ষিত থাকে এবং তা থেকে পরিচয় মুছে ফেলা হয়। সক্রিয় আইনি সংরক্ষণ আদেশ (লিগ্যাল হোল্ড) তুলে না নেওয়া পর্যন্ত অ্যাকাউন্ট মুছে ফেলা যায় না।',

    'privacy.history.kicker': 'স্বচ্ছতা',
    'privacy.history.title': 'সম্মতির ইতিহাস',
    'privacy.history.empty': 'এখনও সম্মতির কোনো পরিবর্তন নথিভুক্ত হয়নি।',
    'privacy.history.granted': 'প্রদত্ত',
    'privacy.history.revoked': 'প্রত্যাহৃত',
    'privacy.consent.core': 'মূল প্রক্রিয়াকরণ',
    'privacy.consent.ai': 'এআই নিষ্কাশন',
    'privacy.consent.ocr': 'এআই ওসিআর',
    'privacy.consent.sharing': 'শেয়ারিং',
    'privacy.consent.marketing': 'মার্কেটিং',
    'privacy.consent.issuerContact': 'ইস্যুকারীর সঙ্গে যোগাযোগ',

    'privacy.deletion.pending':
      '<b>মুছে ফেলা অপেক্ষমাণ।</b> আপনার অ্যাকাউন্ট ও আপনার মালিকানাধীন সব তথ্য {when} তারিখে স্থায়ীভাবে মুছে ফেলার জন্য নির্ধারিত আছে। অ্যাকাউন্ট রাখতে চাইলে তার আগে যেকোনো সময় এটি বাতিল করুন।',
    'privacy.deletion.cancel': 'মুছে ফেলা বাতিল করুন',
    'privacy.deletion.cancelling': 'বাতিল করা হচ্ছে…',
    'privacy.deletion.cancelled': 'মুছে ফেলার অনুরোধ বাতিল করা হয়েছে।',
    'privacy.deletion.blocked.one':
      '<b>মুছে ফেলা আটকে আছে।</b> নিচের আবেদনকারীর রেকর্ডে সক্রিয় আইনি সংরক্ষণ আদেশ আছে, তাই আদেশ তুলে না নেওয়া পর্যন্ত এটি মুছে ফেলা যাবে না:',
    'privacy.deletion.blocked.other':
      '<b>মুছে ফেলা আটকে আছে।</b> নিচের আবেদনকারীদের রেকর্ডে সক্রিয় আইনি সংরক্ষণ আদেশ আছে, তাই আদেশ তুলে না নেওয়া পর্যন্ত এগুলো মুছে ফেলা যাবে না:',
    'privacy.deletion.hold':
      '<b>{name}</b> - {reason}; পরিসর: {scope} (আরোপ: {placed}, পরবর্তী পর্যালোচনা: {review}, প্রবেশাধিকার আছে: {accessible})',
    'privacy.deletion.scope.case': 'শুধু "{title}" কেস',
    'privacy.deletion.scope.document': 'শুধু "{name}" নথি',
    'privacy.deletion.scope.profile': 'এই পুরো প্রোফাইল',
    'privacy.deletion.review.none': 'এখনও নির্ধারিত হয়নি',
    'privacy.deletion.access.none': 'এই মুহূর্তে কারও নেই',
    'privacy.deletion.warning':
      '<b>এতে আপনার পুরো অ্যাকাউন্ট মুছে যাবে।</b> আংশিক মুছে ফেলার সুযোগ নেই। আপনার মালিকানাধীন প্রতিটি আবেদনকারীও এর সঙ্গে মুছে যাবে।',
    'privacy.deletion.impact.applicants.one': '{count}জন আবেদনকারী ({names})',
    'privacy.deletion.impact.applicants.other': '{count}জন আবেদনকারী ({names})',
    'privacy.deletion.impact.none': 'কেউ নেই',
    'privacy.deletion.impact.cases.one': '{count}টি কেস',
    'privacy.deletion.impact.cases.other': '{count}টি কেস',
    'privacy.deletion.impact.documents.one': '{count}টি নথি',
    'privacy.deletion.impact.documents.other': '{count}টি নথি',
    'privacy.deletion.impact.roles.one': '{count}টি সক্রিয় প্ল্যাটফর্ম-অ্যাডমিন ভূমিকা (প্রত্যাহার করা হবে)',
    'privacy.deletion.impact.roles.other': '{count}টি সক্রিয় প্ল্যাটফর্ম-অ্যাডমিন ভূমিকা (প্রত্যাহার করা হবে)',
    'privacy.deletion.impact.notes.one':
      'অন্য কেসে আপনার রেখে যাওয়া {count}টি নোট (থাকবে, লেখকের নাম মুছে যাবে)',
    'privacy.deletion.impact.notes.other':
      'অন্য কেসে আপনার রেখে যাওয়া {count}টি নোট (থাকবে, লেখকের নাম মুছে যাবে)',
    'privacy.deletion.copy':
      'আগে একটি কপি চান? মুছে ফেলার আগে <link>আপনার এক্সপোর্ট ডাউনলোড করুন</link>। পরে আর তা সম্ভব হবে না।',
    'privacy.deletion.confirm':
      'আপনার অ্যাকাউন্ট ও আপনার মালিকানাধীন সব তথ্য স্থায়ীভাবে মুছে ফেলার সময় নির্ধারণ করবেন? বাতিল করার জন্য আপনি ৭ দিনের অবকাশকাল পাবেন।',
    'privacy.deletion.reason': 'কারণ (ঐচ্ছিক)',
    // Shorter than the English on purpose: a placeholder does not wrap, and the label above
    // already says the reason is optional.
    'privacy.deletion.reasonPlaceholder': 'আমাদের উন্নতিতে সাহায্য করে',
    'privacy.deletion.request': 'অ্যাকাউন্ট মুছে ফেলার অনুরোধ করুন',
    'privacy.deletion.requesting': 'নির্ধারণ করা হচ্ছে…',
    'privacy.deletion.scheduled':
      'মুছে ফেলার তারিখ নির্ধারিত হয়েছে: {when}। তার আগে যেকোনো সময় আপনি এটি বাতিল করতে পারেন।',

    'privacy.error.alreadyPending': 'একটি মুছে ফেলার অনুরোধ ইতিমধ্যেই অপেক্ষমাণ আছে।',
    'privacy.error.holdBlocks': 'একটি সক্রিয় আইনি সংরক্ষণ আদেশের কারণে মুছে ফেলা আটকে আছে।',
    'privacy.error.noPending': 'মুছে ফেলার কোনো অপেক্ষমাণ অনুরোধ নেই।',

    'legalHold.active': 'এই রেকর্ডটি আইনি সংরক্ষণ আদেশের (লিগ্যাল হোল্ড) আওতায় আছে এবং মুছে ফেলা যাবে না।',
  },
);
