import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-contributor-requests surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appContributorRequestsCatalog = defineCatalog({
  en: {
    'appContributorRequests.appContributorRequestsAcceptPage.applicantnameTheTraveller':
      '{applicantName} (the traveller)',
    'appContributorRequests.appContributorRequestsAcceptPage.contributorRequest':
      'Contributor Request',
    'appContributorRequests.appContributorRequestsAcceptPage.howLongItSKept': "How long it's kept:",
    'appContributorRequests.appContributorRequestsAcceptPage.message': 'Message:',
    'appContributorRequests.appContributorRequestsAcceptPage.nameHelpingWithThisCase':
      '{name} (helping with this case)',
    'appContributorRequests.appContributorRequestsAcceptPage.provideOneDocument':
      'Provide One Document',
    'appContributorRequests.appContributorRequestsAcceptPage.retentiondaysDaysFromUploadUnderThis':
      "{retentionDays} days from upload, under this platform's standard retention policy.",
    'appContributorRequests.appContributorRequestsAcceptPage.thisDocumentMayBeIncludedIn':
      'This document may be included in the case file the traveller reviews and submits for their case. Do not upload anything you would not want the traveller and anyone helping with their case to eventually see.',
    'appContributorRequests.appContributorRequestsAcceptPage.thisDocumentTypeDoesnTHave':
      "This document type doesn't have a specific retention period configured yet.",
    'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsMissingItsToken':
      'This link is missing its token.',
    'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsNotValid':
      'This link is not valid.',
    'appContributorRequests.appContributorRequestsAcceptPage.thisRequestWasSentToA':
      "This request was sent to a different email address than the one you're signed in with. Sign in with the email it was sent to before continuing.",
    'appContributorRequests.appContributorRequestsAcceptPage.whoWillSeeThis': 'Who will see this:',
    'appContributorRequests.appContributorRequestsAcceptPage.why': 'Why:',
    'appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.alsoAllowThisDocumentToBe':
      "Also allow this document to be reused for the traveller's future cases (optional - off by default, this file only helps with this one case)",
    'appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.pdfPngJpegDocxTxtOr':
      'PDF, PNG, JPEG, DOCX, TXT or MD · file type and structure are checked on upload.',
  },
  bn: {
    'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsMissingItsToken':
      'এই লিংকে টোকেন নেই।',
    'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsNotValid':
      'এই লিংকটি বৈধ নয়।',
  },
});
