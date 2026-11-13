import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-outputs surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantOutputsCatalog = defineCatalog({
  en: {
    'applicantOutputs.appApplicantIdOutputsPage.aShortMessageYouCanSend':
      'A short message you can send yourself. It holds no document, number or name, only a link to sign in to VisaStack. VisaStack never sends it for you.',
    'applicantOutputs.appApplicantIdOutputsPage.aSummaryIsAOneTime':
      'A summary is a one-time copy. It does not update when your record changes, and VisaStack cannot take it back once you have shared it. Sharing it with an agency or an AI app is your choice each time.',
    'applicantOutputs.appApplicantIdOutputsPage.addsTheWordsReadFromYour':
      'Adds the words read from your documents in the groups you tick. Passports, ID, money and health documents are never included. Choose this only if the AI app needs the words themselves.',
    'applicantOutputs.appApplicantIdOutputsPage.case': 'Case',
    'applicantOutputs.appApplicantIdOutputsPage.chooseACaseAboveThenPress':
      'Choose a case above, then press Preview.',
    'applicantOutputs.appApplicantIdOutputsPage.chooseASummary': 'Choose a Summary',
    'applicantOutputs.appApplicantIdOutputsPage.chooseDetails': 'Choose Details',
    'applicantOutputs.appApplicantIdOutputsPage.chooseWhatGoesInCheckThe':
      'Choose what goes in, check the preview, then copy, print or download one summary. Everything you do not select stays out.',
    'applicantOutputs.appApplicantIdOutputsPage.chooseWhatToInclude': 'Choose What to Include',
    'applicantOutputs.appApplicantIdOutputsPage.copyAll': 'Copy All',
    'applicantOutputs.appApplicantIdOutputsPage.copyText': 'Copy Text',
    'applicantOutputs.appApplicantIdOutputsPage.descriptionSensitiveIncludeItOnlyIf':
      '{description} Sensitive: include it only if the reader needs it.',
    'applicantOutputs.appApplicantIdOutputsPage.detailsToInclude': 'Details to Include',
    'applicantOutputs.appApplicantIdOutputsPage.documents': 'Documents',
    'applicantOutputs.appApplicantIdOutputsPage.documentsTheListOnlyNoDocument':
      'Documents: the list only. No document file is included.',
    'applicantOutputs.appApplicantIdOutputsPage.downloadSpreadsheetFile':
      'Download Spreadsheet File',
    'applicantOutputs.appApplicantIdOutputsPage.downloadTextFile': 'Download Text File',
    'applicantOutputs.appApplicantIdOutputsPage.fullDocumentNumbersAreIncludedShare':
      'Full document numbers are included. Share this copy only with someone who needs them.',
    'applicantOutputs.appApplicantIdOutputsPage.howMuchDetail': 'How Much Detail',
    'applicantOutputs.appApplicantIdOutputsPage.includeTheListOfMyDocuments':
      'Include the List of My Documents',
    'applicantOutputs.appApplicantIdOutputsPage.kindDatesAndStatusOnlyNo':
      'Kind, dates and status only. No file is ever included.',
    'applicantOutputs.appApplicantIdOutputsPage.kindsOfSummary': 'Kinds of Summary',
    'applicantOutputs.appApplicantIdOutputsPage.noCase': 'No Case',
    'applicantOutputs.appApplicantIdOutputsPage.noCaseYet': 'No Case Yet',
    'applicantOutputs.appApplicantIdOutputsPage.nothingToShow': 'Nothing to show.',
    'applicantOutputs.appApplicantIdOutputsPage.numbers': 'Numbers',
    'applicantOutputs.appApplicantIdOutputsPage.partsOfYourRecord': 'Parts of Your Record',
    'applicantOutputs.appApplicantIdOutputsPage.passportAndIdNumbersShowOnly':
      'Passport and ID numbers show only their last three characters unless you tick this. You will be asked to confirm it is you.',
    'applicantOutputs.appApplicantIdOutputsPage.preparedOnLongdayThisIsExactly':
      'Prepared on {longDay}. This is exactly what the copy or file will hold.',
    'applicantOutputs.appApplicantIdOutputsPage.preview': 'Preview',
    'applicantOutputs.appApplicantIdOutputsPage.previewLabel': 'Preview: {label}',
    'applicantOutputs.appApplicantIdOutputsPage.previewYourSummary': 'Preview Your Summary',
    'applicantOutputs.appApplicantIdOutputsPage.selected': 'Selected',
    'applicantOutputs.appApplicantIdOutputsPage.showFullDocumentNumbers':
      'Show Full Document Numbers',
    'applicantOutputs.appApplicantIdOutputsPage.showingFullNumbersNeedsAnExtra':
      'Showing full numbers needs an extra sign-in check, which is not available here right now. Turn that choice off to continue.',
    'applicantOutputs.appApplicantIdOutputsPage.startAgain': 'Start Again',
    'applicantOutputs.appApplicantIdOutputsPage.stepNumberOf3': 'Step {number} of 3:',
    'applicantOutputs.appApplicantIdOutputsPage.steps': 'Steps',
    'applicantOutputs.appApplicantIdOutputsPage.stillUnknownOrNeedsALook':
      'Still Unknown or Needs a Look',
    'applicantOutputs.appApplicantIdOutputsPage.summaries': 'Summaries',
    'applicantOutputs.appApplicantIdOutputsPage.summaryLabel': 'Summary: {label}',
    'applicantOutputs.appApplicantIdOutputsPage.tellThemOnWhatsapp': 'Tell Them on WhatsApp',
    'applicantOutputs.appApplicantIdOutputsPage.textReadFromMyDocuments':
      'Text Read from My Documents',
    'applicantOutputs.appApplicantIdOutputsPage.theExactTextAnAiApp':
      'The exact text an AI app would receive',
    'applicantOutputs.appApplicantIdOutputsPage.theFileIsMadeAgainWhen':
      'The file is made again when you download it. If your record changed since this preview, nothing is downloaded and you will be asked to preview again.',
    'applicantOutputs.appApplicantIdOutputsPage.theWhatsappMessage': 'The WhatsApp message',
    'applicantOutputs.appApplicantIdOutputsPage.thereIsNothingToDownloadFor':
      'There is nothing to download for these choices. Choose something to include first.',
    'applicantOutputs.appApplicantIdOutputsPage.theseAreTheConfirmedDetailsIn':
      'These are the confirmed details in the parts you chose. Untick any you do not want in the sheet.',
    'applicantOutputs.appApplicantIdOutputsPage.thisIsTheExactTextAn':
      'This is the exact text an AI app would receive. It has no files and no links, and the app is told it is a snapshot.',
    'applicantOutputs.appApplicantIdOutputsPage.visastack': 'VisaStack',
    'applicantOutputs.appApplicantIdOutputsPage.weCouldNotMakeTheFile':
      'We could not make the file just now. Try again.',
    'applicantOutputs.appApplicantIdOutputsPage.weCouldNotPrepareThisSummary':
      'We could not prepare this summary just now. Refresh to try again.',
    'applicantOutputs.appApplicantIdOutputsPage.whatYouWantHelpWithOptional':
      'What You Want Help with (Optional)',
    'applicantOutputs.appApplicantIdOutputsPage.yourChoices': 'Your Choices',
    'applicantOutputs.appApplicantIdOutputsPage.yourRecordOrYourChoicesChanged':
      'Your record or your choices changed after you previewed this, so nothing was downloaded. Check the new preview below, then download again.',
  },
  bn: {
    'applicantOutputs.appApplicantIdOutputsPage.aShortMessageYouCanSend':
      'নিজেকে পাঠানোর মতো একটি ছোট বার্তা। এতে কোনো ডকুমেন্ট, নম্বর বা নাম থাকে না, শুধু VisaStack-এ সাইন ইন করার একটি লিংক থাকে। VisaStack এটি আপনার হয়ে কখনো পাঠায় না।',
    'applicantOutputs.appApplicantIdOutputsPage.aSummaryIsAOneTime':
      'সারসংক্ষেপ হলো একবারের কপি। আপনার রেকর্ড বদলালে এটি আপডেট হয় না, আর একবার শেয়ার করার পর VisaStack এটি ফিরিয়ে নিতে পারে না। কোনো এজেন্সি বা এআই অ্যাপের সঙ্গে এটি শেয়ার করা প্রতিবারই আপনার সিদ্ধান্ত।',
    'applicantOutputs.appApplicantIdOutputsPage.addsTheWordsReadFromYour':
      'আপনি যেসব গ্রুপে টিক দেন, সেগুলোর ডকুমেন্ট থেকে পড়া লেখা যোগ করে। পাসপোর্ট, পরিচয়পত্র, টাকাপয়সা ও স্বাস্থ্যের ডকুমেন্ট কখনো যুক্ত করা হয় না। এআই অ্যাপের যদি লেখাগুলোই দরকার হয়, শুধু তখনই এটি বেছে নিন।',
    'applicantOutputs.appApplicantIdOutputsPage.case': 'ভিসা ফাইল',
    'applicantOutputs.appApplicantIdOutputsPage.chooseACaseAboveThenPress':
      'উপরে একটি ভিসা ফাইল বেছে নিন, তারপর প্রিভিউ চাপুন।',
    'applicantOutputs.appApplicantIdOutputsPage.chooseASummary': 'একটি সারসংক্ষেপ বেছে নিন',
    'applicantOutputs.appApplicantIdOutputsPage.chooseDetails': 'তথ্য বেছে নিন',
    'applicantOutputs.appApplicantIdOutputsPage.chooseWhatGoesInCheckThe':
      'কী কী থাকবে তা বেছে নিন, প্রিভিউ দেখে নিন, তারপর একটি সারসংক্ষেপ কপি, প্রিন্ট বা ডাউনলোড করুন। যা বেছে নেবেন না তা বাদ থাকবে।',
    'applicantOutputs.appApplicantIdOutputsPage.chooseWhatToInclude': 'কী কী যোগ করবেন তা বেছে নিন',
    'applicantOutputs.appApplicantIdOutputsPage.copyAll': 'সব কপি করুন',
    'applicantOutputs.appApplicantIdOutputsPage.copyText': 'লেখা কপি করুন',
    'applicantOutputs.appApplicantIdOutputsPage.detailsToInclude': 'যে তথ্য রাখবেন',
    'applicantOutputs.appApplicantIdOutputsPage.documents': 'ডকুমেন্টস',
    'applicantOutputs.appApplicantIdOutputsPage.documentsTheListOnlyNoDocument':
      'ডকুমেন্ট: শুধু তালিকা। কোনো আপলোড করা ডকুমেন্ট যুক্ত নেই।',
    'applicantOutputs.appApplicantIdOutputsPage.downloadSpreadsheetFile': 'স্প্রেডশিট ডাউনলোড করুন',
    'applicantOutputs.appApplicantIdOutputsPage.downloadTextFile': 'টেক্সট ডকুমেন্ট ডাউনলোড করুন',
    'applicantOutputs.appApplicantIdOutputsPage.fullDocumentNumbersAreIncludedShare':
      'পূর্ণ ডকুমেন্ট নম্বর এতে আছে। যার এগুলো দরকার শুধু তার সঙ্গেই এই কপি শেয়ার করুন।',
    'applicantOutputs.appApplicantIdOutputsPage.howMuchDetail': 'কতটা বিস্তারিত',
    'applicantOutputs.appApplicantIdOutputsPage.includeTheListOfMyDocuments':
      'আমার ডকুমেন্টের তালিকা যুক্ত করুন',
    'applicantOutputs.appApplicantIdOutputsPage.kindDatesAndStatusOnlyNo':
      'শুধু ধরন, তারিখ ও অবস্থা। কোনো ডকুমেন্ট কখনোই যুক্ত করা হয় না।',
    'applicantOutputs.appApplicantIdOutputsPage.kindsOfSummary': 'সারসংক্ষেপের ধরন',
    'applicantOutputs.appApplicantIdOutputsPage.noCase': 'ভিসা ফাইল নেই',
    'applicantOutputs.appApplicantIdOutputsPage.noCaseYet': 'এখনো কোনো ভিসা ফাইল নেই',
    'applicantOutputs.appApplicantIdOutputsPage.numbers': 'নম্বর',
    'applicantOutputs.appApplicantIdOutputsPage.partsOfYourRecord': 'আপনার রেকর্ডের অংশ',
    'applicantOutputs.appApplicantIdOutputsPage.passportAndIdNumbersShowOnly':
      'টিক না দিলে পাসপোর্ট ও আইডি নম্বরের শুধু শেষ তিনটি অক্ষর দেখানো হয়। এটি যে আপনিই, তা নিশ্চিত করতে বলা হবে।',
    'applicantOutputs.appApplicantIdOutputsPage.preview': 'প্রিভিউ',
    'applicantOutputs.appApplicantIdOutputsPage.previewYourSummary': 'আপনার সারসংক্ষেপের প্রিভিউ দেখুন',
    'applicantOutputs.appApplicantIdOutputsPage.selected': 'নির্বাচিত',
    'applicantOutputs.appApplicantIdOutputsPage.showFullDocumentNumbers': 'পূর্ণ ডকুমেন্ট নম্বর দেখান',
    'applicantOutputs.appApplicantIdOutputsPage.showingFullNumbersNeedsAnExtra':
      'পুরো নম্বর দেখাতে সাইন ইনের একটি বাড়তি পরীক্ষা লাগে, যা এখানে এখন পাওয়া যাচ্ছে না। চালিয়ে যেতে ওই বিকল্পটি বন্ধ করুন।',
    'applicantOutputs.appApplicantIdOutputsPage.startAgain': 'আবার শুরু করুন',
    'applicantOutputs.appApplicantIdOutputsPage.steps': 'ধাপ',
    'applicantOutputs.appApplicantIdOutputsPage.stillUnknownOrNeedsALook': 'এখনও জানা নেই বা দেখা দরকার',
    'applicantOutputs.appApplicantIdOutputsPage.summaries': 'সারসংক্ষেপ',
    'applicantOutputs.appApplicantIdOutputsPage.tellThemOnWhatsapp': 'WhatsApp-এ তাদের জানান',
    'applicantOutputs.appApplicantIdOutputsPage.textReadFromMyDocuments': 'আমার ডকুমেন্ট থেকে পড়া লেখা',
    'applicantOutputs.appApplicantIdOutputsPage.theExactTextAnAiApp': 'একটি এআই অ্যাপ হুবহু যে লেখা পাবে',
    'applicantOutputs.appApplicantIdOutputsPage.theFileIsMadeAgainWhen':
      'ডাউনলোডের সময় ডকুমেন্টটি আবার তৈরি করা হয়। এই প্রিভিউয়ের পর আপনার রেকর্ড বদলে গেলে কিছুই ডাউনলোড হবে না, এবং আপনাকে আবার প্রিভিউ দেখতে বলা হবে।',
    'applicantOutputs.appApplicantIdOutputsPage.theWhatsappMessage': 'WhatsApp বার্তা',
    'applicantOutputs.appApplicantIdOutputsPage.thereIsNothingToDownloadFor':
      'এই বিকল্পগুলোর জন্য ডাউনলোড করার মতো কিছু নেই। আগে অন্তর্ভুক্ত করার মতো কিছু বেছে নিন।',
    'applicantOutputs.appApplicantIdOutputsPage.theseAreTheConfirmedDetailsIn':
      'বেছে নেওয়া অংশগুলোর নিশ্চিত করা তথ্য এখানে আছে। শিটে যেগুলো চান না, সেগুলোর টিক তুলে দিন।',
    'applicantOutputs.appApplicantIdOutputsPage.thisIsTheExactTextAn':
      'এটি হুবহু সেই লেখা, যা একটি এআই অ্যাপ পাবে। এতে কোনো ডকুমেন্ট বা লিংক নেই, আর অ্যাপকে জানানো হয় যে এটি একটি স্ন্যাপশট।',
    'applicantOutputs.appApplicantIdOutputsPage.visastack': 'VisaStack',
    'applicantOutputs.appApplicantIdOutputsPage.weCouldNotMakeTheFile':
      'এই মুহূর্তে আমরা ডাউনলোডটি তৈরি করতে পারিনি। আবার চেষ্টা করুন।',
    'applicantOutputs.appApplicantIdOutputsPage.weCouldNotPrepareThisSummary':
      'এইমাত্র এই সারাংশ প্রস্তুত করা যায়নি। আবার চেষ্টা করতে রিফ্রেশ করুন।',
    'applicantOutputs.appApplicantIdOutputsPage.whatYouWantHelpWithOptional':
      'যে বিষয়ে সাহায্য চান (ঐচ্ছিক)',
    'applicantOutputs.appApplicantIdOutputsPage.yourChoices': 'আপনার পছন্দ',
    'applicantOutputs.appApplicantIdOutputsPage.yourRecordOrYourChoicesChanged':
      'আপনি প্রিভিউ দেখার পরে আপনার রেকর্ড বা বাছাই বদলে গেছে, তাই কিছুই ডাউনলোড হয়নি। নিচের নতুন প্রিভিউ দেখে নিন, তারপর আবার ডাউনলোড করুন।',
  },
});
