/**
 * Bengali drafts for the words inside the shared pictures (the phone that reads a document, the
 * country checklist, the share sheet, the agency case list) and the document names they use. The
 * people, countries and dates in them are made up. Not approved by a person (message-kit.ts).
 */
import { held, o } from './message-kit';

export const KIT_MESSAGES = {
  'kit.example': held('example', 'Example', 'উদাহরণ'),
  'kit.cases': o('Cases', 'ভিসা ফাইল'),
  'kit.shareTitle': o('Share with Agency', 'এজেন্সির সঙ্গে শেয়ার'),
  'kit.notShared': o('Not Shared', 'শেয়ার হয়নি'),
  'kit.shared': o('Shared', 'শেয়ার করা হয়েছে'),
  'kit.reviewed': o('Reviewed', 'পর্যালোচনা করা হয়েছে'),
  'kit.accessEnded': o('Access Ended', 'অ্যাক্সেস শেষ'),
  'kit.ready': o('{name}: {have} of {total} Ready', '{name}: {total}টির মধ্যে {have}টি প্রস্তুত'),
  'kit.doc.passport': o('Passport', 'পাসপোর্ট'),
  'kit.doc.photo': o('Photo', 'ছবি'),
  'kit.doc.flights': o('Flights', 'ফ্লাইট'),
  'kit.doc.insurance': o('Insurance', 'বিমা'),
  'kit.doc.itinerary': o('Itinerary', 'ভ্রমণসূচি'),
  'kit.doc.bankStatement': o('Bank Statement', 'ব্যাংক স্টেটমেন্ট'),
  'kit.doc.bank': o('Bank', 'ব্যাংক'),
  'kit.doc.hotel': o('Hotel Booking', 'হোটেল বুকিং'),
  'kit.doc.invitation': o('Invitation', 'আমন্ত্রণপত্র'),
} as const;
