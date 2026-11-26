/**
 * Every word of the approved homepage (LAND1) in English and Bengali, with the review state of each
 * Bengali message. One plain object, so a reviewer reads English beside Bengali in one place and
 * `scripts/i18n/public-bn-packet.mjs` turns it into the review packet without importing the app.
 *
 * Bengali here is a DRAFT written for this change, not a register row and not approved by a person
 * (docs/localization/data/public-bn/). Each message says what kind of wording it is:
 *
 * - `ordinary`: interface wording (labels, buttons, headings, examples). `live: true` ships it.
 * - `claim`: says what the product does with a person's data or who can see it (sharing and access).
 * - `authority`: says that the issuing authority sets the rules and decides the visa.
 * - `status`: says what stage the product is in (pilot, beta, test build) or what may be uploaded.
 * - `example`: the disclaimer that a drawn example is illustrative.
 *
 * Everything that is not `ordinary` is HELD: `live: false`, so a Bengali visitor reads the English
 * (marked `lang="en"`) until the owner or a qualified reviewer signs it off and the flag is flipped.
 * The Bengali is written out in full so that flip is one line per message.
 *
 * `{token}` placeholders are the same in both languages. `{link}` marks where the page puts a link
 * inside a sentence; the sentence stays one message so a translator can order the words.
 */
export type LandingClass = 'ordinary' | 'claim' | 'authority' | 'status' | 'example';

export interface LandingMessage {
  readonly en: string;
  readonly bn: string;
  readonly cls: LandingClass;
  /** True when the Bengali is shown to a visitor who chose Bengali. False: held for review. */
  readonly live: boolean;
}

const o = (en: string, bn: string): LandingMessage => ({ en, bn, cls: 'ordinary', live: true });
const held = (cls: Exclude<LandingClass, 'ordinary'>, en: string, bn: string): LandingMessage => ({
  en,
  bn,
  cls,
  live: false,
});

export const LANDING_MESSAGES = {
  // First screen
  'landing.hero.kicker': o(
    'For travellers applying from Bangladesh',
    'বাংলাদেশ থেকে ভিসার জন্য আবেদনকারী ভ্রমণকারীদের জন্য',
  ),
  'landing.hero.titleLead': o('Your visa paperwork,', 'আপনার ভিসার কাগজপত্র,'),
  'landing.hero.titleEm': o('in order.', 'একদম গোছানো।'),
  'landing.hero.lead': held(
    'claim',
    'Check official sources, organise a case for yourself or your family, and share only the documents you choose.',
    'অফিসিয়াল উৎস দেখে নিন, নিজের বা পরিবারের জন্য ভিসা ফাইল গুছিয়ে রাখুন, আর শুধু নিজের বেছে নেওয়া ডকুমেন্টই শেয়ার করুন।',
  ),
  'landing.hero.caption': o(
    'One record for this trip and the next.',
    'এই ভ্রমণের জন্য আর পরের ভ্রমণের জন্যও একটি রেকর্ড।',
  ),

  // The destination planner
  'landing.planner.label': o('Where are you going?', 'আপনি কোথায় যাচ্ছেন?'),
  'landing.planner.placeholder': o('Choose a destination', 'গন্তব্য বেছে নিন'),
  'landing.planner.submit': o('See My First Steps', 'আমার প্রথম ধাপগুলো দেখুন'),
  'landing.planner.noAccount': o('Start without an account.', 'অ্যাকাউন্ট ছাড়াই শুরু করতে পারেন।'),
  'landing.planner.browse': o('Browse All Country Guides', 'সব দেশের গাইড দেখুন'),

  // The plan the planner opens
  'landing.plan.kicker': o('Your Starting Plan', 'আপনার শুরুর পরিকল্পনা'),
  'landing.plan.title': o('Getting ready for {country}', '{country} যাওয়ার প্রস্তুতি'),
  'landing.plan.titleFallback': o('Your first steps', 'আপনার প্রথম ধাপগুলো'),
  'landing.plan.intro': held(
    'authority',
    'Use this plan to organise your work. Confirm the current requirements for your trip with the issuing authority.',
    'এই পরিকল্পনা দিয়ে আপনার কাজ গুছিয়ে নিন। ভ্রমণের জন্য এখনকার প্রয়োজনীয় শর্ত ভিসা প্রদানকারী কর্তৃপক্ষের কাছ থেকে নিশ্চিত করে নিন।',
  ),
  'landing.plan.partyLabel': o('Who are you preparing for?', 'আপনি কার জন্য প্রস্তুতি নিচ্ছেন?'),
  'landing.plan.self': o('Myself', 'নিজের জন্য'),
  'landing.plan.family': o('My Family', 'পরিবারের জন্য'),
  'landing.plan.sourceLead': o('Find the official source', 'অফিসিয়াল উৎস খুঁজুন'),
  'landing.plan.sourceBody': o(
    'Check the country guide and follow its official links where available.',
    'দেশের গাইডটি দেখুন এবং যেখানে আছে সেখানে এর অফিসিয়াল লিংক ধরে এগোন।',
  ),
  'landing.plan.selfCopiesLead': o('Check your saved copies', 'আপনার সংরক্ষিত কপিগুলো দেখে নিন'),
  'landing.plan.selfCopiesBody': o(
    'Keep what still applies and flag what has changed since your last case.',
    'যা এখনও কাজে লাগবে তা রাখুন, আর আপনার আগের ভিসা ফাইলের পর যা বদলেছে তা চিহ্নিত করুন।',
  ),
  'landing.plan.familyCopiesLead': o(
    'Check each traveller’s copies',
    'প্রত্যেক ভ্রমণকারীর কপি দেখে নিন',
  ),
  'landing.plan.familyCopiesBody': o(
    'Keep each person’s documents in their own record and check which details have changed.',
    'প্রত্যেকের ডকুমেন্ট তার নিজের রেকর্ডে রাখুন এবং কোন তথ্য বদলেছে তা দেখে নিন।',
  ),
  'landing.plan.howLead': o('Decide how you’ll prepare', 'কীভাবে প্রস্তুতি নেবেন ঠিক করুন'),
  'landing.plan.howBody': o(
    'Prepare on your own or choose which copies to share with an agency.',
    'নিজেই প্রস্তুতি নিন, অথবা এজেন্সির সঙ্গে কোন কপিগুলো শেয়ার করবেন তা বেছে নিন।',
  ),
  'landing.plan.guide': o('Find {country} in Country Guides', 'দেশের গাইডে {country} খুঁজুন'),
  'landing.plan.guideFallback': o('Open Country Guide', 'দেশের গাইড খুলুন'),
  'landing.plan.announceSelf': o(
    'Individual preparation steps shown.',
    'নিজের জন্য প্রস্তুতির ধাপগুলো দেখানো হচ্ছে।',
  ),
  'landing.plan.announceFamily': o(
    'Family preparation steps shown.',
    'পরিবারের জন্য প্রস্তুতির ধাপগুলো দেখানো হচ্ছে।',
  ),

  // Sources, privacy and status row
  'landing.assurance.region': o(
    'Sources, privacy and product status',
    'উৎস, গোপনীয়তা ও VisaStack-এর বর্তমান অবস্থা',
  ),
  'landing.assurance.sourceText': o('Start from the official source', 'অফিসিয়াল উৎস থেকে শুরু করুন'),
  'landing.assurance.sourceLink': o('See Country Guides and Sources', 'দেশের গাইড ও উৎস দেখুন'),
  'landing.assurance.shareText': held(
    'claim',
    'You choose what to share',
    'কী শেয়ার করবেন তা আপনিই ঠিক করেন',
  ),
  'landing.assurance.shareLink': o('See How Access Works', 'অ্যাক্সেস কীভাবে কাজ করে দেখুন'),
  'landing.status.pilot': held(
    'status',
    'VisaStack is in a controlled pilot',
    'VisaStack এখন নিয়ন্ত্রিত পাইলট পর্যায়ে আছে',
  ),
  'landing.status.beta': held(
    'status',
    'VisaStack is in public beta',
    'VisaStack এখন পাবলিক বিটা পর্যায়ে আছে',
  ),
  'landing.status.testBuild': held('status', 'This is a test build', 'এটি একটি টেস্ট সংস্করণ'),
  'landing.status.live': o('See what works today', 'আজ কী কাজ করছে দেখুন'),

  // Prepare a case
  'landing.prepare.kicker': o('Prepare a Case', 'ভিসা ফাইল প্রস্তুত করুন'),
  'landing.prepare.titleLead': o('See what’s ready.', 'কী তৈরি আছে দেখুন।'),
  'landing.prepare.titleEm': o('Know what to do next.', 'পরের ধাপ জেনে নিন।'),
  'landing.prepare.body': o(
    'Bring the documents and details for one trip into a case. See what you already have, what needs a newer copy, and what your agency is waiting for.',
    'এক ভ্রমণের ডকুমেন্ট ও তথ্য একটি ভিসা ফাইলে নিয়ে আসুন। আপনার কাছে কী আছে, কোনটার নতুন কপি লাগবে, আর আপনার এজেন্সি কীসের অপেক্ষায় আছে, সবই দেখুন।',
  ),
  'landing.prepare.link': o('See How VisaStack Works', 'VisaStack কীভাবে কাজ করে দেখুন'),
  'landing.case.name': o('Preparing a family visit', 'পরিবারের ভিসার প্রস্তুতি'),
  'landing.case.example': o('Example case', 'উদাহরণ ভিসা ফাইল'),
  'landing.case.view': o('Traveller View', 'ভ্রমণকারীর ভিউ'),
  'landing.case.passportName': o('Passport Copy', 'পাসপোর্টের কপি'),
  'landing.case.passportPill': o('Saved', 'সংরক্ষিত'),
  'landing.case.passportBody': o(
    'Review the saved copy and its expiry date. Each family member has a separate record.',
    'সংরক্ষিত কপি ও এর মেয়াদ শেষের তারিখ দেখে নিন। পরিবারের প্রত্যেক সদস্যের আলাদা রেকর্ড থাকে।',
  ),
  'landing.case.letterName': o('Employment Letter', 'চাকরির চিঠি'),
  'landing.case.letterPill': o('Review Update', 'আপডেট দেখুন'),
  'landing.case.letterBody': o(
    'Compare the old letter with the current one, then choose which version belongs in this case.',
    'পুরোনো চিঠির সঙ্গে বর্তমানটি মিলিয়ে দেখুন, তারপর বেছে নিন কোন কপিটি এই ভিসা ফাইলে থাকবে।',
  ),
  'landing.case.requestName': o('Agency Request', 'এজেন্সির অনুরোধ'),
  'landing.case.requestPill': o('Awaiting Reply', 'উত্তরের অপেক্ষায়'),
  'landing.case.requestBody': o(
    'See who asked and which copies they need. Review the exact items you selected before sending them.',
    'কে চেয়েছে এবং কোন কপি তাদের লাগবে তা দেখুন। পাঠানোর আগে আপনার বেছে নেওয়া আইটেমগুলো ঠিকমতো দেখে নিন।',
  ),
  'landing.case.foot': held(
    'example',
    'Illustrative files. Requirements depend on the country and route.',
    'এগুলো উদাহরণ মাত্র। প্রয়োজনীয় শর্ত দেশ ও আবেদনের ধরনের ওপর নির্ভর করে।',
  ),

  // The reusable record
  'landing.record.kicker': o('Your Reusable Record', 'আপনার পুনর্ব্যবহারযোগ্য রেকর্ড'),
  'landing.record.title': o('Give your next trip a head start.', 'আপনার পরের ভ্রমণে এগিয়ে থাকুন।'),
  'landing.record.bodyOne': o(
    'Keep confirmed details and document versions between trips. If your passport, address or employer changes, compare the old details with the new ones before you reuse them.',
    'নিশ্চিত করা তথ্য ও ডকুমেন্টের কপি এক ভ্রমণ থেকে আরেক ভ্রমণে রেখে দিন। পাসপোর্ট, ঠিকানা বা নিয়োগকর্তা বদলালে আগের তথ্য ফের ব্যবহারের আগে নতুনটির সঙ্গে মিলিয়ে দেখুন।',
  ),
  'landing.record.bodyTwo': o(
    'Build a copy-ready sheet of selected details to use when filling another form.',
    'বেছে নেওয়া তথ্য নিয়ে কপি করার মতো একটি শিট বানান, যা অন্য ফর্ম পূরণের সময় কাজে লাগবে।',
  ),
  'landing.history.name': o('A passport renewal', 'পাসপোর্ট নবায়ন'),
  'landing.history.example': o('Example', 'উদাহরণ'),
  'landing.history.previousTerm': o('Previous Case', 'আগের ভিসা ফাইল'),
  'landing.history.previousName': o('Earlier Passport', 'আগের পাসপোর্ট'),
  'landing.history.previousBody': o(
    'The past case keeps the version used at the time.',
    'আগের ভিসা ফাইলে তখন যে কপিটি ব্যবহার হয়েছিল সেটিই থাকে।',
  ),
  'landing.history.currentTerm': o('Current Record', 'বর্তমান রেকর্ড'),
  'landing.history.currentName': o('Renewed Passport', 'নবায়ন করা পাসপোর্ট'),
  'landing.history.currentBody': o(
    'Keep the new version in your own record.',
    'নতুন কপিটি আপনার নিজের রেকর্ডে রাখুন।',
  ),
  'landing.history.nextTerm': o('Next Case', 'পরের ভিসা ফাইল'),
  'landing.history.nextName': o('Review and Select', 'দেখে নিন ও বেছে নিন'),
  'landing.history.nextBody': o(
    'Choose the current copy for the next application.',
    'পরের আবেদনের জন্য বর্তমান কপিটি বেছে নিন।',
  ),

  // Agencies
  'landing.agency.kicker': o('For Visa Agencies', 'ভিসা এজেন্সির জন্য'),
  'landing.agency.title': o(
    'One request link. A clearer case file.',
    'একটি অনুরোধের লিংক। আরও পরিষ্কার ভিসা ফাইল।',
  ),
  'landing.agency.body': o(
    'Send one link for the documents you need. Follow up on the specific items still missing and review the exact copies they sent, all in the same case.',
    'যে ডকুমেন্ট দরকার তার জন্য একটি লিংক পাঠান। যেসব আইটেম এখনও আসেনি সেগুলোর ফলো-আপ করুন, আর তাদের পাঠানো হুবহু কপিগুলো একই ভিসা ফাইলে দেখে নিন।',
  ),
  'landing.agency.button': o('Explore Agency Workflows', 'এজেন্সির কাজের ধারা দেখুন'),

  // Questions
  'landing.faq.title': o('Before you begin', 'শুরু করার আগে'),
  'landing.faq.q1': o(
    'Can I start before choosing an agency?',
    'এজেন্সি বেছে নেওয়ার আগেই কি শুরু করা যায়?',
  ),
  'landing.faq.a1': o(
    'Yes. Choose a destination to see where to start, or browse the country guides on your own.',
    'হ্যাঁ। কোথা থেকে শুরু করবেন দেখতে একটি গন্তব্য বেছে নিন, অথবা নিজেই দেশের গাইডগুলো ঘুরে দেখুন।',
  ),
  'landing.faq.q2': o('Can I prepare for my family?', 'আমি কি পরিবারের জন্যও প্রস্তুতি নিতে পারি?'),
  'landing.faq.a2': o(
    'Yes. Keep each traveller’s documents separate and work within the permissions you have for that person.',
    'হ্যাঁ। প্রত্যেক ভ্রমণকারীর ডকুমেন্ট আলাদা রাখুন, আর সেই ব্যক্তির জন্য আপনার যে অনুমতি আছে তার মধ্যে থেকে কাজ করুন।',
  ),
  'landing.faq.q3': o(
    'Can an agency see my whole record?',
    'কোনো এজেন্সি কি আমার পুরো রেকর্ড দেখতে পারে?',
  ),
  'landing.faq.a3': held(
    'claim',
    'You choose what to share. Review who is asking and the versions you’re including before you send. {link}.',
    'কী শেয়ার করবেন তা আপনিই ঠিক করেন। পাঠানোর আগে দেখে নিন কে চাইছে এবং কোন কপিগুলো দিচ্ছেন। {link}।',
  ),
  'landing.faq.a3Link': o('Read about privacy and access', 'গোপনীয়তা ও অ্যাক্সেস সম্পর্কে পড়ুন'),
  'landing.faq.q4': o('Does VisaStack issue visas?', 'VisaStack কি ভিসা দেয়?'),
  'landing.faq.a4': held(
    'authority',
    'VisaStack helps you prepare. The issuing authority sets the official requirements and decides your application.',
    'VisaStack আপনাকে প্রস্তুতি নিতে সাহায্য করে। অফিসিয়াল শর্ত ঠিক করে এবং আপনার আবেদনের সিদ্ধান্ত দেয় ভিসা প্রদানকারী কর্তৃপক্ষ।',
  ),
  'landing.faq.q5': o('Can I upload real documents today?', 'আজ কি আসল ডকুমেন্ট আপলোড করা যায়?'),
  'landing.faq.a5Pilot': held(
    'status',
    'Use sample data during the controlled pilot. Check the {link} for what’s available.',
    'নিয়ন্ত্রিত পাইলট চলাকালীন নমুনা ডেটা ব্যবহার করুন। কী কী পাওয়া যাচ্ছে তা জানতে {link} দেখুন।',
  ),
  'landing.faq.a5Beta': held(
    'status',
    'Some features are not switched on yet. Check the {link} for what’s available.',
    'কিছু ফিচার এখনও চালু করা হয়নি। কী কী পাওয়া যাচ্ছে তা জানতে {link} দেখুন।',
  ),
  'landing.faq.a5Test': held(
    'status',
    'This is a test build, so use made-up details only. Check the {link} for what’s available.',
    'এটি একটি টেস্ট সংস্করণ, তাই শুধু বানানো তথ্য ব্যবহার করুন। কী কী পাওয়া যাচ্ছে তা জানতে {link} দেখুন।',
  ),
  'landing.faq.a5Live': held(
    'status',
    'Check the {link} for what’s available.',
    'কী কী পাওয়া যাচ্ছে তা জানতে {link} দেখুন।',
  ),
  'landing.faq.statusLink': o('product status page', 'স্ট্যাটাস পাতা'),

  // Closing action and account actions
  'landing.close.title': o('Where’s your next trip?', 'আপনার পরের ভ্রমণ কোথায়?'),
  'landing.close.choose': o('Choose a Destination', 'গন্তব্য বেছে নিন'),
  'landing.account.create': o('Create your free account', 'বিনা মূল্যে অ্যাকাউন্ট তৈরি করুন'),
  'landing.account.workspace': o('Open your workspace', 'আপনার ওয়ার্কস্পেস খুলুন'),
} as const satisfies Record<string, LandingMessage>;

export type LandingKey = keyof typeof LANDING_MESSAGES;
