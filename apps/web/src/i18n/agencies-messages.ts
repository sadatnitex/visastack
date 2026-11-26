/**
 * Bengali drafts for the For Agencies page and the example case list it shows. Names and counts are
 * made up. Not approved by a person (message-kit.ts).
 */
import { held, o } from './message-kit';

export const AGENCIES_MESSAGES = {
  'agencies.title.lead': o('Clients Arrive', 'ক্লায়েন্টরা আসেন'),
  'agencies.title.end': o('Prepared.', 'গোছানো অবস্থায়।'),
  'agencies.lede': held(
    'claim',
    'Clients own their record. You see what they share.',
    'ক্লায়েন্টের রেকর্ড ক্লায়েন্টেরই। তারা যা শেয়ার করে, আপনি শুধু তা-ই দেখেন।',
  ),
  'agencies.desk.lead': o('What Changes', 'যা বদলে যায়'),
  'agencies.desk.end': o('at Your Desk.', 'আপনার ডেস্কে।'),
  'agencies.card.list': o('One List of Cases', 'ভিসা ফাইলের একটি তালিকা'),
  'agencies.card.listBody': o(
    'Each row shows its ring and what is missing.',
    'প্রতিটি সারিতে এর রিং আর কী বাকি আছে তা দেখানো হয়।',
  ),
  'agencies.card.shared': held('claim', 'Only What Is Shared', 'শুধু যা শেয়ার করা হয়'),
  'agencies.card.sharedBody': held(
    'claim',
    'Clients choose what you see, and can end it.',
    'আপনি কী দেখবেন তা ক্লায়েন্টরা বেছে নেন, এবং চাইলে তা বন্ধ করতে পারেন।',
  ),
  'agencies.card.complete': held('authority', 'Completeness, Not Approval', 'সম্পূর্ণতা, অনুমোদন নয়'),
  'agencies.card.completeBody': held(
    'authority',
    'The ring counts what is complete. It never promises a visa.',
    'রিং গোনে কোনটি সম্পূর্ণ। এটি কখনো ভিসার নিশ্চয়তা দেয় না।',
  ),
  'agencies.plans': o('Plans.', 'প্ল্যান।'),
  'agencies.plansLine': o(
    'Pricing is shown here when selling opens.',
    'বিক্রি শুরু হলে মূল্য এখানে দেখানো হবে।',
  ),
  'agencies.plansClosed': held(
    'status',
    'Agency access is by invitation while we test with practice records.',
    'আমরা অনুশীলনের রেকর্ড দিয়ে পরীক্ষা করছি, তাই এজেন্সির অ্যাক্সেস এখন শুধু আমন্ত্রণে।',
  ),
  'agencies.plansOpen': held(
    'status',
    'Accounts are free during the public beta.',
    'পাবলিক বিটা চলাকালে অ্যাকাউন্ট বিনা মূল্যে।',
  ),
  'agencies.closing.lead': o('Bring Your Clients.', 'আপনার ক্লায়েন্টদের নিয়ে আসুন।'),
  'agencies.closing.end': o('Skip the Chasing.', 'বারবার তাগাদা দিতে হবে না।'),
  'agencies.closing.sub': o('Start with what works today.', 'আজ যা কাজ করছে তা দিয়ে শুরু করুন।'),
  'agencies.countries': o('Countries', 'দেশ'),

  // The example case list (made-up people, countries and counts)
  'agencies.example.aisha': o('Aisha K.', 'আয়েশা কে.'),
  'agencies.example.rafi': o('Rafi H.', 'রাফি এইচ.'),
  'agencies.example.nadia': o('Nadia S.', 'নাদিয়া এস.'),
  'agencies.example.singapore': o('Singapore', 'সিঙ্গাপুর'),
  'agencies.example.germany': o('Germany', 'জার্মানি'),
  'agencies.example.japan': o('Japan', 'জাপান'),
  'agencies.example.preparing': o('Being Prepared', 'প্রস্তুতি চলছে'),
  'agencies.example.waiting': o('Waiting on Client', 'ক্লায়েন্টের অপেক্ষায়'),
  'agencies.example.ready': o('Ready to Share', 'শেয়ার করার জন্য প্রস্তুত'),
  'agencies.example.complete': o('Complete', 'সম্পূর্ণ'),
  'agencies.example.twoMissing': o('2 missing', '২টি বাকি'),
  'agencies.example.fiveMissing': o('5 missing', '৫টি বাকি'),
  'agencies.example.alt': o('Example of an agency’s cases', 'একটি এজেন্সির ভিসা ফাইলের উদাহরণ'),
  'agencies.example.note': held(
    'example',
    'Example names and counts. Completeness only. Not an approval.',
    'নাম ও সংখ্যাগুলো উদাহরণ মাত্র। শুধু সম্পূর্ণতা দেখায়, এটি কোনো অনুমোদন নয়।',
  ),
  'agencies.badge.beta': held(
    'status',
    'Free Public Beta',
    'ফ্রি পাবলিক বিটা',
    'home.page.freePublicBeta',
  ),
} as const;
