import { defineCatalog } from '../catalog';

/**
 * Consent: the six purposes a traveller can grant or revoke, the gate that
 * asks for core processing consent before anything else, and the statement an
 * account holder makes when creating a record for someone else.
 *
 * Consent wording is a legal and privacy statement. Its Bangla must be reviewed
 * by a qualified Bangla-speaking professional before public launch
 * (`review.ts` records that this has not happened yet).
 */
export const consent = defineCatalog(
  { id: 'consent', review: ['CONSENT', 'PRIVACY', 'LEGAL'] },
  {
    'consent.core.title': 'Core processing consent',
    'consent.ai.title': 'AI extraction consent',
    'consent.ocr.title': 'AI OCR consent',
    'consent.sharing.title': 'Sharing consent',
    'consent.marketing.title': 'Marketing consent',
    'consent.issuerContact.title': 'Issuer contact consent',
    'consent.required': 'Consent is required before we can continue.',
    'consent.action.grant': 'Grant',
    'consent.action.revoke': 'Revoke',
    'consent.saving': 'Saving…',
    'consent.granted': 'Consent granted.',
    'consent.revoked': 'Consent revoked.',
    'consent.unknownType': 'Unknown consent type.',

    'consent.overview.kicker': 'Consent',
    'consent.overview.title': 'Permissions you control',
    'consent.overview.body':
      'Each purpose is granted and revoked independently, at any time. Revoking one never requires regranting another. Core processing is required before any applicant or profile records can be created; the others remain optional.',

    'consent.gate.kicker': 'Get started',
    'consent.gate.title': 'Grant core processing consent',
    'consent.gate.body':
      "VisaStack can't create applicant or profile records until you grant this below. You can revoke it again at any time.",

    'consent.authority.confirm':
      'I confirm I have authority to create and manage this record on their behalf. This is never assumed from a shared name or address.',
    'consent.authority.required': 'Confirm you have authority to create this record.',
  },
  {
    'consent.core.title': 'মূল প্রক্রিয়াকরণ সম্মতি',
    'consent.ai.title': 'এআই নিষ্কাশন সম্মতি',
    'consent.ocr.title': 'এআই ওসিআর সম্মতি',
    'consent.sharing.title': 'শেয়ারিং সম্মতি',
    'consent.marketing.title': 'মার্কেটিং সম্মতি',
    'consent.issuerContact.title': 'ইস্যুকারী যোগাযোগ সম্মতি',
    'consent.required': 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।',
    'consent.action.grant': 'প্রদান করুন',
    'consent.action.revoke': 'প্রত্যাহার করুন',
    'consent.saving': 'সংরক্ষণ হচ্ছে…',
    'consent.granted': 'সম্মতি দেওয়া হয়েছে।',
    'consent.revoked': 'সম্মতি প্রত্যাহার করা হয়েছে।',
    'consent.unknownType': 'অজানা সম্মতির ধরন।',

    'consent.overview.kicker': 'সম্মতি',
    'consent.overview.title': 'যে অনুমতিগুলো আপনার নিয়ন্ত্রণে',
    'consent.overview.body':
      'প্রতিটি উদ্দেশ্যের জন্য সম্মতি আলাদাভাবে, যেকোনো সময় দেওয়া ও প্রত্যাহার করা যায়। একটি প্রত্যাহার করলে অন্যটি আবার দিতে হয় না। কোনো আবেদনকারী বা প্রোফাইল রেকর্ড তৈরির আগে মূল প্রক্রিয়াকরণে সম্মতি আবশ্যক; বাকিগুলো ঐচ্ছিক।',

    'consent.gate.kicker': 'শুরু করুন',
    'consent.gate.title': 'মূল প্রক্রিয়াকরণে সম্মতি দিন',
    'consent.gate.body':
      'নিচে এই সম্মতি না দেওয়া পর্যন্ত VisaStack কোনো আবেদনকারী বা প্রোফাইল রেকর্ড তৈরি করতে পারবে না। আপনি যেকোনো সময় এটি আবার প্রত্যাহার করতে পারবেন।',

    'consent.authority.confirm':
      'আমি নিশ্চিত করছি যে তাঁর পক্ষে এই রেকর্ড তৈরি ও পরিচালনার অধিকার আমার আছে। শুধু একই নাম বা ঠিকানা দেখে এই অধিকার কখনো ধরে নেওয়া হয় না।',
    'consent.authority.required': 'এই রেকর্ড তৈরির অধিকার আপনার আছে, তা নিশ্চিত করুন।',
  },
);
