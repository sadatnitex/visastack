/**
 * Bengali drafts for the public Countries page: its headings, search, counts and buttons. Country
 * names come from the platform's Bengali region names (`lib/country-name.ts`), not from here.
 *
 * Official visa rule content (entry labels such as "Visa Needed", the notes, the source lines and the
 * checked dates) stays English by the owner's decision of 12 Nov 2026, with one short Bengali note
 * saying so; its Bengali drafts are written out here and held. Not approved by a person.
 */
import { held, o } from './message-kit';

export const COUNTRIES_MESSAGES = {
  'countries.title.lead': o('Every Country.', 'প্রতিটি দেশ।'),
  'countries.title.end': o('With Its Sources.', 'তার উৎসসহ।'),
  'countries.lede': o(
    'Pick where you are going and see what you need, with the official page for each rule.',
    'আপনি কোথায় যাচ্ছেন বেছে নিন, আর দেখুন কী কী লাগবে, প্রতিটি নিয়মের অফিসিয়াল পাতাসহ।',
  ),
  'countries.asPublished': o(
    'Official country rules are shown in English, as published.',
    'দেশের অফিসিয়াল নিয়মগুলো যেভাবে প্রকাশিত, সেভাবেই ইংরেজিতে দেখানো হয়েছে।',
  ),
  'countries.all': o('All Countries', 'সব দেশ'),
  'countries.listLabel': o('Countries', 'দেশ'),
  'countries.start': o('Start', 'শুরু করুন'),
  'countries.startWith': o(' With {country}', ' {country} দিয়ে'),
  'countries.rules.lead': o('Rules,', 'নিয়ম,'),
  'countries.rules.end': o('Not Guesses.', 'আন্দাজ নয়।'),
  'countries.rules.body': held(
    'authority',
    'Each line shows where it came from and when it was last checked. Check the official page before you pay or travel.',
    'প্রতিটি লাইনে দেখানো হয় তথ্যটি কোথা থেকে এসেছে এবং শেষবার কবে দেখা হয়েছিল। টাকা দেওয়া বা ভ্রমণের আগে অফিসিয়াল পাতাটি দেখে নিন।',
  ),
  'countries.rules.chip': held(
    'example',
    'Source: official page. Checked on an Example date.',
    'উৎস: অফিসিয়াল পাতা। যাচাইয়ের তারিখ একটি উদাহরণ।',
  ),
  'countries.closing.lead': o('Pick a Country.', 'একটি দেশ বেছে নিন।'),
  'countries.closing.end': o('See the Gap.', 'ঘাটতি দেখুন।'),
  'countries.closing.sub': o(
    'Add one document and see what the trip still needs.',
    'একটি ডকুমেন্ট যোগ করুন, দেখুন ভ্রমণের জন্য আর কী লাগবে।',
  ),
  'countries.more': o('Show More', 'আরও দেখান'),
  'countries.moreNote': o(' countries', ' দেশ'),
  'countries.count.all': o('Showing all {total} countries.', 'মোট {total}টি দেশ দেখানো হচ্ছে।'),
  'countries.count.only': o('Showing the only country.', 'একটি মাত্র দেশ দেখানো হচ্ছে।'),
  'countries.count.of': o(
    'Showing {shown} of {total} countries.',
    'মোট {total}টি দেশের মধ্যে {shown}টি দেখানো হচ্ছে।',
  ),

  // Search (catalogue keys: components and countries-public)
  'countries.search.label': o(
    'Search Countries',
    'দেশ খুঁজুন',
    'components.countryBrowser.searchCountries',
  ),
  'countries.search.matching': o(
    'Matching Countries',
    'মিলে যাওয়া দেশ',
    'countriesPublic.search.matchingCountries',
  ),
  'countries.search.found': o(
    '{count, plural, one {# country found.} other {# countries found.}}',
    '{count, plural, one {#টি দেশ পাওয়া গেছে।} other {#টি দেশ পাওয়া গেছে।}}',
    'countriesPublic.search.found',
  ),
  'countries.search.foundFirst': o(
    '{count} countries found. Showing the first {limit}. Keep typing to narrow it.',
    '{count}টি দেশ পাওয়া গেছে। প্রথম {limit}টি দেখানো হচ্ছে। আরও কমাতে লিখতে থাকুন।',
    'countriesPublic.search.foundFirst',
  ),
  'countries.search.typeMore': o(
    'Type at least two letters.',
    'কমপক্ষে দুটি অক্ষর লিখুন।',
    'countriesPublic.search.typeMore',
  ),
  'countries.search.typeACountry': o(
    'Type a country name.',
    'একটি দেশের নাম লিখুন।',
    'countriesPublic.search.typeACountry',
  ),
  'countries.motion.pause': o('Pause Motion', 'গতি থামান', 'countriesPublic.motion.pause'),
  'countries.motion.play': o('Play Motion', 'গতি চালু করুন', 'countriesPublic.motion.play'),

  // Official rule wording: held (owner decision, 12 Nov 2026)
  'countries.entry.eVisa': held('authority', 'E-Visa', 'ই-ভিসা'),
  'countries.entry.noVisa': held('authority', 'No Visa Needed', 'ভিসা লাগবে না'),
  'countries.entry.visa': held('authority', 'Visa Needed', 'ভিসা লাগবে'),
  'countries.note.check': held(
    'authority',
    'Needs checking before you rely on it.',
    'নির্ভর করার আগে এটি দেখে নেওয়া দরকার।',
  ),
  'countries.note.unofficial': held(
    'authority',
    'Not from an official page.',
    'অফিসিয়াল পাতা থেকে নেওয়া নয়।',
  ),
  'countries.note.notResearched': held('authority', 'Not Researched Yet', 'এখনও গবেষণা করা হয়নি'),
  'countries.note.noSource': held('authority', 'No Source Given', 'কোনো উৎস দেওয়া নেই'),
  'countries.note.noDate': held('authority', 'Date Not Recorded', 'তারিখ লেখা নেই'),
} as const;
