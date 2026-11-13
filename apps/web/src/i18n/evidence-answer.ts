import { defineCatalog } from '@visastack/i18n';

/**
 * Wording for Answer from Your Records: the review screen where a traveller answers everything one
 * agency is waiting for, from what is already saved, and the small additions to the Requests page.
 * English only for now; the Bengali block stays empty (the catalogue type asks for it) and a
 * missing Bengali key shows English. Keys are `evidenceAnswer.<component>.<slot>`.
 */
export const evidenceAnswerCatalog = defineCatalog({
  en: {
    // The page (server).
    'evidenceAnswer.page.title': 'Answer from Your Records',
    'evidenceAnswer.page.back': 'Requests from Agencies',
    'evidenceAnswer.page.allAgencies': 'All Agencies',
    'evidenceAnswer.page.unreadable':
      'Your requests could not be loaded. Nothing was sent. Refresh to try again.',
    'evidenceAnswer.page.unavailable':
      'Answering in one step is not available yet. You can still answer each request on its own page.',
    'evidenceAnswer.page.emptyTitle': 'Nothing Is Waiting for You',
    'evidenceAnswer.page.emptyBody': 'No agency is waiting for an answer from you right now.',
    'evidenceAnswer.page.pickTitle': 'Who Is Asking',
    'evidenceAnswer.page.pickSummary':
      '{waiting, plural, one {# request waiting} other {# requests waiting}} · {ready, plural, one {# ready from saved records} other {# ready from saved records}}',
    'evidenceAnswer.page.reviewAnswers': 'Review Answers',
    'evidenceAnswer.page.agencyHeading':
      '{agency}: {count, plural, one {# request waiting} other {# requests waiting}}',
    'evidenceAnswer.page.more': 'More requests are waiting than are listed here. See them all in:',
    'evidenceAnswer.page.requestsLink': 'Requests from Agencies',

    // The receipt after a send (server).
    'evidenceAnswer.receipt.title': 'Answers Sent',
    'evidenceAnswer.receipt.summary':
      '{count, plural, one {# exact copy went to {agency}.} other {# exact copies went to {agency}.}}',
    'evidenceAnswer.receipt.facts': 'Version {number} · {sentAt}',
    'evidenceAnswer.receipt.factsWithFingerprint':
      'Version {number} · Fingerprint {fingerprint} · {sentAt}',
    'evidenceAnswer.receipt.reference': 'Request Reference',
    'evidenceAnswer.receipt.stateWaiting': 'Received, Not Yet Reviewed',
    'evidenceAnswer.receipt.stateAccepted': 'Accepted',
    'evidenceAnswer.receipt.stateSentBack': 'Sent Back',
    'evidenceAnswer.receipt.stateClosed': 'Closed',

    // The review form (client).
    'evidenceAnswer.form.groupReady': 'Ready to Send',
    'evidenceAnswer.form.groupChoose': 'Needs Your Choice',
    'evidenceAnswer.form.groupOther': 'Not in This Step',
    'evidenceAnswer.form.doNotSend': 'Do Not Send Now',
    'evidenceAnswer.form.version': 'Version {number}',
    'evidenceAnswer.form.added': 'Added {when}',
    'evidenceAnswer.form.expires': 'Expires {date}',
    'evidenceAnswer.form.noExpiry': 'No expiry date saved',
    'evidenceAnswer.form.documentDate': 'Dated {date}',
    'evidenceAnswer.form.optional': 'Optional on the checklist',
    'evidenceAnswer.form.reference': 'Reference {code}',
    'evidenceAnswer.form.uncertainAge':
      'The checklist asks for a document from the last {days, plural, one {# day} other {# days}}. No date is saved for this copy, so check it before you send.',
    'evidenceAnswer.form.uncertainDisagree':
      'Two saved expiry dates for this copy disagree. Check it before you send.',
    'evidenceAnswer.form.acceptedBefore':
      'Accepted before by {agency}. Each agency decides for itself.',
    'evidenceAnswer.form.acceptedBeforeUnknown':
      'Accepted before by an agency. Each agency decides for itself.',
    'evidenceAnswer.form.sendNone': 'Send Answers to {agency}',
    'evidenceAnswer.form.sendNoneHint': 'Tick at least one answer to send.',
    'evidenceAnswer.form.send':
      '{count, plural, one {Send # Answer to {agency}} other {Send # Answers to {agency}}}',
    'evidenceAnswer.form.sending': 'Sending…',
    'evidenceAnswer.form.overLimit':
      'One step sends up to {limit} answers. Untick some, send, then send the rest.',
    'evidenceAnswer.form.consentShort':
      '{agency} can download these exact copies while it has access.',
    'evidenceAnswer.form.aboutSending': 'About Sending',
    'evidenceAnswer.form.aboutSendingBody':
      'Sending lets the agency download these exact copies while it has access to your records. Later changes to a file are not sent. You can end access under Sharing at any time. Each agency reviews for itself.',
    'evidenceAnswer.form.openRequest': 'Open This Request',
    'evidenceAnswer.form.addDocuments': 'Add Documents',
    'evidenceAnswer.form.aboutOther': 'About These Items',
    'evidenceAnswer.form.otherOutdatedShort': 'Saved copy is out of date.',
    'evidenceAnswer.form.otherOutdatedLong':
      'The saved copy is expired, or older than the checklist allows. You can still choose it on the request itself.',
    'evidenceAnswer.form.otherNeedsNewCopyShort': 'Sent back. Add a clearer copy.',
    'evidenceAnswer.form.otherNeedsNewCopyLong':
      'The agency sent every saved copy of this back. Add a clearer copy to your documents; it then appears here.',
    'evidenceAnswer.form.otherNotCheckedShort': 'This file cannot be sent yet.',
    'evidenceAnswer.form.otherNotCheckedLong':
      'The saved file is still being checked, did not pass its checks, or is no longer stored. Add another copy, or open the request to see more.',
    'evidenceAnswer.form.otherMissingShort': 'Nothing of this kind is saved.',
    'evidenceAnswer.form.otherMissingLong':
      'Nothing of this kind is saved yet. Add it to your documents, then answer this request.',
    'evidenceAnswer.form.otherOwnStepShort': 'Answered on its own page.',
    'evidenceAnswer.form.otherOwnStepLong':
      'A detail is answered on its own page, where you choose what to send.',
    'evidenceAnswer.form.otherNoAccessShort': 'Agency no longer has access.',
    'evidenceAnswer.form.otherNoAccessLong':
      'This agency no longer has access to your records, so nothing can be sent for this request.',

    // The server action's answers.
    'evidenceAnswer.actions.allSent':
      '{count, plural, one {# answer was sent to {agency}.} other {# answers were sent to {agency}.}}',
    'evidenceAnswer.actions.someChanged':
      '{sent, plural, one {# answer was sent to {agency}.} other {# answers were sent to {agency}.}} {changed, plural, one {# was not sent because your records changed after you opened this page.} other {# were not sent because your records changed after you opened this page.}} Check the list below and send again.',
    'evidenceAnswer.actions.noneSent':
      'Nothing was sent. Your records changed after you opened this page. Check the list and try again.',
    'evidenceAnswer.actions.outOfDate': 'This page is out of date. Refresh it and choose again.',
    'evidenceAnswer.actions.overLimit':
      'One step sends up to {limit} answers. Untick some, send, then send the rest.',
    'evidenceAnswer.actions.chooseOne': 'Choose at least one answer to send.',
    'evidenceAnswer.actions.failed':
      'Nothing was sent. Something went wrong on our side. Try again in a moment.',
    'evidenceAnswer.actions.theAgency': 'the agency',

    // The card on the Requests page, and the line in a request's panel.
    'evidenceAnswer.waitingCard.title': 'Waiting for Answers',
    'evidenceAnswer.waitingCard.one':
      '{agency} is waiting for {count, plural, one {# answer} other {# answers}}',
    'evidenceAnswer.waitingCard.agencyLine':
      '{agency}: {count, plural, one {# answer} other {# answers}}',
    'evidenceAnswer.waitingCard.action': 'Answer from Your Records',
    'evidenceAnswer.panes.askedBy': 'Asked by {agency}',

    // The copy choices on a request's own page.
    'evidenceAnswer.choices.expires': 'Expires {date}',
    'evidenceAnswer.choices.expired': 'Expired on {date}',
    'evidenceAnswer.choices.uncertain':
      'The saved expiry dates do not agree. Check them before you send this copy.',
    'evidenceAnswer.choices.noCurrent':
      'Every saved copy has expired or needs a date check. Add a current copy, or choose an older one yourself to send it as it is.',

    // What a traveller sent in answer to a detail request, on its own page.
    'evidenceAnswer.fieldAnswer.title': 'What You Sent',
    'evidenceAnswer.fieldAnswer.pinned': 'Version {version}, saved {savedAt}: {value}',
    'evidenceAnswer.fieldAnswer.protected':
      'Version {version}, saved {savedAt}: a protected detail, not shown here.',
    'evidenceAnswer.fieldAnswer.changedSince':
      'This detail has changed since. Its newer value was not sent.',
    'evidenceAnswer.fieldAnswer.waiting': 'Waiting for the agency',
    'evidenceAnswer.fieldAnswer.accepted': 'Accepted',
    'evidenceAnswer.fieldAnswer.sentBack': 'Sent back',
    'evidenceAnswer.fieldAnswer.withdrawn': 'Withdrawn by the agency',
    'evidenceAnswer.fieldAnswer.legacy':
      'Sent before the exact value was kept. This page cannot show which value was sent.',
    'evidenceAnswer.fieldAnswer.unread': 'The value you sent could not be loaded.',

    // The copy an agency sent back, on a request's own page.
    'evidenceAnswer.sentBack.exact':
      'The agency sent back {name}, version {version}, which you sent on {date}.',
    'evidenceAnswer.sentBack.document':
      'The agency sent back {name}. This page cannot say which version of it.',
    'evidenceAnswer.sentBack.thisDocument': 'this document',
    'evidenceAnswer.sentBack.unknown':
      'The agency sent an answer back, but this page cannot tell which copy it was. Nothing is chosen for you. Choose the copy to send yourself.',
  },
  bn: {},
});
