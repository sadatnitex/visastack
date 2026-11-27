/**
 * Bengali drafts for the Privacy and Trust page. The page is mostly promises about data and sharing,
 * so the promises and the "what we do and do not do" lists are HELD (claim wording): written out in
 * full, shown in English until signed off. Headings that only name a part, the made-up history rows
 * and the buttons are live. Not approved by a person (message-kit.ts).
 */
import { held, o } from './message-kit';

export const TRUST_MESSAGES = {
  'trust.title.lead': held('claim', 'You decide', 'আপনি ঠিক করেন'),
  'trust.title.end': held('claim', 'who sees what.', 'কে কী দেখবে।'),
  'trust.sub': held(
    'claim',
    'Agencies and other people see it only when you share it.',
    'আপনি শেয়ার করলে তবেই এজেন্সি ও অন্য মানুষ তা দেখতে পায়।',
  ),
  'trust.privacyDetails': o(
    'View Privacy Details',
    'গোপনীয়তার বিস্তারিত দেখুন',
    'trust.publicTrustStory.viewPrivacyDetails',
  ),
  'trust.share.nothing': held('claim', 'Agency can see nothing.', 'এজেন্সি কিছুই দেখতে পায় না।'),
  'trust.pause': o('Pause the Animation', 'অ্যানিমেশন থামান'),
  'trust.promises.heading': held('claim', 'Five promises.', 'পাঁচটি প্রতিশ্রুতি।'),
  'trust.promise.private': held('claim', 'Private by Default', 'ডিফল্টভাবে ব্যক্তিগত'),
  'trust.promise.privateBody': held(
    'claim',
    'Agencies and other people see it only when you share it. Support help is the one exception: it needs a reason and a second approval, lasts at most an hour, and is logged.',
    'আপনি শেয়ার করলে তবেই এজেন্সি ও অন্য মানুষ তা দেখতে পায়। শুধু সহায়তার ক্ষেত্রে একটি ব্যতিক্রম আছে: এর জন্য কারণ ও দ্বিতীয় একটি অনুমোদন লাগে, তা সর্বোচ্চ এক ঘণ্টা থাকে এবং নথিভুক্ত হয়।',
  ),
  'trust.promise.leaves': held('claim', 'See What Leaves', 'কী বাইরে যায় দেখুন'),
  'trust.promise.leavesBody': held(
    'claim',
    'Before you share, you see what goes and what stays private.',
    'শেয়ার করার আগে আপনি দেখতে পান কী যাচ্ছে আর কী ব্যক্তিগত থাকছে।',
  ),
  'trust.promise.off': held('claim', 'Turn Off Any Time', 'যেকোনো সময় বন্ধ করুন'),
  'trust.promise.offBody': held(
    'claim',
    'Every share ends on a date, and you can end it sooner. Copies already downloaded cannot be recalled.',
    'প্রতিটি শেয়ার একটি তারিখে শেষ হয়, আর আপনি চাইলে আগেও শেষ করতে পারেন। আগেই ডাউনলোড করা কপি ফেরত আনা যায় না।',
  ),
  'trust.promise.historyBody': held(
    'claim',
    'Sharing, ending and access to your papers go into a history you can read.',
    'আপনার ডকুমেন্টের শেয়ার, শেয়ার বন্ধ করা এবং অ্যাক্সেস এমন একটি ইতিহাসে লেখা হয় যা আপনি পড়তে পারেন।',
  ),
  'trust.promise.approve': held('claim', 'You Approve Suggestions', 'প্রস্তাব আপনি অনুমোদন করেন'),
  'trust.promise.approveBody': held(
    'claim',
    'A suggested detail is saved as a fact only when you confirm it. You can also type it yourself.',
    'প্রস্তাব করা কোনো তথ্য আপনি নিশ্চিত করলে তবেই তা তথ্য হিসেবে সংরক্ষিত হয়। চাইলে নিজেও লিখে দিতে পারেন।',
  ),
  'trust.history.lead': o('Your history,', 'আপনার ইতিহাস,'),
  'trust.history.end': o('in plain view.', 'স্পষ্টভাবে দেখা যায়।'),
  'trust.history.ended': o('You ended sharing with Agency', 'আপনি এজেন্সির সঙ্গে শেয়ার বন্ধ করেছেন'),
  'trust.history.shared': o(
    'You shared Passport with Agency',
    'আপনি এজেন্সির সঙ্গে পাসপোর্ট শেয়ার করেছেন',
  ),
  'trust.history.confirmed': o('You confirmed Surname', 'আপনি পদবি নিশ্চিত করেছেন'),
  'trust.history.today': o('Today', 'আজ'),
  'trust.history.nov12': o('12 Nov', '১২ নভেম্বর'),
  'trust.history.nov10': o('10 Nov', '১০ নভেম্বর'),
  'trust.do.heading': o('What we do.', 'আমরা যা করি।'),
  'trust.doNot.heading': o('What we do not.', 'আমরা যা করি না।'),
  'trust.do.label': o('We Do', 'আমরা করি'),
  'trust.doNot.label': o('We Do Not', 'আমরা করি না'),
  'trust.do.one': held(
    'claim',
    'Keep your documents private to you',
    'আপনার ডকুমেন্ট শুধু আপনার জন্য ব্যক্তিগত রাখি',
  ),
  'trust.do.two': held('claim', 'Show what every share contains', 'প্রতিটি শেয়ারে কী আছে তা দেখাই'),
  'trust.do.three': held(
    'claim',
    'Record sharing, ending and access to your papers',
    'আপনার ডকুমেন্টের শেয়ার, শেয়ার বন্ধ করা এবং অ্যাক্সেস নথিভুক্ত রাখি',
  ),
  'trust.doNot.one': held('authority', 'Approve or refuse a visa', 'ভিসা অনুমোদন বা প্রত্যাখ্যান করি'),
  'trust.doNot.two': held(
    'authority',
    'Say a document is genuine',
    'কোনো ডকুমেন্টকে আসল বলে প্রত্যয়ন করি',
  ),
  'trust.doNot.three': held(
    'claim',
    'Share your papers unless you choose to',
    'আপনি না চাইলে আপনার ডকুমেন্ট শেয়ার করি',
  ),
  'trust.pilot.kicker': held('status', 'Controlled Pilot', 'নিয়ন্ত্রিত পাইলট'),
  'trust.pilot.lead': o('Where we are', 'আজ আমরা'),
  'trust.pilot.end': o('today.', 'কোথায় আছি।'),
  'trust.pilot.body': held(
    'status',
    'VisaStack is in a controlled pilot. Only practice records are used. Independent checks will be listed here as they are completed, and nothing before.',
    'VisaStack এখন নিয়ন্ত্রিত পাইলট পর্যায়ে আছে। শুধু অনুশীলনের রেকর্ড ব্যবহার করা হয়। স্বাধীন যাচাই সম্পূর্ণ হলে এখানে তালিকাভুক্ত করা হবে, তার আগে কিছু নয়।',
  ),
  'trust.loadError': held(
    'claim',
    'We could not load this page. This is on our side, and nothing you entered anywhere is affected. Please try again in a few minutes. For an urgent question about a visa, use the official website of the country you are applying to.',
    'এই পাতাটি লোড করা যায়নি। সমস্যাটি আমাদের দিকে, আর আপনি কোথাও যা লিখেছেন তার কিছুই প্রভাবিত হয়নি। কয়েক মিনিট পরে আবার চেষ্টা করুন। ভিসা নিয়ে জরুরি প্রশ্ন থাকলে আপনি যে দেশে আবেদন করছেন তার অফিসিয়াল ওয়েবসাইট ব্যবহার করুন।',
  ),
  'trust.closing.lead': held('claim', 'Private from', 'ব্যক্তিগত'),
  'trust.closing.end': held('claim', 'the first document.', 'প্রথম ডকুমেন্ট থেকেই।'),
  'trust.closing.sub': o('Start with a practice record.', 'একটি অনুশীলনের রেকর্ড দিয়ে শুরু করুন।'),
} as const;
