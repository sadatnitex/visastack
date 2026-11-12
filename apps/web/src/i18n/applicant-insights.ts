import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-insights surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantInsightsCatalog = defineCatalog({
  en: {
    'applicantInsights.appApplicantIdInsightsPage.aSummaryOfYourSavedDocuments':
      'A summary of your saved documents and profile. It never shows the details themselves, and nothing here changes your profile.',
    'applicantInsights.appApplicantIdInsightsPage.addADocumentAndAcceptWhat':
      'Add a document and accept what was found in it, and this shows which details it backs.',
    'applicantInsights.appApplicantIdInsightsPage.backed': 'Backed',
    'applicantInsights.appApplicantIdInsightsPage.backsNoSavedDetailsYet':
      'Backs no saved details yet.',
    'applicantInsights.appApplicantIdInsightsPage.backsPlural': 'Backs {plural}.',
    'applicantInsights.appApplicantIdInsightsPage.backsPluralInJoin': 'Backs {plural} in {join}.',
    'applicantInsights.appApplicantIdInsightsPage.backsPluralJoin': 'Backs {plural}: {join}.',
    'applicantInsights.appApplicantIdInsightsPage.canBackJoin': 'Can back: {join}.',
    'applicantInsights.appApplicantIdInsightsPage.cases': 'Cases',
    'applicantInsights.appApplicantIdInsightsPage.comingUp': 'Coming Up',
    'applicantInsights.appApplicantIdInsightsPage.coveredOfPluralHaveASupporting':
      '{covered, plural, =1 {{covered} of {plural} has a supporting document.} other {{covered} of {plural} have a supporting document.}}',
    'applicantInsights.appApplicantIdInsightsPage.detailsToCheck': 'Details to Check',
    'applicantInsights.appApplicantIdInsightsPage.differences': 'Differences',
    'applicantInsights.appApplicantIdInsightsPage.documentInsights': 'Document Insights',
    'applicantInsights.appApplicantIdInsightsPage.documentsBehindYourDetails':
      'Documents Behind Your Details',
    'applicantInsights.appApplicantIdInsightsPage.documentsWithAnEndDateSuch':
      'Documents with an end date, such as a passport, appear here in the order they run out.',
    'applicantInsights.appApplicantIdInsightsPage.eachVisaApplicationIsACase':
      'Each visa application is a case. Its readiness appears here once you start one.',
    'applicantInsights.appApplicantIdInsightsPage.embassiesUsuallyWantTheseHandedIn':
      'Embassies usually want these handed in as the original paper. The scan on file keeps your application ready; keep the original safe.',
    'applicantInsights.appApplicantIdInsightsPage.evidenceMap': 'Evidence Map',
    'applicantInsights.appApplicantIdInsightsPage.expiryTimeline': 'Expiry Timeline',
    'applicantInsights.appApplicantIdInsightsPage.noDocumentYet': 'No Document Yet',
    'applicantInsights.appApplicantIdInsightsPage.noDocumentsYet': 'No Documents Yet',
    'applicantInsights.appApplicantIdInsightsPage.noExpiryDatesYet': 'No Expiry Dates Yet',
    'applicantInsights.appApplicantIdInsightsPage.noOpenCases': 'No Open Cases',
    'applicantInsights.appApplicantIdInsightsPage.noOriginalsListedYet': 'No Originals Listed Yet',
    'applicantInsights.appApplicantIdInsightsPage.noSavedDetailDiffersFromWhat':
      'No saved detail differs from what was read in your documents.',
    'applicantInsights.appApplicantIdInsightsPage.noSectionsToBackYet': 'No Sections to Back Yet',
    'applicantInsights.appApplicantIdInsightsPage.nothingToCheck': 'Nothing to Check',
    'applicantInsights.appApplicantIdInsightsPage.onceACaseListsItsDocuments':
      'Once a case lists its documents, or you add one usually handed in as the original, it appears here.',
    'applicantInsights.appApplicantIdInsightsPage.openAProfileSectionThatA':
      'Open a profile section that a document can back, and it appears here.',
    'applicantInsights.appApplicantIdInsightsPage.openCases': 'Open Cases',
    'applicantInsights.appApplicantIdInsightsPage.openDatesExpiry': 'Open Dates & Expiry',
    'applicantInsights.appApplicantIdInsightsPage.openDocuments': 'Open Documents',
    'applicantInsights.appApplicantIdInsightsPage.openProfile': 'Open Profile',
    'applicantInsights.appApplicantIdInsightsPage.openTheCase': 'Open the Case',
    'applicantInsights.appApplicantIdInsightsPage.optionalForThisCase': 'Optional for this case',
    'applicantInsights.appApplicantIdInsightsPage.originalsToBring': 'Originals to Bring',
    'applicantInsights.appApplicantIdInsightsPage.paperCopies': 'Paper Copies',
    'applicantInsights.appApplicantIdInsightsPage.profileCoverage': 'Profile Coverage',
    'applicantInsights.appApplicantIdInsightsPage.protected': 'Protected',
    'applicantInsights.appApplicantIdInsightsPage.readinessByCase': 'Readiness by Case',
    'applicantInsights.appApplicantIdInsightsPage.sectionsBackedByADocument':
      'Sections Backed by a Document',
    'applicantInsights.appApplicantIdInsightsPage.showingCardRowsOfLengthDates':
      'Showing {CARD_ROWS} of {length} dates.',
    'applicantInsights.appApplicantIdInsightsPage.showingShownOfTotalNoun':
      'Showing {shown} of {total} {noun}.',
    'applicantInsights.appApplicantIdInsightsPage.summary': 'Summary',
    'applicantInsights.appApplicantIdInsightsPage.upload': 'Upload',
    'applicantInsights.appApplicantIdInsightsPage.usuallyOriginal': 'Usually Original',
    'applicantInsights.appApplicantIdInsightsPage.weCouldNotPutThisSummary':
      'We could not put this summary together just now. Refresh to try again. Nothing is reported as missing while it cannot load.',
    'applicantInsights.appApplicantIdInsightsPage.weOnlySayThatTwoDetails':
      'We only say that two details differ and where. Open each one to see both and decide.',
    'applicantInsights.appApplicantIdInsightsPage.whatYourDocumentsShow':
      'What Your Documents Show',
  },
  bn: {
    'applicantInsights.appApplicantIdInsightsPage.comingUp': 'সামনে আসছে',
    'applicantInsights.appApplicantIdInsightsPage.eachVisaApplicationIsACase':
      'প্রতিটি ভিসা আবেদন একটি ভিসা ফাইল। আপনি একটি শুরু করলে এর প্রস্তুতির অবস্থা এখানে দেখা যাবে।',
    'applicantInsights.appApplicantIdInsightsPage.noDocumentsYet': 'এখনো কোনো ডকুমেন্ট নেই',
    'applicantInsights.appApplicantIdInsightsPage.noExpiryDatesYet': 'এখনো কোনো মেয়াদের তারিখ নেই',
    'applicantInsights.appApplicantIdInsightsPage.openCases': 'খোলা ভিসা ফাইল',
    'applicantInsights.appApplicantIdInsightsPage.openProfile': 'প্রোফাইল খুলুন',
  },
});
