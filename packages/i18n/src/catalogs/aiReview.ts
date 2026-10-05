import { defineCatalog } from '../catalog';

/**
 * AI help with a document: the buttons that ask for a suggestion, the suggestions
 * and flags awaiting a person's decision, and what each decision said happened.
 * Nothing here is applied without the traveller's approval, and the wording must
 * keep saying so exactly, so its Bangla needs a privacy review.
 *
 * What the model wrote (an explanation, a quoted snippet, the description of a
 * possible inconsistency) is shown as returned and is not part of this catalog.
 * The consent statements shown before any of this can be used live in `consent`.
 */
export const aiReview = defineCatalog(
  { id: 'aiReview', review: ['PRIVACY'] },
  {
    'ai.extraction.run': 'Run AI extraction',
    'ai.extraction.running': 'Running AI extraction…',
    'ai.ocr.run': 'Run OCR',
    'ai.ocr.running': 'Running OCR…',
    'ai.classification.run': 'Suggest document type with AI',
    'ai.classification.running': 'Asking AI to suggest a type…',
    'ai.inconsistency.run': 'Check for inconsistencies with AI',
    'ai.inconsistency.running': 'Checking for inconsistencies…',

    // The text OCR read from a document, and what it could not read.
    'ai.ocr.issue.low_quality': 'Low image quality',
    'ai.ocr.issue.ambiguous_date': 'Ambiguous date',
    'ai.ocr.issue.unsupported_script': 'Unsupported script',
    'ai.ocr.issue.missing_text': 'No legible text found',
    'ai.ocr.fallback.badge': 'Fallback provider used',
    'ai.ocr.fallback.title':
      'The primary provider timed out or was rate-limited; this result came from the configured fallback provider instead.',
    'ai.ocr.noText': 'No legible text was found.',

    // A suggestion awaiting a decision.
    'ai.proposal.unmapped': 'Unmapped (no matching field)',
    'ai.confidence': '{label} ({confidence}% confidence)',
    'ai.proposal.evidence': 'Evidence:',
    'ai.proposal.unverified.badge': 'Unverified quote',
    'ai.proposal.unverified.title':
      'This exact quote could not be confirmed in the source document text.',
    'ai.proposal.noValue': '(no value)',
    'ai.proposal.input': 'Corrected value',
    'ai.inconsistency.badge': 'Possible inconsistency ({confidence}% confidence)',
    'ai.docType.suggests': 'AI suggests: {type} ({confidence}% confidence)',

    // What happened when a person asked for a suggestion.
    'ai.action.notConfigured.extraction': 'AI extraction is not configured.',
    'ai.action.notConfigured.ocr': 'AI OCR is not configured.',
    'ai.action.notConfigured.classification': 'AI classification is not configured.',
    'ai.action.notConfigured.inconsistency': 'AI inconsistency checking is not configured.',
    'ai.action.noText': 'No extracted text available yet for this document.',
    'ai.action.extraction.done.one': 'AI extraction proposed {count} field for review.',
    'ai.action.extraction.done.other': 'AI extraction proposed {count} fields for review.',
    'ai.action.ocr.done': 'OCR completed successfully.',
    'ai.action.ocr.issues.one':
      'OCR completed, but flagged {count} review issue - check the extracted text below.',
    'ai.action.ocr.issues.other':
      'OCR completed, but flagged {count} review issues - check the extracted text below.',
    'ai.action.ocr.unsupported':
      'OCR reads images and scanned PDFs. This kind of document cannot be read that way.',
    'ai.action.ocr.unavailable':
      'We could not prepare this document for OCR. Please try again in a moment.',
    'ai.action.classification.suggested': 'AI suggested a document type: {type} - review below.',
    'ai.action.classification.none':
      'AI classification ran, but could not confidently suggest a document type.',
    'ai.action.classification.rejected': 'Suggestion rejected.',
    'ai.action.classification.approved': 'Document type approved and saved.',
    'ai.action.proposal.rejected': 'Proposal rejected.',
    'ai.action.proposal.approved': 'Proposal approved and saved to the profile.',
    'ai.action.proposal.conflicted':
      'Approved, but this conflicts with an already-confirmed value, so it is flagged for review.',
    'ai.action.inconsistency.found.one': 'AI found {count} possible inconsistency to review.',
    'ai.action.inconsistency.found.other': 'AI found {count} possible inconsistencies to review.',
    'ai.action.inconsistency.none': 'AI inconsistency check ran and found nothing to flag.',
    'ai.action.flag.acknowledged': 'Flag acknowledged.',
    'ai.action.flag.dismissed': 'Flag dismissed.',
  },
  {
    'ai.extraction.run': 'এআই নিষ্কাশন চালান',
    'ai.extraction.running': 'এআই নিষ্কাশন চলছে…',
    'ai.ocr.run': 'ওসিআর চালান',
    'ai.ocr.running': 'ওসিআর চলছে…',
    'ai.classification.run': 'এআই দিয়ে নথির ধরন প্রস্তাব করান',
    'ai.classification.running': 'এআইকে ধরন প্রস্তাব করতে বলা হচ্ছে…',
    'ai.inconsistency.run': 'এআই দিয়ে অসঙ্গতি যাচাই করুন',
    'ai.inconsistency.running': 'অসঙ্গতি যাচাই করা হচ্ছে…',

    'ai.ocr.issue.low_quality': 'ছবির মান কম',
    'ai.ocr.issue.ambiguous_date': 'তারিখ অস্পষ্ট',
    'ai.ocr.issue.unsupported_script': 'অসমর্থিত লিপি',
    'ai.ocr.issue.missing_text': 'পড়ার মতো কোনো লেখা পাওয়া যায়নি',
    'ai.ocr.fallback.badge': 'বিকল্প সরবরাহকারী ব্যবহৃত হয়েছে',
    'ai.ocr.fallback.title':
      'প্রধান সরবরাহকারী সময়মতো সাড়া দেয়নি বা অনুরোধের সীমায় আটকে গিয়েছিল; তাই এই ফলাফল নির্ধারিত বিকল্প সরবরাহকারীর কাছ থেকে এসেছে।',
    'ai.ocr.noText': 'পড়ার মতো কোনো লেখা পাওয়া যায়নি।',

    'ai.proposal.unmapped': 'কোনো ক্ষেত্রের সঙ্গে মেলেনি',
    'ai.confidence': '{label} ({confidence}% নিশ্চিত)',
    'ai.proposal.evidence': 'প্রমাণ:',
    'ai.proposal.unverified.badge': 'যাচাই না হওয়া উদ্ধৃতি',
    'ai.proposal.unverified.title': 'নথির মূল লেখায় এই হুবহু উদ্ধৃতিটি নিশ্চিত করা যায়নি।',
    'ai.proposal.noValue': '(কোনো মান নেই)',
    'ai.proposal.input': 'সংশোধিত মান',
    'ai.inconsistency.badge': 'সম্ভাব্য অসঙ্গতি ({confidence}% নিশ্চিত)',
    'ai.docType.suggests': 'এআই প্রস্তাব করছে: {type} ({confidence}% নিশ্চিত)',

    'ai.action.notConfigured.extraction': 'এআই নিষ্কাশন এখনও চালু করা হয়নি।',
    'ai.action.notConfigured.ocr': 'এআই ওসিআর এখনও চালু করা হয়নি।',
    'ai.action.notConfigured.classification': 'এআই শ্রেণিবিন্যাস এখনও চালু করা হয়নি।',
    'ai.action.notConfigured.inconsistency': 'এআই অসঙ্গতি যাচাই এখনও চালু করা হয়নি।',
    'ai.action.noText': 'এই নথির জন্য এখনও কোনো নিষ্কাশিত লেখা পাওয়া যায়নি।',
    'ai.action.extraction.done.one':
      'এআই নিষ্কাশন পর্যালোচনার জন্য {count}টি ক্ষেত্রের প্রস্তাব দিয়েছে।',
    'ai.action.extraction.done.other':
      'এআই নিষ্কাশন পর্যালোচনার জন্য {count}টি ক্ষেত্রের প্রস্তাব দিয়েছে।',
    'ai.action.ocr.done': 'ওসিআর সফলভাবে সম্পন্ন হয়েছে।',
    'ai.action.ocr.issues.one':
      'ওসিআর সম্পন্ন হয়েছে, তবে {count}টি পর্যালোচনার বিষয় চিহ্নিত হয়েছে। নিচের নিষ্কাশিত লেখা দেখে নিন।',
    'ai.action.ocr.issues.other':
      'ওসিআর সম্পন্ন হয়েছে, তবে {count}টি পর্যালোচনার বিষয় চিহ্নিত হয়েছে। নিচের নিষ্কাশিত লেখা দেখে নিন।',
    'ai.action.ocr.unsupported':
      'ওসিআর শুধু ছবি ও স্ক্যান করা PDF পড়তে পারে। এই ধরনের নথি সেভাবে পড়া যায় না।',
    'ai.action.ocr.unavailable':
      'ওসিআরের জন্য এই নথিটি প্রস্তুত করা যায়নি। অনুগ্রহ করে একটু পরে আবার চেষ্টা করুন।',
    'ai.action.classification.suggested':
      'এআই নথির একটি ধরন প্রস্তাব করেছে: {type}। নিচে দেখে নিন।',
    'ai.action.classification.none':
      'এআই শ্রেণিবিন্যাস চালানো হয়েছে, কিন্তু নিশ্চিতভাবে কোনো ধরন প্রস্তাব করতে পারেনি।',
    'ai.action.classification.rejected': 'প্রস্তাব প্রত্যাখ্যান করা হয়েছে।',
    'ai.action.classification.approved': 'নথির ধরন অনুমোদিত ও সংরক্ষিত হয়েছে।',
    'ai.action.proposal.rejected': 'প্রস্তাব প্রত্যাখ্যান করা হয়েছে।',
    'ai.action.proposal.approved': 'প্রস্তাব অনুমোদিত হয়েছে এবং প্রোফাইলে সংরক্ষিত হয়েছে।',
    'ai.action.proposal.conflicted':
      'অনুমোদিত হয়েছে, তবে এটি আগে নিশ্চিত করা একটি মানের সঙ্গে মেলে না, তাই পর্যালোচনার জন্য চিহ্নিত করা হয়েছে।',
    'ai.action.inconsistency.found.one':
      'এআই পর্যালোচনার জন্য {count}টি সম্ভাব্য অসঙ্গতি পেয়েছে।',
    'ai.action.inconsistency.found.other':
      'এআই পর্যালোচনার জন্য {count}টি সম্ভাব্য অসঙ্গতি পেয়েছে।',
    'ai.action.inconsistency.none':
      'এআই অসঙ্গতি যাচাই চালানো হয়েছে এবং চিহ্নিত করার মতো কিছু পায়নি।',
    'ai.action.flag.acknowledged': 'চিহ্নিত বিষয়টি জেনেছেন বলে রেকর্ড করা হয়েছে।',
    'ai.action.flag.dismissed': 'চিহ্নিত বিষয়টি বাদ দেওয়া হয়েছে।',
  },
);
