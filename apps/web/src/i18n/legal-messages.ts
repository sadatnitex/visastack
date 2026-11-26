/**
 * Bengali drafts for the Terms of Use and the Privacy Notice. EVERY paragraph and heading here is
 * legal wording and is HELD: written out in full so the substance and order of the English are kept
 * one to one, but not shown until the owner (editor and legal reviewer, 12 Nov 2026) or a qualified
 * reviewer signs it off. Only the link texts are live. These are translations of the English as
 * written; they add no promise, remove no limit and interpret nothing. Not approved by a person.
 */
import { held, o } from './message-kit';

const legal = (en: string, bn: string) => held('legal', en, bn);

export const LEGAL_MESSAGES = {
  // Privacy Notice
  'privacy.title': legal('Privacy Notice', 'গোপনীয়তা নোটিশ'),
  'privacy.version': legal(
    'Version {version}. This beta notice awaits legal review.',
    'সংস্করণ {version}। এই বিটা নোটিশ আইনি পর্যালোচনার অপেক্ষায় আছে।',
  ),
  'privacy.info.heading': legal('Information and Purpose', 'তথ্য ও উদ্দেশ্য'),
  'privacy.info.body': legal(
    'Account registration uses your name, email address and sign-in information to create and protect your account and send confirmation or recovery messages. Security controls record registration attempts and notice versions.',
    'অ্যাকাউন্ট রেজিস্ট্রেশনে আপনার নাম, ইমেইল ঠিকানা ও সাইন-ইনের তথ্য ব্যবহার করা হয়, যাতে অ্যাকাউন্ট তৈরি ও সুরক্ষিত করা যায় এবং নিশ্চিতকরণ বা পুনরুদ্ধারের বার্তা পাঠানো যায়। নিরাপত্তা ব্যবস্থায় রেজিস্ট্রেশনের চেষ্টা ও নোটিশের সংস্করণ নথিভুক্ত থাকে।',
  ),
  'privacy.info.open': legal(
    'During the free public beta you may add your own information and documents. The Terms of Use say what to expect while the beta runs.',
    'ফ্রি পাবলিক বিটা চলাকালে আপনি নিজের তথ্য ও ডকুমেন্ট যোগ করতে পারেন। বিটা চলার সময় কী আশা করবেন তা ব্যবহারের শর্তাবলিতে বলা আছে।',
  ),
  'legal.madeUp': legal(
    'Please use made-up details, or documents with all personal information permanently blacked out. Real applicant details are not accepted yet.',
    'অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যাতে সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে। আসল আবেদনকারীর তথ্য এখনো গ্রহণ করা হয় না।',
  ),
  'privacy.services.heading': legal('Services That Process Information', 'যেসব সেবা তথ্য প্রক্রিয়া করে'),
  'privacy.services.body': legal(
    "Vercel hosts the application. {storage} stores private files. Cloudflare R2 stores encrypted backup archives when backups are configured. Neon stores application records. Neon Auth handles sign-in. Resend handles application email when configured. Authentication email uses the configured sign-in provider's mail service. These services can process information outside your country. This notice does not claim a particular data location or a completed compliance review.",
    'Vercel অ্যাপ্লিকেশনটি হোস্ট করে। {storage} ব্যক্তিগত ফাইল সংরক্ষণ করে। ব্যাকআপ চালু থাকলে Cloudflare R2 এনক্রিপ্ট করা ব্যাকআপ আর্কাইভ সংরক্ষণ করে। Neon অ্যাপ্লিকেশনের রেকর্ড সংরক্ষণ করে। Neon Auth সাইন-ইন পরিচালনা করে। চালু থাকলে Resend অ্যাপ্লিকেশনের ইমেইল পাঠায়। অথেনটিকেশন ইমেইল কনফিগার করা সাইন-ইন প্রদানকারীর মেইল সেবা ব্যবহার করে। এই সেবাগুলো আপনার দেশের বাইরেও তথ্য প্রক্রিয়া করতে পারে। এই নোটিশ কোনো নির্দিষ্ট ডেটা অবস্থান বা সম্পন্ন কমপ্লায়েন্স পর্যালোচনার দাবি করে না।',
  ),
  'privacy.storage.generic': legal(
    'The configured private storage service',
    'কনফিগার করা ব্যক্তিগত স্টোরেজ সেবা',
  ),
  'privacy.choices.heading': legal('Separate Choices', 'আলাদা সিদ্ধান্ত'),
  'privacy.choices.body': legal(
    'Acknowledging this notice does not grant marketing permission, enable optional AI processing or share records with an agency. Sharing and optional processing require their own choices and applicable permissions. We do not request marketing consent during registration.',
    'এই নোটিশ স্বীকার করলে মার্কেটিংয়ের অনুমতি দেওয়া হয় না, ঐচ্ছিক এআই প্রক্রিয়াও চালু হয় না, আর কোনো এজেন্সির সঙ্গে রেকর্ডও শেয়ার করা হয় না। শেয়ার করা ও ঐচ্ছিক প্রক্রিয়ার জন্য আলাদা সিদ্ধান্ত ও প্রযোজ্য অনুমতি লাগে। রেজিস্ট্রেশনের সময় আমরা মার্কেটিংয়ের সম্মতি চাই না।',
  ),
  'privacy.access.heading': legal('Access, Export and Deletion', 'অ্যাক্সেস, এক্সপোর্ট ও মুছে ফেলা'),
  'privacy.access.body': legal(
    'Signed-in users can use {link} to review available consent choices, export their account information or request deletion. Deletion is a process, not an immediate promise to erase every record: legal holds and required audit retention can restrict it. Revoking sharing stops future permitted access; it cannot recall copies someone has already downloaded.',
    'সাইন ইন করা ব্যবহারকারীরা {link} ব্যবহার করে সম্মতির বিকল্প দেখতে, নিজের অ্যাকাউন্টের তথ্য এক্সপোর্ট করতে বা মুছে ফেলার অনুরোধ করতে পারেন। মুছে ফেলা একটি প্রক্রিয়া, প্রতিটি রেকর্ড তখনই মুছে ফেলার প্রতিশ্রুতি নয়: আইনি হোল্ড ও প্রয়োজনীয় অডিট সংরক্ষণ এতে বাধা দিতে পারে। শেয়ার প্রত্যাহার করলে ভবিষ্যতে অনুমোদিত অ্যাক্সেস বন্ধ হয়; কেউ আগেই ডাউনলোড করে ফেললে সেই কপি ফেরত আনা যায় না।',
  ),
  'privacy.access.link': o('privacy controls', 'গোপনীয়তা নিয়ন্ত্রণ'),
  'privacy.storage.heading': legal('Storage and Recovery', 'সংরক্ষণ ও পুনরুদ্ধার'),
  'privacy.storage.body': legal(
    'Independent backup and restore protections are still being completed. Do not use this pilot as the only copy of important records. Keep your own originals until real-data safeguards and their acceptance checks are complete.',
    'স্বাধীন ব্যাকআপ ও পুনরুদ্ধারের সুরক্ষা এখনও সম্পূর্ণ হচ্ছে। গুরুত্বপূর্ণ রেকর্ডের একমাত্র কপি হিসেবে এই পাইলট ব্যবহার করবেন না। আসল তথ্যের নিরাপত্তা ব্যবস্থা ও তার গ্রহণযোগ্যতা যাচাই সম্পূর্ণ না হওয়া পর্যন্ত নিজের মূল ডকুমেন্টগুলো নিজের কাছে রাখুন।',
  ),
  'privacy.footer': legal('{terms} or {signup}.', '{terms} অথবা {signup}।'),
  'legal.termsLink': o('Read the Terms of Use', 'ব্যবহারের শর্তাবলি পড়ুন'),
  'legal.signupLink': o('return to account creation', 'অ্যাকাউন্ট তৈরিতে ফিরে যান'),
  'legal.privacyLink': o('Read the Privacy Notice', 'গোপনীয়তা নোটিশ পড়ুন'),

  // Terms of Use
  'terms.title': legal('Terms of Use', 'ব্যবহারের শর্তাবলি'),
  'terms.version': legal(
    'Version {version}. These beta terms await legal review.',
    'সংস্করণ {version}। এই বিটা শর্তাবলি আইনি পর্যালোচনার অপেক্ষায় আছে।',
  ),
  'terms.beta.heading': legal('Free Public Beta', 'ফ্রি পাবলিক বিটা'),
  'terms.beta.body': legal(
    'VisaStack is a free public beta, provided as it is. You may use your own details and documents, at your own risk: some protections, such as virus scanning of uploads, are not switched on yet, and the status page lists what works today. Creating an account does not grant access to an agency workspace.',
    'VisaStack একটি ফ্রি পাবলিক বিটা, যেমন আছে তেমনভাবেই দেওয়া হয়। আপনি নিজের তথ্য ও ডকুমেন্ট ব্যবহার করতে পারেন, নিজের ঝুঁকিতে: আপলোডের ভাইরাস স্ক্যানের মতো কিছু সুরক্ষা এখনও চালু হয়নি, আর আজ কী কাজ করছে তা স্ট্যাটাস পাতায় দেখা যায়। অ্যাকাউন্ট তৈরি করলেই কোনো এজেন্সির ওয়ার্কস্পেসে অ্যাক্সেস পাওয়া যায় না।',
  ),
  'terms.pilot.heading': legal('Private Pilot, Made-Up Details Only', 'প্রাইভেট পাইলট, শুধু বানানো তথ্য'),
  'terms.pilot.lead': legal(
    'VisaStack is a private pilot, provided as it is.',
    'VisaStack একটি প্রাইভেট পাইলট, যেমন আছে তেমনভাবেই দেওয়া হয়।',
  ),
  'terms.pilot.tail': legal(
    'Some protections, such as virus scanning of uploads, are not switched on yet, and the status page lists what works today. Creating an account does not grant access to an agency workspace.',
    'আপলোডের ভাইরাস স্ক্যানের মতো কিছু সুরক্ষা এখনও চালু হয়নি, আর আজ কী কাজ করছে তা স্ট্যাটাস পাতায় দেখা যায়। অ্যাকাউন্ট তৈরি করলেই কোনো এজেন্সির ওয়ার্কস্পেসে অ্যাক্সেস পাওয়া যায় না।',
  ),
  'terms.info.heading': legal('Your Information and Access', 'আপনার তথ্য ও অ্যাক্সেস'),
  'terms.info.body': legal(
    "Only provide information and files you are authorized to use. Keep your sign-in details private. You control whom you share your records with; creating an account gives no agency automatic access. Do not try to access another person's records or misuse the service.",
    'শুধু সেই তথ্য ও ফাইলই দিন যা ব্যবহারের অনুমতি আপনার আছে। আপনার সাইন-ইনের তথ্য গোপন রাখুন। আপনি কার সঙ্গে রেকর্ড শেয়ার করবেন তা আপনিই ঠিক করেন; অ্যাকাউন্ট তৈরি করলে কোনো এজেন্সি নিজে থেকে অ্যাক্সেস পায় না। অন্য কারও রেকর্ডে ঢোকার চেষ্টা করবেন না, বা সেবাটির অপব্যবহার করবেন না।',
  ),
  'terms.free.heading': legal('Free Access and Availability', 'বিনা মূল্যে অ্যাক্সেস ও প্রাপ্যতা'),
  'terms.free.body': legal(
    'Account creation is free. Available features depend on your role, permissions, safety checks and capacity limits. Access may be restricted to prevent abuse or protect records. Features and availability may change while the beta is being completed.',
    'অ্যাকাউন্ট তৈরি বিনা মূল্যে। কোন ফিচার পাওয়া যাবে তা নির্ভর করে আপনার ভূমিকা, অনুমতি, নিরাপত্তা যাচাই ও ক্ষমতার সীমার ওপর। অপব্যবহার ঠেকাতে বা রেকর্ড সুরক্ষিত রাখতে অ্যাক্সেস সীমিত করা হতে পারে। বিটা সম্পূর্ণ হওয়ার সময় ফিচার ও প্রাপ্যতা বদলাতে পারে।',
  ),
  'terms.visa.heading': legal('Visa Decisions', 'ভিসার সিদ্ধান্ত'),
  'terms.visa.body': legal(
    "VisaStack helps organize records and workflows. It does not guarantee a visa, certify a document's authenticity or replace advice from an appropriate professional. A readiness status describes the recorded workflow, not the likelihood of approval.",
    'VisaStack রেকর্ড ও কাজের ধারা গুছিয়ে রাখতে সাহায্য করে। এটি ভিসার নিশ্চয়তা দেয় না, কোনো ডকুমেন্টের সত্যতা প্রত্যয়ন করে না, এবং উপযুক্ত পেশাদারের পরামর্শের বিকল্পও নয়। প্রস্তুতির অবস্থা শুধু নথিভুক্ত কাজের ধারা বোঝায়, অনুমোদনের সম্ভাবনা নয়।',
  ),
  'terms.footer': legal('{privacy} or {signup}.', '{privacy} অথবা {signup}।'),
} as const;
