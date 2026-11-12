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
    'applicantOutputs.appApplicantIdOutputsPage.chooseASummary': 'একটি সারসংক্ষেপ বেছে নিন',
    'applicantOutputs.appApplicantIdOutputsPage.chooseWhatToInclude': 'কী কী যোগ করবেন তা বেছে নিন',
    'applicantOutputs.appApplicantIdOutputsPage.copyAll': 'সব কপি করুন',
    'applicantOutputs.appApplicantIdOutputsPage.documents': 'ডকুমেন্টস',
    'applicantOutputs.appApplicantIdOutputsPage.downloadTextFile': 'টেক্সট ডকুমেন্ট ডাউনলোড করুন',
    'applicantOutputs.appApplicantIdOutputsPage.howMuchDetail': 'কতটা বিস্তারিত',
    'applicantOutputs.appApplicantIdOutputsPage.includeTheListOfMyDocuments':
      'আমার ডকুমেন্টের তালিকা যুক্ত করুন',
    'applicantOutputs.appApplicantIdOutputsPage.kindsOfSummary': 'সারসংক্ষেপের ধরন',
    'applicantOutputs.appApplicantIdOutputsPage.numbers': 'নম্বর',
    'applicantOutputs.appApplicantIdOutputsPage.partsOfYourRecord': 'আপনার রেকর্ডের অংশ',
    'applicantOutputs.appApplicantIdOutputsPage.preview': 'প্রিভিউ',
    'applicantOutputs.appApplicantIdOutputsPage.previewYourSummary': 'আপনার সারসংক্ষেপের প্রিভিউ দেখুন',
    'applicantOutputs.appApplicantIdOutputsPage.selected': 'নির্বাচিত',
    'applicantOutputs.appApplicantIdOutputsPage.showFullDocumentNumbers': 'পূর্ণ ডকুমেন্ট নম্বর দেখান',
    'applicantOutputs.appApplicantIdOutputsPage.steps': 'ধাপ',
    'applicantOutputs.appApplicantIdOutputsPage.stillUnknownOrNeedsALook': 'এখনও জানা নেই বা দেখা দরকার',
    'applicantOutputs.appApplicantIdOutputsPage.summaries': 'সারসংক্ষেপ',
    'applicantOutputs.appApplicantIdOutputsPage.tellThemOnWhatsapp': 'WhatsApp-এ তাদের জানান',
    'applicantOutputs.appApplicantIdOutputsPage.theWhatsappMessage': 'WhatsApp বার্তা',
    'applicantOutputs.appApplicantIdOutputsPage.visastack': 'VisaStack',
    'applicantOutputs.appApplicantIdOutputsPage.whatYouWantHelpWithOptional':
      'যে বিষয়ে সাহায্য চান (ঐচ্ছিক)',
    'applicantOutputs.appApplicantIdOutputsPage.yourChoices': 'আপনার পছন্দ',
  },
});
