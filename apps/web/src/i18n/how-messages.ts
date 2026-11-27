/**
 * Bengali drafts for the How It Works page and the pictures it shares with Home (the phone that reads
 * a document, the country checklist, the share sheet). Found by the exact English the page passes to
 * `publicText`. Not approved by a person (message-kit.ts). Where the register already has a word
 * (Suggested, Received, Confirmed, Ready, Turn Off) the same word is used.
 */
import { held, o } from './message-kit';

export const HOW_MESSAGES = {
  'how.title.lead': o('How It', 'এটি যেভাবে'),
  'how.title.end': o('Works.', 'কাজ করে।'),
  'how.lead': o('Four steps. Each one is yours.', 'চারটি ধাপ। প্রতিটি আপনার হাতে।'),
  'how.step.add': o('Add', 'যোগ করুন'),
  'how.step.check': o('Check', 'দেখে নিন'),
  'how.step.prepare': o('Prepare', 'প্রস্তুত করুন'),
  'how.step.addBody': o(
    'Add a document by photo or file. Details are suggested for you to confirm.',
    'ছবি তুলে বা ফাইল থেকে একটি ডকুমেন্ট যোগ করুন। তথ্যগুলো প্রস্তাব করা হয়, আপনি নিশ্চিত করবেন।',
  ),
  'how.step.checkBody': o(
    'Confirm, change or skip each suggestion. Nothing is assumed.',
    'প্রতিটি প্রস্তাব নিশ্চিত করুন, বদলান বা বাদ দিন। কিছুই ধরে নেওয়া হয় না।',
  ),
  'how.step.prepareBody': o(
    'Pick a country and purpose. The checklist fills from what you already have.',
    'একটি দেশ ও উদ্দেশ্য বেছে নিন। আপনার কাছে যা আছে তা থেকেই চেকলিস্ট ভরে ওঠে।',
  ),
  'how.step.shareBody': held(
    'claim',
    'Choose what leaves, for whom, until when. Turn it off any time.',
    'কী বাইরে যাবে, কার কাছে, কতদিনের জন্য, তা আপনি বেছে নিন। যেকোনো সময় বন্ধ করে দিন।',
  ),
  'how.words.lead': o('Words Mean Exactly', 'শব্দের অর্থ ঠিক'),
  'how.words.end': o('What They Say.', 'যা বলা হয় তা-ই।'),
  'how.words.hint': o('Select a word to read what it means.', 'কোনো শব্দ বেছে নিন, তার অর্থ পড়ুন।'),
  'how.words.received': o('Received', 'পাওয়া গেছে'),
  'how.words.receivedNot': o('is not Reviewed', 'মানে দেখা হয়েছে নয়'),
  'how.words.receivedMeans': o(
    'A file arrived. No one has checked it yet.',
    'একটি ডকুমেন্ট এসেছে। এখনও কেউ এটি দেখেননি।',
  ),
  'how.words.suggested': o('Suggested', 'পরামর্শ দেওয়া'),
  'how.words.suggestedNot': o('is not Confirmed', 'মানে নিশ্চিত নয়'),
  'how.words.suggestedMeans': o(
    'A detail was read from your page. Nothing is true until you say so.',
    'আপনার ডকুমেন্টের পাতা থেকে একটি তথ্য পড়া হয়েছে। আপনি নিশ্চিত না করা পর্যন্ত কিছুই সত্য ধরা হয় না।',
  ),
  'how.words.saved': o('Saved', 'সংরক্ষিত'),
  'how.words.savedNot': o('is not Shared', 'মানে শেয়ার করা নয়'),
  'how.words.savedMeans': held(
    'claim',
    'A saved file stays yours until you choose to share it.',
    'সংরক্ষিত ডকুমেন্ট আপনার কাছেই থাকে, যতক্ষণ না আপনি নিজে শেয়ার করতে চান।',
  ),
  'how.words.ready': o('Ready', 'প্রস্তুত'),
  'how.words.readyNot': o('is not Approved', 'মানে অনুমোদিত নয়'),
  'how.words.readyMeans': held(
    'authority',
    'Ready counts what is complete. It never promises a visa.',
    'প্রস্তুত মানে যা সম্পূর্ণ হয়েছে তার গণনা। এটি কখনো ভিসার নিশ্চয়তা দেয় না।',
  ),
  'how.closing.lead': o('See It With Your', 'নিজের পাসপোর্ট দিয়ে'),
  'how.closing.end': o('Own Passport.', 'নিজেই দেখুন।'),
  'how.closing.sub': o('Start with one document.', 'একটি ডকুমেন্ট দিয়ে শুরু করুন।'),

  // The pictures (made-up example data)
  'pic.phone.alt': o('Example of a document being read on a phone', 'ফোনে একটি ডকুমেন্ট পড়ার উদাহরণ'),
  'pic.exampleRecord': o('Example record.', 'উদাহরণ রেকর্ড।'),
  'pic.surname': o('Surname', 'পদবি'),
  'pic.surnameValue': o('Rahman', 'রহমান'),
  'pic.nationality': o('Nationality', 'জাতীয়তা'),
  'pic.nationalityValue': o('Bangladeshi', 'বাংলাদেশি'),
  'pic.passportEnds': o('Passport Ends', 'পাসপোর্টের মেয়াদ শেষ'),
  'pic.passportEndsValue': o('14 Mar 2031', '১৪ মার্চ ২০৩১'),
  'pic.confirmed': o('Confirmed', 'নিশ্চিত করা হয়েছে'),
  'pic.add': o('Add Document', 'ডকুমেন্ট যোগ করুন'),
  'pic.details': o('See Document Details', 'ডকুমেন্টের তথ্য দেখুন'),
  'pic.agencyCanSee': o('Agency can see:', 'এজেন্সি যা দেখতে পারবে:'),
  'pic.turnOff': o('Turn Off', 'বন্ধ করুন'),
  'pic.passportDetails': o('Passport, details', 'পাসপোর্ট, তথ্য'),
  'pic.photoDetails': o('Photo, details', 'ছবি, তথ্য'),
} as const;
