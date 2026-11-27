/**
 * Bengali drafts for the words every public page shares: the header menus, the footer, the notice
 * above the header and the page-title template. Not approved by a person (see message-kit.ts and
 * docs/localization/data/public-bn/). Words that already have a reviewed Bengali value in a
 * catalogue (the notice labels, Privacy, Terms, the footer's version line) are not repeated here.
 */
import { held, o } from './message-kit';

export const SHELL_MESSAGES = {
  // Header: the How It Works menu and the phone menu
  'shell.menu.prepare': o('Prepare a Case', 'ভিসা ফাইল প্রস্তুত করুন'),
  'shell.menu.prepareNote': o(
    'See what to review before you share.',
    'শেয়ার করার আগে কী দেখে নিতে হবে তা জানুন।',
  ),
  'shell.menu.record': o('Your Reusable Record', 'আপনার পুনর্ব্যবহারযোগ্য রেকর্ড'),
  'shell.menu.recordNote': o(
    'Carry the right documents into a new trip.',
    'নতুন ভ্রমণে সঠিক ডকুমেন্টগুলো সঙ্গে নিয়ে যান।',
  ),
  'shell.menu.privacyNote': o(
    'See what agencies can access.',
    'এজেন্সি কী কী অ্যাক্সেস করতে পারে তা দেখুন।',
  ),
  'shell.menu.countryGuides': o('Country Guides', 'দেশের গাইড'),
  'shell.menu.trust': o('Privacy and Trust', 'গোপনীয়তা ও আস্থা'),
  'shell.menu.questions': o('Common Questions', 'সাধারণ প্রশ্ন'),

  // Footer
  'shell.footer.about': o(
    'Visa preparation for travellers, families and the agencies that help them.',
    'ভ্রমণকারী, পরিবার এবং তাদের সাহায্যকারী এজেন্সির জন্য ভিসা প্রস্তুতি।',
  ),
  'shell.footer.travellers': o('Travellers', 'ভ্রমণকারী'),
  'shell.footer.workspaces': o('Workspaces', 'ওয়ার্কস্পেস'),
  'shell.footer.trustSupport': o('Trust and Support', 'আস্থা ও সহায়তা'),
  'shell.footer.legal': o('Legal', 'আইনি তথ্য'),
  'shell.footer.status': o('Status', 'স্ট্যাটাস', 'home.layout.status'),

  // The notice above the header
  'shell.notice.pilotDetail': held(
    'status',
    'Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out.',
    'শুধু আমন্ত্রিতদের জন্য পরীক্ষামূলক সংস্করণ। অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যাতে সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে।',
  ),
  'shell.notice.testBuildLabel': held('status', 'VisaStack Test Build', 'VisaStack টেস্ট বিল্ড'),
  'shell.notice.testBuildDetail': held(
    'status',
    'Test build. Not for real personal data.',
    'টেস্ট বিল্ড। আসল ব্যক্তিগত তথ্যের জন্য নয়।',
  ),
  'shell.notice.testBuildShort': held(
    'status',
    'Not for real personal data.',
    'আসল ব্যক্তিগত তথ্যের জন্য নয়।',
  ),
  'shell.notice.whatWorksToday': o(
    'What Works Today',
    'আজ যা কাজ করছে',
    'components.versionNotice.whatWorksToday',
  ),

  // The description search engines and link previews show (held: it says what happens to a profile and who sees it)
  'shell.meta.description': held(
    'claim',
    'A clean file you can stand behind. Keep your passport and documents in one private profile and share only the part you choose.',
    'নিশ্চিন্তে এগিয়ে যাওয়ার মতো একটি গোছানো ফাইল। আপনার পাসপোর্ট ও ডকুমেন্ট এক ব্যক্তিগত প্রোফাইলে রাখুন, আর শুধু বেছে নেওয়া অংশটুকু শেয়ার করুন।',
  ),
} as const;
