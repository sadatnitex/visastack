import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-evidence surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantEvidenceCatalog = defineCatalog({
  en: {
    'applicantEvidence.appApplicantIdEvidenceAnswerReceipt.answerSent': 'Answer Sent',
    'applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.everyoneWhoCanReadTheShared':
      'Everyone who can read the shared notes on this case will see your question. Do not type passport, bank or card numbers. Up to {maxLength} characters.',
    'applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.yourQuestion': 'Your Question',
    'applicantEvidence.appApplicantIdEvidenceClearerCopyPanel.uploadAClearerCopy':
      'Upload a Clearer Copy',
    'applicantEvidence.appApplicantIdEvidencePage.1RequestIsWaitingForYou':
      '1 request is waiting for you.',
    'applicantEvidence.appApplicantIdEvidencePage.aboutRequests': 'About Requests',
    'applicantEvidence.appApplicantIdEvidencePage.anAgencyIsAskingYouFor':
      'An agency is asking you for this. It is not a government rule.',
    'applicantEvidence.appApplicantIdEvidencePage.anAgencyRequestIsThatOrganisation':
      'An agency request is that organisation asking you for something, never an official visa requirement on its own. You decide what to submit, and can reuse anything already in your wallet.',
    'applicantEvidence.appApplicantIdEvidencePage.awaitingcountRequestsAreWaitingForYou':
      '{awaitingCount} requests are waiting for you.',
    'applicantEvidence.appApplicantIdEvidencePage.noEvidenceRequests': 'No Evidence Requests',
    'applicantEvidence.appApplicantIdEvidencePage.nothingIsWaitingForYou':
      'Nothing is waiting for you.',
    'applicantEvidence.appApplicantIdEvidencePage.requestsFromAgencies': 'Requests from Agencies',
    'applicantEvidence.appApplicantIdEvidencePage.thisIsWhereAnAgencyAsks':
      'This is where an agency asks you for a document or a detail. A request appears here with what is needed, why, and the date it is needed by. Keeping your documents up to date makes replying quick.',
    'applicantEvidence.appApplicantIdEvidencePage.yourRequestsCouldNotBeLoaded':
      'Your requests could not be loaded. Refresh to try again.',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.addDocuments': 'Add Documents',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.askTheAgencyAboutThisItem':
      'Ask the Agency About This Item',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.askedFormatmoment':
      'Asked {formatMoment}',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.neededByFormatdateonly':
      'Needed by {formatDateOnly}',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.readRepliesInTheCaseNotes':
      'Read Replies in the Case Notes',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.requestReference': 'Request Reference',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.youHaveAskedSeveralQuestionsAbout':
      'You have asked several questions about this item. The agency answers in the case notes.',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.youSentThisOnFormatmoment':
      'You sent this on {formatMoment}.',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.yourQuestions': 'Your Questions',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.aboutSending': 'About Sending',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.chooseTheCopyToSend':
      'Choose the Copy to Send',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.chooseTheDetailToSend':
      'Choose the Detail to Send',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.kindlabelAddedAddedlabelScanlabel':
      '{kindLabel} · Added {addedLabel} · {scanLabel}',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.newest': 'Newest',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.noCopyOfThisDocumentType':
      'No copy of this document type can be sent right now. Add it in Documents, then come back to send it.',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.openDocuments': 'Open Documents',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.sentBackByTheAgency':
      'Sent Back by the Agency',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.yourDocumentsCouldNotBeLoaded':
      'Your documents could not be loaded. Refresh to try again.',
  },
  bn: {
    'applicantEvidence.appApplicantIdEvidenceAnswerReceipt.answerSent': 'উত্তর পাঠানো হয়েছে',
    'applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.yourQuestion': 'আপনার প্রশ্ন',
    'applicantEvidence.appApplicantIdEvidencePage.aboutRequests': 'অনুরোধ সম্পর্কে',
    'applicantEvidence.appApplicantIdEvidencePage.anAgencyIsAskingYouFor':
      'একটি এজেন্সি আপনার কাছে এটি চাইছে। এটি সরকারি নিয়ম নয়।',
    'applicantEvidence.appApplicantIdEvidencePage.nothingIsWaitingForYou':
      'আপনার জন্য কিছু অপেক্ষায় নেই।',
    'applicantEvidence.appApplicantIdEvidencePage.requestsFromAgencies': 'এজেন্সির অনুরোধ',
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.requestReference': 'অনুরোধের রেফারেন্স',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.aboutSending': 'পাঠানো সম্পর্কে',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.chooseTheCopyToSend':
      'পাঠানোর জন্য কপি বেছে নিন',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.chooseTheDetailToSend':
      'পাঠানোর জন্য তথ্য বেছে নিন',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.newest': 'সবচেয়ে নতুন',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.noCopyOfThisDocumentType':
      'এই ধরনের ডকুমেন্টের কোনো কপি এখন পাঠানো যাচ্ছে না। ডকুমেন্ট পৃষ্ঠায় এটি যোগ করুন, তারপর ফিরে এসে পাঠান।',
    'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.sentBackByTheAgency':
      'এজেন্সি ফেরত পাঠিয়েছে',
  },
});
