/**
 * Bengali drafts for the public pages' browser-tab titles (WCAG 2.4.2), found by the exact English
 * title. Not approved by a person (message-kit.ts). Titles reuse the Bengali the menus already use
 * where there is one, so a page is named the same in the tab and in the navigation.
 */
import { o } from './message-kit';

export const TITLES_MESSAGES = {
  'title.home': o('VisaStack - one profile, every visa', 'VisaStack - একটি প্রোফাইল, প্রতিটি ভিসা'),
  'title.how': o('How It Works', 'এটি যেভাবে কাজ করে'),
  'title.agencies': o('For Agencies', 'এজেন্সির জন্য'),
  'title.countries': o('Countries and Sources', 'দেশ ও উৎস'),
  'title.trust': o('Privacy and Trust', 'গোপনীয়তা ও আস্থা'),
  'title.status': o('What Works Today', 'আজ যা কাজ করছে'),
  'title.privacy': o('Privacy Notice', 'গোপনীয়তা নোটিশ'),
  'title.terms': o('Terms of Use', 'ব্যবহারের শর্তাবলি'),
  'title.signIn': o('Sign In', 'সাইন ইন'),
  'title.signUp': o('Create an Account', 'অ্যাকাউন্ট তৈরি করুন'),
  'title.forgot': o('Reset Your Password', 'পাসওয়ার্ড রিসেট করুন'),
  'title.reset': o('Choose a New Password', 'নতুন পাসওয়ার্ড বেছে নিন'),
  'title.verify': o('Confirm Your Email Address', 'আপনার ইমেইল ঠিকানা নিশ্চিত করুন'),
  'title.confirmed': o('Email Confirmed', 'ইমেইল নিশ্চিত হয়েছে'),
  'title.socialReturn': o('Signed In', 'সাইন ইন হয়েছে'),
  'title.recovery': o('Account Access Needs Verification', 'অ্যাকাউন্টে ঢোকার আগে যাচাই দরকার'),
  'title.acceptTerms': o('One Last Step', 'শেষ একটি ধাপ'),
  'title.reauth': o('Confirm it is you', 'নিশ্চিত করুন এটি আপনিই'),
  'title.oauth': o('Connect an AI App', 'একটি এআই অ্যাপ যুক্ত করুন'),
  'title.pilotDenied': o('Invite-Only Pilot', 'শুধু আমন্ত্রিতদের জন্য পাইলট'),
  'title.invitation': o('Your Invitation', 'আপনার আমন্ত্রণ'),
  'title.collect': o('Document Request', 'ডকুমেন্টের অনুরোধ'),
  'title.collectAccount': o('Answer a Document Request', 'ডকুমেন্টের অনুরোধের উত্তর দিন'),
  'title.collectAnswers': o('Your Answers to Agencies', 'এজেন্সিকে দেওয়া আপনার উত্তর'),
  'title.payment': o('Payment Result', 'পেমেন্টের ফলাফল'),
  'title.notFound': o('Page Not Found', 'পাতাটি পাওয়া যায়নি'),
} as const;
