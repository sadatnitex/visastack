import { type CatalogKey, defineCatalog } from '@visastack/i18n';

/**
 * Messages for What This Change Affects: the review a traveller reads when a document is replaced
 * or a confirmed detail changes. The keys were written with the screen. English is the source
 * text; there is no Bengali yet, so a Bengali reader sees the English.
 *
 * Wording rules that every sentence here keeps (packages/services/src/change-impact/contract.ts):
 * - sharing is not viewing: a recipient "can open" a record, and nothing says they opened it;
 * - a send pins one exact copy or value: the newer one "was not sent";
 * - a product rule is not a visa requirement, and no sentence promises an agency's decision;
 * - every sentence is whole (never joined from pieces), and a sentence with a date has a twin
 *   without one for a send whose date was never recorded.
 */
export const changeImpactCatalog = defineCatalog({
  en: {
    'changeImpact.about.agencyNotActive': 'No Longer Active',
    'changeImpact.about.area': 'Could Not Check',
    'changeImpact.about.areaCases': 'Your Cases',
    'changeImpact.about.areaMissing': 'Could Not Find',
    'changeImpact.about.areaRequests': 'Requests from Agencies',
    'changeImpact.about.areaSentCopies': 'Copies Sent to Agencies',
    'changeImpact.about.areaSharing': 'Your Sharing',
    'changeImpact.about.case': 'Case',
    'changeImpact.about.finishedCase': 'Finished Case',
    'changeImpact.about.forCase': 'For the case {case}',
    'changeImpact.about.request': 'Agency',
    'changeImpact.about.share': 'Shared With',
    'changeImpact.notice.action':
      '{count, plural, one {# item needs your action.} other {# items need your action.}}',
    'changeImpact.notice.link': 'See the Full List',
    'changeImpact.notice.more':
      '{count, plural, one {and # more detail may also affect something.} other {and # more details may also affect something.}}',
    'changeImpact.notice.moreAlone':
      '{count, plural, one {# detail was not checked here. Open it to see what it affects.} other {# details were not checked here. Open each one to see what they affect.}}',
    'changeImpact.notice.review':
      '{count, plural, one {# item is worth a look.} other {# items are worth a look.}}',
    'changeImpact.notice.title': 'What This Change Affects',
    'changeImpact.notice.unavailable':
      'We could not work out what this change affects. Open Documents or your cases to check.',
    'changeImpact.notice.unknown':
      '{count, plural, one {We cannot tell about # item.} other {We cannot tell about # items.}}',
    'changeImpact.page.backToDocuments': 'Documents',
    'changeImpact.page.backToProfile': 'Profile',
    'changeImpact.reason.agencyAcceptedFinished.detail':
      '{agency} accepted the earlier answer on {date}. That record stays exactly as it was.',
    'changeImpact.reason.agencyAcceptedFinished.detailNoDate':
      '{agency} accepted the earlier answer. That record stays exactly as it was.',
    'changeImpact.reason.agencyAcceptedFinished.document':
      '{agency} accepted the earlier copy on {date}. That record stays exactly as it was.',
    'changeImpact.reason.agencyAcceptedFinished.documentNoDate':
      '{agency} accepted the earlier copy. That record stays exactly as it was.',
    'changeImpact.reason.agencyAcceptedFinished.documentPreview':
      '{agency} accepted the copy you sent on {date}. That record stays exactly as it is.',
    'changeImpact.reason.agencyAcceptedFinished.documentPreviewNoDate':
      '{agency} accepted the copy you sent. That record stays exactly as it is.',
    'changeImpact.reason.agencyAcceptedLive.detail':
      '{agency} accepted the earlier answer you sent on {date}, and their work with you is still in progress. The accepted answer stays exactly as sent. The new value was not sent to them.',
    'changeImpact.reason.agencyAcceptedLive.detailNoDate':
      '{agency} accepted the earlier answer you sent, and their work with you is still in progress. The accepted answer stays exactly as sent. The new value was not sent to them.',
    'changeImpact.reason.agencyAcceptedLive.document':
      '{agency} accepted the earlier copy you sent on {date}, and their work with you is still in progress. The accepted copy stays exactly as sent. The newer one was not sent to them.',
    'changeImpact.reason.agencyAcceptedLive.documentNoDate':
      '{agency} accepted the earlier copy you sent, and their work with you is still in progress. The accepted copy stays exactly as sent. The newer one was not sent to them.',
    'changeImpact.reason.agencyAcceptedLive.documentPreview':
      '{agency} accepted the copy you sent on {date}, and their work with you is still in progress. The accepted copy stays exactly as sent. Replacing this document does not send them the newer one.',
    'changeImpact.reason.agencyAcceptedLive.documentPreviewNoDate':
      '{agency} accepted the copy you sent, and their work with you is still in progress. The accepted copy stays exactly as sent. Replacing this document does not send them the newer one.',
    'changeImpact.reason.agencyChecking.detail':
      '{agency} is still checking the earlier answer you sent on {date}. The new value was not sent.',
    'changeImpact.reason.agencyChecking.detailNoDate':
      '{agency} is still checking the earlier answer you sent. The new value was not sent.',
    'changeImpact.reason.agencyChecking.document':
      '{agency} is still checking the earlier copy you sent on {date}. The newer one was not sent.',
    'changeImpact.reason.agencyChecking.documentNoDate':
      '{agency} is still checking the earlier copy you sent. The newer one was not sent.',
    'changeImpact.reason.agencyChecking.documentPreview':
      '{agency} is still checking the copy you sent on {date}. Replacing this document does not send them the newer one.',
    'changeImpact.reason.agencyChecking.documentPreviewNoDate':
      '{agency} is still checking the copy you sent. Replacing this document does not send them the newer one.',
    'changeImpact.reason.agencyHoldsCurrent.detail': 'You already sent {agency} the current value.',
    'changeImpact.reason.agencyHoldsCurrent.detailNoAgency':
      'You already sent an agency the current value.',
    'changeImpact.reason.agencyHoldsCurrent.document':
      'You already sent {agency} the current copy.',
    'changeImpact.reason.agencyHoldsCurrent.documentNoAgency':
      'You already sent an agency the current copy.',
    'changeImpact.reason.agencyHoldsCurrent.documentPreview':
      'You already sent {agency} the newer copy.',
    'changeImpact.reason.agencyHoldsCurrent.documentPreviewNoAgency':
      'You already sent an agency the newer copy.',
    'changeImpact.reason.agencyNotNamed':
      'This change relates to something you sent to an agency that is no longer active here. This change sends them nothing.',
    'changeImpact.reason.agencyWaiting.dated':
      '{agency} sent back what you sent on {date} and is waiting for your answer. Nothing is sent until you answer it.',
    'changeImpact.reason.agencyWaiting.noDate':
      '{agency} sent back what you sent and is waiting for your answer. Nothing is sent until you answer it.',
    'changeImpact.reason.caseConfirmationVoid':
      'You confirmed {case} with the earlier value. That confirmation no longer counts. Open the case and confirm it again.',
    'changeImpact.reason.caseFollowsCurrent.detail':
      '{case} uses your current details, so it already has the new value.',
    'changeImpact.reason.caseFollowsCurrent.document':
      '{case} follows your current records and has nothing to confirm again.',
    'changeImpact.reason.caseKeepsEarlier.detail':
      '{case} is set to use the earlier value you chose. It stays that way unless you change it in the case.',
    'changeImpact.reason.caseKeepsEarlier.document':
      '{case} is set to use the earlier copy you chose. It stays that way unless you change it in the case.',
    'changeImpact.reason.caseKeepsEarlier.documentPreview':
      '{case} is set to use the copy of this document that you chose. It stays that way unless you change it in the case.',
    'changeImpact.reason.caseUsesReplaced.preview':
      '{case} uses this document. After you replace it, the case will ask you to choose the document it should use and to confirm it again.',
    'changeImpact.reason.caseUsesReplaced.recorded':
      '{case} still uses the earlier document. Open the case, choose the document it should use, then confirm the case again.',
    'changeImpact.reason.checklistAnswer.detail':
      "Your answer to {agency}'s checklist on {date} holds the earlier value. The new value was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.detailNoAgency':
      "Your answer to an agency's checklist on {date} holds the earlier value. The new value was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.detailNoAgencyNoDate':
      "Your answer to an agency's checklist holds the earlier value. The new value was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.detailNoDate':
      "Your answer to {agency}'s checklist holds the earlier value. The new value was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.document':
      "Your answer to {agency}'s checklist on {date} holds the earlier copy. The newer one was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentNoAgency':
      "Your answer to an agency's checklist on {date} holds the earlier copy. The newer one was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentNoAgencyNoDate':
      "Your answer to an agency's checklist holds the earlier copy. The newer one was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentNoDate':
      "Your answer to {agency}'s checklist holds the earlier copy. The newer one was not sent. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentPreview':
      "Your answer to {agency}'s checklist on {date} holds this copy. A newer document would not be sent to them. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentPreviewNoAgency':
      "Your answer to an agency's checklist on {date} holds this copy. A newer document would not be sent to them. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentPreviewNoAgencyNoDate':
      "Your answer to an agency's checklist holds this copy. A newer document would not be sent to them. Your Answers shows where that answer stands.",
    'changeImpact.reason.checklistAnswer.documentPreviewNoDate':
      "Your answer to {agency}'s checklist holds this copy. A newer document would not be sent to them. Your Answers shows where that answer stands.",
    'changeImpact.reason.couldNotCheck.cases':
      'We could not check your cases this time. Try again in a moment.',
    'changeImpact.reason.couldNotCheck.requests':
      'We could not check your requests from agencies this time. Try again in a moment.',
    'changeImpact.reason.couldNotCheck.sharing':
      'We could not check your sharing this time. Try again in a moment.',
    'changeImpact.reason.finishedCaseKept.detail':
      '{case} is finished. It keeps the earlier value exactly as it was.',
    'changeImpact.reason.finishedCaseKept.document':
      '{case} is finished. It keeps the earlier copy exactly as it was.',
    'changeImpact.reason.finishedCaseKept.documentPreview':
      '{case} is finished. It keeps its own copy exactly as it is.',
    'changeImpact.reason.finishedCaseNoCopy.detail':
      '{case} is finished but has no saved copy, so we cannot show which value it used.',
    'changeImpact.reason.finishedCaseNoCopy.document':
      '{case} is finished but has no saved copy, so we cannot show which document it used.',
    'changeImpact.reason.recordIncomplete.area':
      'We could not find every copy of the newer document that went to agencies, so we cannot tell whether one of them needs to be replaced.',
    'changeImpact.reason.recordIncomplete.case':
      'The record for {case} does not add up, so we cannot tell what this change means for it.',
    'changeImpact.reason.recordIncomplete.request':
      'The record of what was sent to {agency} does not add up, so we cannot tell what this change means for it.',
    'changeImpact.reason.recordIncomplete.share':
      'The record of your sharing with {recipient} does not add up, so we cannot tell what this change means for it.',
    'changeImpact.reason.sentBeforeVersions.detail':
      'You answered {agency} on {date}, before exact copies were kept. We cannot tell which value was sent.',
    'changeImpact.reason.sentBeforeVersions.detailNoDate':
      'You answered {agency} before exact copies were kept. We cannot tell which value was sent.',
    'changeImpact.reason.sentBeforeVersions.document':
      'You answered {agency} on {date}, before exact copies were kept. We cannot tell which copy was sent.',
    'changeImpact.reason.sentBeforeVersions.documentNoDate':
      'You answered {agency} before exact copies were kept. We cannot tell which copy was sent.',
    'changeImpact.reason.shareAlreadyCovers':
      '{recipient} can open your current records under the sharing you set up. This change sends them nothing.',
    'changeImpact.reason.shareEarlierOnly.byName':
      '{recipient} can open the earlier document because you shared it by name. The newer document is not shared with them. Nothing changes unless you change it in sharing.',
    'changeImpact.reason.shareEarlierOnly.byNamePreview':
      '{recipient} can open this document because you shared it by name. Replacing it does not share the newer document with them. Nothing changes unless you change it in sharing.',
    'changeImpact.reason.shareEarlierOnly.other':
      '{recipient} can open the earlier document under the sharing you set up. The newer document is not shared with them. Nothing changes unless you change it in sharing.',
    'changeImpact.reason.shareEarlierOnly.otherPreview':
      '{recipient} can open this document under the sharing you set up. Replacing it does not share the newer document with them. Nothing changes unless you change it in sharing.',
    'changeImpact.review.closing':
      'This list sends, shares and changes nothing. Each step happens in the case, the request or sharing, and only when you choose it.',
    'changeImpact.review.incomplete':
      'We could not check everything this time, so this list may be missing something. Try again in a moment.',
    'changeImpact.review.introDetail':
      'You changed {detail} on {date}. This is what that means for your cases, your answers to agencies and your sharing.',
    'changeImpact.review.introDetailNoDate':
      'This is what a change to {detail} means for your cases, your answers to agencies and your sharing.',
    'changeImpact.review.introDocument':
      'You replaced {document} with {newer}. This is what that means for your cases, the copies you sent to agencies and your sharing.',
    'changeImpact.review.introDocumentAlone':
      'This is what replacing {document} means for your cases, the copies you sent to agencies and your sharing.',
    'changeImpact.review.introDocumentPreview':
      'If you replace {document} with {newer}, this is what it will mean for your cases, the copies you sent to agencies and your sharing.',
    'changeImpact.review.loading': 'Working out what this change affects.',
    'changeImpact.review.openPage': 'Open This as a Page',
    'changeImpact.review.previewFailed':
      'We could not work out what else this change affects this time. You can still replace the document.',
    'changeImpact.review.quiet': 'Nothing else uses this. No action is needed.',
    'changeImpact.review.quietWithItems':
      'No action is needed. What relates to this change is listed below.',
    'changeImpact.review.ready': 'The list of what this change affects is ready below.',
    'changeImpact.review.recordedFailed':
      'We could not work out what else this change affects this time. The replacement itself is done.',
    'changeImpact.review.title': 'What This Change Affects',
    'changeImpact.section.actionRequired': 'Needs Your Action',
    'changeImpact.section.historyPreserved': 'Stays as It Was',
    'changeImpact.section.noAction': 'Nothing to Do',
    'changeImpact.section.reviewRecommended': 'Worth a Look',
    'changeImpact.section.unknown': 'We Cannot Tell',
    'changeImpact.step.openAnswers': 'Open Your Answers',
    'changeImpact.step.openCase': 'Open the Case',
    'changeImpact.step.openRequest': 'Open the Request',
    'changeImpact.step.openSharing': 'Open Sharing',
    'changeImpact.view.failedBody':
      'We could not work out what this change affects. Nothing in your records was changed. Try again in a moment.',
    'changeImpact.view.failedTitle': 'This List Did Not Load',
    'changeImpact.view.tryAgain': 'Try Again',
  },
  bn: {},
});

export type ChangeImpactKey = CatalogKey<typeof changeImpactCatalog>;
