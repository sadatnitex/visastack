import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the evidence-answer surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const evidenceAnswerCatalog = defineCatalog({
  en: {
    'evidenceAnswer.actions.allSent':
      '{count, plural, one {# answer was sent to {agency}.} other {# answers were sent to {agency}.}}',
    'evidenceAnswer.actions.chooseOne': 'Choose at least one answer to send.',
    'evidenceAnswer.actions.failed':
      'Nothing was sent. Something went wrong on our side. Try again in a moment.',
    'evidenceAnswer.actions.noneSent':
      'Nothing was sent. Your records changed after you opened this page. Check the list and try again.',
    'evidenceAnswer.actions.outOfDate': 'This page is out of date. Refresh it and choose again.',
    'evidenceAnswer.actions.overLimit':
      'One step sends up to {limit} answers. Untick some, send, then send the rest.',
    'evidenceAnswer.actions.someChanged':
      '{sent, plural, one {# answer was sent to {agency}.} other {# answers were sent to {agency}.}} {changed, plural, one {# was not sent because your records changed after you opened this page.} other {# were not sent because your records changed after you opened this page.}} Check the list below and send again.',
    'evidenceAnswer.actions.theAgency': 'the agency',
    'evidenceAnswer.choices.expired': 'Expired on {date}',
    'evidenceAnswer.choices.expires': 'Expires {date}',
    'evidenceAnswer.choices.noCurrent':
      'Every saved copy has expired or needs a date check. Add a current copy, or choose an older one yourself to send it as it is.',
    'evidenceAnswer.choices.uncertain':
      'The saved expiry dates do not agree. Check them before you send this copy.',
    'evidenceAnswer.fieldAnswer.accepted': 'Accepted',
    'evidenceAnswer.fieldAnswer.changedSince':
      'This detail has changed since. Its newer value was not sent.',
    'evidenceAnswer.fieldAnswer.legacy':
      'Sent before the exact value was kept. This page cannot show which value was sent.',
    'evidenceAnswer.fieldAnswer.pinned': 'Version {version}, saved {savedAt}: {value}',
    'evidenceAnswer.fieldAnswer.protected':
      'Version {version}, saved {savedAt}: a protected detail, not shown here.',
    'evidenceAnswer.fieldAnswer.sentBack': 'Sent back',
    'evidenceAnswer.fieldAnswer.title': 'What You Sent',
    'evidenceAnswer.fieldAnswer.unread': 'The value you sent could not be loaded.',
    'evidenceAnswer.fieldAnswer.waiting': 'Waiting for the agency',
    'evidenceAnswer.fieldAnswer.withdrawn': 'Withdrawn by the agency',
    'evidenceAnswer.form.aboutOther': 'About These Items',
    'evidenceAnswer.form.aboutSending': 'About Sending',
    'evidenceAnswer.form.aboutSendingBody':
      'Sending lets the agency download these exact copies while it has access to your records. Later changes to a file are not sent. You can end access under Sharing at any time. Each agency reviews for itself.',
    'evidenceAnswer.form.acceptedBefore':
      'Accepted before by {agency}. Each agency decides for itself.',
    'evidenceAnswer.form.acceptedBeforeUnknown':
      'Accepted before by an agency. Each agency decides for itself.',
    'evidenceAnswer.form.addDocuments': 'Add Documents',
    'evidenceAnswer.form.added': 'Added {when}',
    'evidenceAnswer.form.consentShort':
      '{agency} can download these exact copies while it has access.',
    'evidenceAnswer.form.doNotSend': 'Do Not Send Now',
    'evidenceAnswer.form.documentDate': 'Dated {date}',
    'evidenceAnswer.form.expires': 'Expires {date}',
    'evidenceAnswer.form.groupChoose': 'Needs Your Choice',
    'evidenceAnswer.form.groupOther': 'Not in This Step',
    'evidenceAnswer.form.groupReady': 'Ready to Send',
    'evidenceAnswer.form.noExpiry': 'No expiry date saved',
    'evidenceAnswer.form.openRequest': 'Open This Request',
    'evidenceAnswer.form.optional': 'Optional on the checklist',
    'evidenceAnswer.form.otherMissingLong':
      'Nothing of this kind is saved yet. Add it to your documents, then answer this request.',
    'evidenceAnswer.form.otherMissingShort': 'Nothing of this kind is saved.',
    'evidenceAnswer.form.otherNeedsNewCopyLong':
      'The agency sent every saved copy of this back. Add a clearer copy to your documents; it then appears here.',
    'evidenceAnswer.form.otherNeedsNewCopyShort': 'Sent back. Add a clearer copy.',
    'evidenceAnswer.form.otherNoAccessLong':
      'This agency no longer has access to your records, so nothing can be sent for this request.',
    'evidenceAnswer.form.otherNoAccessShort': 'Agency no longer has access.',
    'evidenceAnswer.form.otherNotCheckedLong':
      'The saved file is still being checked, did not pass its checks, or is no longer stored. Add another copy, or open the request to see more.',
    'evidenceAnswer.form.otherNotCheckedShort': 'This file cannot be sent yet.',
    'evidenceAnswer.form.otherOutdatedLong':
      'The saved copy is expired, or older than the checklist allows. You can still choose it on the request itself.',
    'evidenceAnswer.form.otherOutdatedShort': 'Saved copy is out of date.',
    'evidenceAnswer.form.otherOwnStepLong':
      'A detail is answered on its own page, where you choose what to send.',
    'evidenceAnswer.form.otherOwnStepShort': 'Answered on its own page.',
    'evidenceAnswer.form.overLimit':
      'One step sends up to {limit} answers. Untick some, send, then send the rest.',
    'evidenceAnswer.form.reference': 'Reference {code}',
    'evidenceAnswer.form.send':
      '{count, plural, one {Send # Answer to {agency}} other {Send # Answers to {agency}}}',
    'evidenceAnswer.form.sendNone': 'Send Answers to {agency}',
    'evidenceAnswer.form.sendNoneHint': 'Tick at least one answer to send.',
    'evidenceAnswer.form.sending': 'Sending…',
    'evidenceAnswer.form.uncertainAge':
      'The checklist asks for a document from the last {days, plural, one {# day} other {# days}}. No date is saved for this copy, so check it before you send.',
    'evidenceAnswer.form.uncertainDisagree':
      'Two saved expiry dates for this copy disagree. Check it before you send.',
    'evidenceAnswer.form.version': 'Version {number}',
    'evidenceAnswer.page.agencyHeading':
      '{agency}: {count, plural, one {# request waiting} other {# requests waiting}}',
    'evidenceAnswer.page.allAgencies': 'All Agencies',
    'evidenceAnswer.page.back': 'Requests from Agencies',
    'evidenceAnswer.page.emptyBody': 'No agency is waiting for an answer from you right now.',
    'evidenceAnswer.page.emptyTitle': 'Nothing Is Waiting for You',
    'evidenceAnswer.page.more': 'More requests are waiting than are listed here. See them all in:',
    'evidenceAnswer.page.pickSummary':
      '{waiting, plural, one {# request waiting} other {# requests waiting}} · {ready, plural, one {# ready from saved records} other {# ready from saved records}}',
    'evidenceAnswer.page.pickTitle': 'Who Is Asking',
    'evidenceAnswer.page.requestsLink': 'Requests from Agencies',
    'evidenceAnswer.page.reviewAnswers': 'Review Answers',
    'evidenceAnswer.page.title': 'Answer from Your Records',
    'evidenceAnswer.page.unavailable':
      'Answering in one step is not available yet. You can still answer each request on its own page.',
    'evidenceAnswer.page.unreadable':
      'Your requests could not be loaded. Nothing was sent. Refresh to try again.',
    'evidenceAnswer.panes.askedBy': 'Asked by {agency}',
    'evidenceAnswer.receipt.facts': 'Version {number} · {sentAt}',
    'evidenceAnswer.receipt.factsWithFingerprint':
      'Version {number} · Fingerprint {fingerprint} · {sentAt}',
    'evidenceAnswer.receipt.reference': 'Request Reference',
    'evidenceAnswer.receipt.stateAccepted': 'Accepted',
    'evidenceAnswer.receipt.stateClosed': 'Closed',
    'evidenceAnswer.receipt.stateSentBack': 'Sent Back',
    'evidenceAnswer.receipt.stateWaiting': 'Received, Not Yet Reviewed',
    'evidenceAnswer.receipt.summary':
      '{count, plural, one {# exact copy went to {agency}.} other {# exact copies went to {agency}.}}',
    'evidenceAnswer.receipt.title': 'Answers Sent',
    'evidenceAnswer.sentBack.document':
      'The agency sent back {name}. This page cannot say which version of it.',
    'evidenceAnswer.sentBack.exact':
      'The agency sent back {name}, version {version}, which you sent on {date}.',
    'evidenceAnswer.sentBack.thisDocument': 'this document',
    'evidenceAnswer.sentBack.unknown':
      'The agency sent an answer back, but this page cannot tell which copy it was. Nothing is chosen for you. Choose the copy to send yourself.',
    'evidenceAnswer.waitingCard.action': 'Answer from Your Records',
    'evidenceAnswer.waitingCard.agencyLine':
      '{agency}: {count, plural, one {# answer} other {# answers}}',
    'evidenceAnswer.waitingCard.one':
      '{agency} is waiting for {count, plural, one {# answer} other {# answers}}',
    'evidenceAnswer.waitingCard.title': 'Waiting for Answers',
  },
  bn: {
    'evidenceAnswer.actions.allSent':
      '{count, plural, one {{agency}-কে #টি উত্তর পাঠানো হয়েছে।} other {{agency}-কে #টি উত্তর পাঠানো হয়েছে।}}',
    'evidenceAnswer.actions.chooseOne': 'পাঠানোর জন্য অন্তত একটি উত্তর বেছে নিন।',
    'evidenceAnswer.actions.failed':
      'কিছুই পাঠানো হয়নি। আমাদের দিকে কিছু একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
    'evidenceAnswer.actions.noneSent':
      'কিছুই পাঠানো হয়নি। এই পাতা খোলার পর আপনার রেকর্ড বদলে গেছে। তালিকাটি দেখে আবার চেষ্টা করুন।',
    'evidenceAnswer.actions.outOfDate': 'এই পাতাটি পুরোনো হয়ে গেছে। রিফ্রেশ করে আবার বেছে নিন।',
    'evidenceAnswer.actions.overLimit':
      'এক ধাপে সর্বোচ্চ {limit}টি উত্তর পাঠানো যায়। কয়েকটির টিক তুলে দিয়ে পাঠান, তারপর বাকিগুলো পাঠান।',
    'evidenceAnswer.actions.someChanged':
      '{sent, plural, one {{agency}-কে #টি উত্তর পাঠানো হয়েছে।} other {{agency}-কে #টি উত্তর পাঠানো হয়েছে।}} {changed, plural, one {এই পাতা খোলার পর আপনার রেকর্ড বদলে যাওয়ায় #টি পাঠানো হয়নি।} other {এই পাতা খোলার পর আপনার রেকর্ড বদলে যাওয়ায় #টি পাঠানো হয়নি।}} নিচের তালিকাটি দেখে আবার পাঠান।',
    'evidenceAnswer.actions.theAgency': 'এজেন্সি',
    'evidenceAnswer.choices.expired': '{date} তারিখে মেয়াদ শেষ হয়েছে',
    'evidenceAnswer.choices.expires': 'মেয়াদ শেষ হবে {date}',
    'evidenceAnswer.choices.noCurrent':
      'সংরক্ষিত প্রতিটি কপির মেয়াদ শেষ হয়েছে অথবা তারিখ মিলিয়ে দেখা দরকার। একটি বর্তমান কপি যোগ করুন, অথবা যেমন আছে তেমনই পাঠাতে নিজে একটি পুরোনো কপি বেছে নিন।',
    'evidenceAnswer.choices.uncertain':
      'সংরক্ষিত মেয়াদ শেষের তারিখগুলো মিলছে না। এই কপি পাঠানোর আগে সেগুলো দেখে নিন।',
    'evidenceAnswer.fieldAnswer.accepted': 'গ্রহণ করা হয়েছে',
    'evidenceAnswer.fieldAnswer.changedSince': 'এরপর এই তথ্যটি বদলেছে। এর নতুন মানটি পাঠানো হয়নি।',
    'evidenceAnswer.fieldAnswer.legacy':
      'হুবহু মান রেখে দেওয়া শুরুর আগে এটি পাঠানো হয়েছিল। কোন মানটি পাঠানো হয়েছিল তা এই পাতায় দেখানো সম্ভব নয়।',
    'evidenceAnswer.fieldAnswer.pinned': 'সংস্করণ {version}, {savedAt} সংরক্ষিত: {value}',
    'evidenceAnswer.fieldAnswer.protected':
      'সংস্করণ {version}, {savedAt} সংরক্ষিত: একটি সুরক্ষিত তথ্য, এখানে দেখানো হয় না।',
    'evidenceAnswer.fieldAnswer.sentBack': 'ফেরত পাঠানো হয়েছে',
    'evidenceAnswer.fieldAnswer.title': 'আপনি যা পাঠিয়েছেন',
    'evidenceAnswer.fieldAnswer.unread': 'আপনার পাঠানো মানটি লোড করা যায়নি।',
    'evidenceAnswer.fieldAnswer.waiting': 'এজেন্সির অপেক্ষায়',
    'evidenceAnswer.fieldAnswer.withdrawn': 'এজেন্সি প্রত্যাহার করেছে',
    'evidenceAnswer.form.aboutOther': 'এই আইটেমগুলো সম্পর্কে',
    'evidenceAnswer.form.aboutSending': 'পাঠানো সম্পর্কে',
    'evidenceAnswer.form.aboutSendingBody':
      'পাঠালে এজেন্সি আপনার রেকর্ডে অ্যাক্সেস থাকা অবস্থায় এই হুবহু কপিগুলো ডাউনলোড করতে পারবে। পরে ডকুমেন্টে কোনো পরিবর্তন হলে তা পাঠানো হয় না। আপনি যেকোনো সময় শেয়ারিং থেকে অ্যাক্সেস বন্ধ করতে পারেন। প্রতিটি এজেন্সি নিজেই পর্যালোচনা করে।',
    'evidenceAnswer.form.acceptedBefore':
      'আগে {agency} এটি গ্রহণ করেছিল। প্রতিটি এজেন্সি নিজেই সিদ্ধান্ত নেয়।',
    'evidenceAnswer.form.acceptedBeforeUnknown':
      'আগে একটি এজেন্সি এটি গ্রহণ করেছিল। প্রতিটি এজেন্সি নিজেই সিদ্ধান্ত নেয়।',
    'evidenceAnswer.form.addDocuments': 'ডকুমেন্ট যোগ করুন',
    'evidenceAnswer.form.added': 'যোগ করা হয়েছে {when}',
    'evidenceAnswer.form.consentShort': 'অ্যাক্সেস থাকা অবস্থায় {agency} এই হুবহু কপিগুলো ডাউনলোড করতে পারবে।',
    'evidenceAnswer.form.doNotSend': 'এখন পাঠাবেন না',
    'evidenceAnswer.form.documentDate': 'তারিখ {date}',
    'evidenceAnswer.form.expires': 'মেয়াদ শেষ হবে {date}',
    'evidenceAnswer.form.groupChoose': 'আপনাকে বেছে নিতে হবে',
    'evidenceAnswer.form.groupOther': 'এই ধাপে নেই',
    'evidenceAnswer.form.groupReady': 'পাঠানোর জন্য প্রস্তুত',
    'evidenceAnswer.form.noExpiry': 'মেয়াদ শেষের কোনো তারিখ সংরক্ষিত নেই',
    'evidenceAnswer.form.openRequest': 'এই অনুরোধটি খুলুন',
    'evidenceAnswer.form.optional': 'চেকলিস্টে ঐচ্ছিক',
    'evidenceAnswer.form.otherMissingLong':
      'এই ধরনের কিছু এখনো সংরক্ষিত নেই। আপনার ডকুমেন্টে এটি যোগ করুন, তারপর এই অনুরোধের উত্তর দিন।',
    'evidenceAnswer.form.otherMissingShort': 'এই ধরনের কিছু সংরক্ষিত নেই।',
    'evidenceAnswer.form.otherNeedsNewCopyLong':
      'এজেন্সি এর সংরক্ষিত সব কপিই ফেরত পাঠিয়েছে। আপনার ডকুমেন্টে আরও স্পষ্ট একটি কপি যোগ করুন; তখন সেটি এখানে দেখা যাবে।',
    'evidenceAnswer.form.otherNeedsNewCopyShort': 'ফেরত পাঠানো হয়েছে। আরও স্পষ্ট একটি কপি যোগ করুন।',
    'evidenceAnswer.form.otherNoAccessLong':
      'এই এজেন্সির আর আপনার রেকর্ডে অ্যাক্সেস নেই, তাই এই অনুরোধের জন্য কিছু পাঠানো যাবে না।',
    'evidenceAnswer.form.otherNoAccessShort': 'এজেন্সির আর অ্যাক্সেস নেই।',
    'evidenceAnswer.form.otherNotCheckedLong':
      'সংরক্ষিত ডকুমেন্টটি এখনো পরীক্ষা করা হচ্ছে, পরীক্ষায় উত্তীর্ণ হয়নি, অথবা আর সংরক্ষিত নেই। আরেকটি কপি যোগ করুন, অথবা আরও জানতে অনুরোধটি খুলুন।',
    'evidenceAnswer.form.otherNotCheckedShort': 'এই ডকুমেন্টটি এখনো পাঠানো যাচ্ছে না।',
    'evidenceAnswer.form.otherOutdatedLong':
      'সংরক্ষিত কপিটির মেয়াদ শেষ হয়েছে, অথবা চেকলিস্ট যতটা পুরোনো ডকুমেন্ট মেনে নেয় এটি তার চেয়ে পুরোনো। তবু আপনি চাইলে অনুরোধটিতেই এটি বেছে নিতে পারেন।',
    'evidenceAnswer.form.otherOutdatedShort': 'সংরক্ষিত কপিটি পুরোনো হয়ে গেছে।',
    'evidenceAnswer.form.otherOwnStepLong':
      'কোনো তথ্যের উত্তর তার নিজস্ব পাতায় দেওয়া হয়, যেখানে কী পাঠাবেন তা আপনি বেছে নেন।',
    'evidenceAnswer.form.otherOwnStepShort': 'এর উত্তর নিজস্ব পাতায় দেওয়া হয়।',
    'evidenceAnswer.form.overLimit':
      'এক ধাপে সর্বোচ্চ {limit}টি উত্তর পাঠানো যায়। কয়েকটির টিক তুলে দিয়ে পাঠান, তারপর বাকিগুলো পাঠান।',
    'evidenceAnswer.form.reference': 'রেফারেন্স {code}',
    'evidenceAnswer.form.send':
      '{count, plural, one {{agency}-কে #টি উত্তর পাঠান} other {{agency}-কে #টি উত্তর পাঠান}}',
    'evidenceAnswer.form.sendNone': '{agency}-কে উত্তর পাঠান',
    'evidenceAnswer.form.sendNoneHint': 'পাঠানোর জন্য অন্তত একটি উত্তরে টিক দিন।',
    'evidenceAnswer.form.sending': 'পাঠানো হচ্ছে…',
    'evidenceAnswer.form.uncertainAge':
      'চেকলিস্টে গত {days, plural, one {# দিনের} other {# দিনের}} মধ্যের একটি ডকুমেন্ট চাওয়া হয়েছে। এই কপির কোনো তারিখ সংরক্ষিত নেই, তাই পাঠানোর আগে এটি দেখে নিন।',
    'evidenceAnswer.form.uncertainDisagree':
      'এই কপির জন্য সংরক্ষিত মেয়াদ শেষের দুটি তারিখ মিলছে না। পাঠানোর আগে এটি দেখে নিন।',
    'evidenceAnswer.form.version': 'কপি {number}',
    'evidenceAnswer.page.agencyHeading':
      '{agency}: {count, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}',
    'evidenceAnswer.page.allAgencies': 'সব এজেন্সি',
    'evidenceAnswer.page.back': 'এজেন্সির অনুরোধ',
    'evidenceAnswer.page.emptyBody': 'এই মুহূর্তে কোনো এজেন্সি আপনার উত্তরের অপেক্ষায় নেই।',
    'evidenceAnswer.page.emptyTitle': 'আপনার জন্য কিছু অপেক্ষায় নেই',
    'evidenceAnswer.page.more':
      'এখানে যতগুলো দেখানো হয়েছে তার চেয়ে বেশি অনুরোধ অপেক্ষায় আছে। সবগুলো দেখুন এখানে:',
    'evidenceAnswer.page.pickSummary':
      '{waiting, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}} · {ready, plural, one {#টি সংরক্ষিত রেকর্ড থেকে প্রস্তুত} other {#টি সংরক্ষিত রেকর্ড থেকে প্রস্তুত}}',
    'evidenceAnswer.page.pickTitle': 'কে চাইছে',
    'evidenceAnswer.page.requestsLink': 'এজেন্সির অনুরোধ',
    'evidenceAnswer.page.reviewAnswers': 'উত্তরগুলো দেখে নিন',
    'evidenceAnswer.page.title': 'আপনার রেকর্ড থেকে উত্তর দিন',
    'evidenceAnswer.page.unavailable':
      'এক ধাপে উত্তর দেওয়ার সুবিধা এখনো চালু হয়নি। তবে প্রতিটি অনুরোধের উত্তর তার নিজস্ব পাতায় দিতে পারবেন।',
    'evidenceAnswer.page.unreadable':
      'আপনার অনুরোধগুলো লোড করা যায়নি। কিছুই পাঠানো হয়নি। আবার চেষ্টা করতে রিফ্রেশ করুন।',
    'evidenceAnswer.panes.askedBy': '{agency} এটি চেয়েছে',
    'evidenceAnswer.receipt.facts': 'কপি {number} · {sentAt}',
    'evidenceAnswer.receipt.factsWithFingerprint':
      'কপি {number} · ফিঙ্গারপ্রিন্ট {fingerprint} · {sentAt}',
    'evidenceAnswer.receipt.reference': 'অনুরোধের রেফারেন্স',
    'evidenceAnswer.receipt.stateAccepted': 'গ্রহণ করা হয়েছে',
    'evidenceAnswer.receipt.stateClosed': 'বন্ধ',
    'evidenceAnswer.receipt.stateSentBack': 'ফেরত পাঠানো হয়েছে',
    'evidenceAnswer.receipt.stateWaiting': 'পাওয়া গেছে, এখনো পর্যালোচনা হয়নি',
    'evidenceAnswer.receipt.summary':
      '{count, plural, one {#টি হুবহু কপি {agency}-এর কাছে গেছে।} other {#টি হুবহু কপি {agency}-এর কাছে গেছে।}}',
    'evidenceAnswer.receipt.title': 'উত্তর পাঠানো হয়েছে',
    'evidenceAnswer.sentBack.document':
      'এজেন্সি {name} ফেরত পাঠিয়েছে। এর কোন কপিটি, তা এই পাতায় বলা সম্ভব নয়।',
    'evidenceAnswer.sentBack.exact':
      'এজেন্সি {name}-এর কপি {version} ফেরত পাঠিয়েছে, যেটি আপনি {date} তারিখে পাঠিয়েছিলেন।',
    'evidenceAnswer.sentBack.thisDocument': 'এই ডকুমেন্ট',
    'evidenceAnswer.sentBack.unknown':
      'এজেন্সি একটি উত্তর ফেরত পাঠিয়েছে, কিন্তু সেটি কোন কপি ছিল তা এই পাতায় বোঝা যাচ্ছে না। আপনার হয়ে কিছুই বেছে রাখা হয়নি। কোন কপিটি পাঠাবেন তা নিজে বেছে নিন।',
    'evidenceAnswer.waitingCard.action': 'আপনার রেকর্ড থেকে উত্তর দিন',
    'evidenceAnswer.waitingCard.agencyLine':
      '{agency}: {count, plural, one {#টি উত্তর} other {#টি উত্তর}}',
    'evidenceAnswer.waitingCard.one':
      '{agency} {count, plural, one {#টি উত্তরের} other {#টি উত্তরের}} অপেক্ষায় আছে',
    'evidenceAnswer.waitingCard.title': 'উত্তরের অপেক্ষায়',
  },
});
