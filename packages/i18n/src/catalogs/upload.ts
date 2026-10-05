import { defineCatalog } from '../catalog';

/**
 * Upload: what a traveller is told about adding a document and about what became
 * of it, from "uploading" to "ready" or "quarantined", and the vault page that
 * lists the documents. The safety wording (scanned, quarantined, structural
 * validation, stored privately) must say exactly what happened and no more, so
 * its Bangla needs a security review.
 *
 * AI suggestions about a document live in `aiReview`; the consent statements
 * shown before they can be used live in `consent`.
 */
export const upload = defineCatalog(
  { id: 'upload', review: ['SECURITY'] },
  {
    'document.scanning': 'This document is being scanned for safety.',
    'document.quarantined': 'This document was flagged and needs attention.',
    'document.status.clean': 'Clean',
    'document.status.pending': 'Pending',
    'document.status.scanning': 'Scanning',
    'document.status.quarantined': 'Quarantined',
    'document.processing.uploading': 'Uploading',
    'document.processing.quarantined': 'In quarantine',
    'document.processing.scanning': 'Scanning',
    'document.processing.normalizing': 'Structural validation',
    'document.processing.extracting': 'Processing',
    'document.processing.awaitingReview': 'Needs review',
    'document.processing.ready': 'Ready',
    'document.processing.needsAttention': 'Needs attention',
    'document.processing.failed': 'Failed',
    'document.processing.rejected': 'Rejected',

    // The upload card and the form in it.
    'upload.card.kicker': 'Upload',
    'upload.card.title': 'Add a document',
    'upload.card.body':
      'Documents are stored privately and pass a structural safety scan before they can be previewed.',
    'upload.storage.label': 'Evidence storage',
    'upload.storage.used': '{used} MB of {limit} MB used',
    'upload.field.label': 'Document file',
    'upload.action.upload': 'Upload document',
    'upload.action.uploading': 'Uploading…',
    'upload.help': 'PDF, PNG, JPEG, DOCX, TXT or MD · up to {limit} MB · scanned for safety on upload.',

    // The vault: the list of documents.
    'upload.vault.kicker': 'Document Vault',
    'upload.vault.count.one': '{count} document',
    'upload.vault.count.other': '{count} documents',
    'upload.vault.empty': 'No documents yet.',
    'upload.preview.error':
      "Couldn't open that preview - the document may no longer be available. Please try again.",
    'upload.date.error':
      "Couldn't save that date - enter a valid date that isn't in the future.",
    'upload.lifecycle.current': 'Current',
    'upload.lifecycle.expiring': 'Expiring soon',
    'upload.lifecycle.expired': 'Expired',
    'upload.lifecycle.superseded': 'Superseded',
    'upload.usedIn': 'Used in {list}',
    'upload.sharedWith': 'Shared with {list}',
    'upload.date.label': 'Document date',
    'upload.date.help': 'Used to judge freshness for routes that require recently-dated evidence.',

    // What an issuer confirmed about a document.
    'upload.issuer.summary.one': '{count} issuer confirmation',
    'upload.issuer.summary.other': '{count} issuer confirmations',
    'upload.issuer.expired': '(expired)',
    'upload.issuer.expiresIn.one': '(expires in {count} day)',
    'upload.issuer.expiresIn.other': '(expires in {count} days)',
    'upload.issuer.line': '{issuer}: "{claim}", response: {response}, valid until {date}',

    // Reviewing the filename the system proposed.
    'upload.name.original': 'Original: {name}',
    'upload.name.classified': '{type} ({confidence}% confidence)',
    'upload.name.input': 'Proposed filename',
    'upload.name.needsReview':
      'Automatic classification needs review: it was not confident enough to propose a name.',
    'upload.docType.PASSPORT': 'Passport',
    'upload.docType.BANK_STATEMENT': 'Bank Statement',
    'upload.docType.EMPLOYMENT_CERTIFICATE': 'Employment Certificate',

    // The result of an upload or of a decision about a filename.
    'upload.action.chooseFile': 'Choose a file to upload.',
    'upload.action.changed': 'Upload failed: the file changed while uploading.',
    'upload.action.storeFailed': 'Upload failed while storing the file. Please try again.',
    'upload.action.verifyFailed': 'Upload failed verification. Please try again.',
    'upload.action.unexpected': 'Upload failed unexpectedly. Please try again.',
    'upload.action.done': '{name} uploaded and queued for a safety scan.',
    'upload.action.duplicate': 'This looks identical to {names}, already in the vault.',
    'upload.action.nameRequired': 'Enter a filename before approving.',
    'upload.action.nameApproved': 'Filename approved.',
    'upload.action.nameRejected': 'Naming proposal rejected.',

    // Why an upload was refused: the limits a traveller can reach.
    'upload.quota.file': 'File exceeds the {limit} MB upload limit.',
    'upload.quota.applicant': 'This applicant has reached its {limit} MB evidence limit.',
    'upload.quota.account': 'This account has reached its {limit} MB evidence limit.',
    'upload.quota.platform':
      'Platform storage capacity reached. New uploads are temporarily paused.',
    'upload.quota.orgBilling':
      'An organization with access to this applicant has suspended billing, so new uploads cannot be added until it is resolved.',
    'upload.quota.orgStorage':
      'An organization with access to this applicant has reached its {limit} MB plan storage limit.',
  },
  {
    'document.scanning': 'নিরাপত্তার জন্য এই নথিটি স্ক্যান করা হচ্ছে।',
    'document.quarantined': 'এই নথিটি চিহ্নিত করা হয়েছে এবং মনোযোগ প্রয়োজন।',
    'document.status.clean': 'পরিষ্কার',
    'document.status.pending': 'মুলতুবি',
    'document.status.scanning': 'স্ক্যান করা হচ্ছে',
    'document.status.quarantined': 'চিহ্নিত',
    'document.processing.uploading': 'আপলোড হচ্ছে',
    'document.processing.quarantined': 'কোয়ারেন্টাইনে',
    'document.processing.scanning': 'স্ক্যান করা হচ্ছে',
    'document.processing.normalizing': 'কাঠামোগত যাচাই',
    'document.processing.extracting': 'প্রক্রিয়াকরণ হচ্ছে',
    'document.processing.awaitingReview': 'পর্যালোচনা প্রয়োজন',
    'document.processing.ready': 'প্রস্তুত',
    'document.processing.needsAttention': 'মনোযোগ প্রয়োজন',
    'document.processing.failed': 'ব্যর্থ হয়েছে',
    'document.processing.rejected': 'প্রত্যাখ্যাত',

    'upload.card.kicker': 'আপলোড',
    'upload.card.title': 'একটি নথি যোগ করুন',
    'upload.card.body':
      'নথি ব্যক্তিগতভাবে সংরক্ষিত হয় এবং প্রিভিউ করার আগে কাঠামোগত নিরাপত্তা স্ক্যানের মধ্য দিয়ে যায়।',
    'upload.storage.label': 'প্রমাণ সংরক্ষণের জায়গা',
    'upload.storage.used': '{limit} এমবির মধ্যে {used} এমবি ব্যবহৃত',
    'upload.field.label': 'নথির ফাইল',
    'upload.action.upload': 'নথি আপলোড করুন',
    'upload.action.uploading': 'আপলোড হচ্ছে…',
    'upload.help':
      'PDF, PNG, JPEG, DOCX, TXT বা MD · সর্বোচ্চ {limit} এমবি · আপলোডের সময় নিরাপত্তার জন্য স্ক্যান করা হয়।',

    'upload.vault.kicker': 'নথি ভান্ডার',
    'upload.vault.count.one': '{count}টি নথি',
    'upload.vault.count.other': '{count}টি নথি',
    'upload.vault.empty': 'এখনও কোনো নথি নেই।',
    'upload.preview.error':
      'প্রিভিউ খোলা যায়নি। নথিটি হয়তো আর পাওয়া যাচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'upload.date.error': 'তারিখটি সংরক্ষণ করা যায়নি। এমন একটি সঠিক তারিখ দিন যা ভবিষ্যতের নয়।',
    'upload.lifecycle.current': 'বর্তমান',
    'upload.lifecycle.expiring': 'মেয়াদ শীঘ্রই শেষ হচ্ছে',
    'upload.lifecycle.expired': 'মেয়াদ শেষ',
    'upload.lifecycle.superseded': 'প্রতিস্থাপিত',
    'upload.usedIn': 'যেসব কেসে ব্যবহৃত: {list}',
    'upload.sharedWith': 'যাদের সঙ্গে শেয়ার করা হয়েছে: {list}',
    'upload.date.label': 'নথির তারিখ',
    'upload.date.help':
      'যেসব রুটে সাম্প্রতিক তারিখের প্রমাণ লাগে, সেখানে নথিটি কতটা নতুন তা বিচার করতে এটি কাজে লাগে।',

    'upload.issuer.summary.one': '{count}টি ইস্যুকারীর নিশ্চিতকরণ',
    'upload.issuer.summary.other': '{count}টি ইস্যুকারীর নিশ্চিতকরণ',
    'upload.issuer.expired': '(মেয়াদ শেষ)',
    'upload.issuer.expiresIn.one': '({count} দিনের মধ্যে মেয়াদ শেষ হবে)',
    'upload.issuer.expiresIn.other': '({count} দিনের মধ্যে মেয়াদ শেষ হবে)',
    'upload.issuer.line': '{issuer}: "{claim}", প্রতিক্রিয়া: {response}, মেয়াদ: {date} পর্যন্ত',

    'upload.name.original': 'মূল নাম: {name}',
    'upload.name.classified': '{type} ({confidence}% নিশ্চিত)',
    'upload.name.input': 'প্রস্তাবিত ফাইলের নাম',
    'upload.name.needsReview':
      'স্বয়ংক্রিয় শ্রেণিবিন্যাসের পর্যালোচনা দরকার: নাম প্রস্তাব করার মতো যথেষ্ট নিশ্চিত হওয়া যায়নি।',
    'upload.docType.PASSPORT': 'পাসপোর্ট',
    'upload.docType.BANK_STATEMENT': 'ব্যাংক স্টেটমেন্ট',
    'upload.docType.EMPLOYMENT_CERTIFICATE': 'চাকরির সনদপত্র',

    'upload.action.chooseFile': 'আপলোড করার জন্য একটি ফাইল বেছে নিন।',
    'upload.action.changed': 'আপলোড ব্যর্থ হয়েছে: আপলোডের সময় ফাইলটি বদলে গেছে।',
    'upload.action.storeFailed':
      'ফাইল সংরক্ষণের সময় আপলোড ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'upload.action.verifyFailed': 'আপলোডের যাচাই ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'upload.action.unexpected': 'আপলোড অপ্রত্যাশিতভাবে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'upload.action.done': '{name} আপলোড হয়েছে এবং নিরাপত্তা স্ক্যানের জন্য সারিতে রাখা হয়েছে।',
    'upload.action.duplicate':
      'ভান্ডারে আগে থেকেই থাকা এই নথিগুলোর সঙ্গে এটি হুবহু একই মনে হচ্ছে: {names}।',
    'upload.action.nameRequired': 'অনুমোদনের আগে একটি ফাইলের নাম লিখুন।',
    'upload.action.nameApproved': 'ফাইলের নাম অনুমোদিত হয়েছে।',
    'upload.action.nameRejected': 'নামের প্রস্তাব প্রত্যাখ্যান করা হয়েছে।',

    'upload.quota.file': 'ফাইলটি {limit} এমবি আপলোড সীমা ছাড়িয়ে গেছে।',
    'upload.quota.applicant': 'এই আবেদনকারীর {limit} এমবি প্রমাণ সংরক্ষণের সীমা পূর্ণ হয়ে গেছে।',
    'upload.quota.account': 'এই অ্যাকাউন্টের {limit} এমবি প্রমাণ সংরক্ষণের সীমা পূর্ণ হয়ে গেছে।',
    'upload.quota.platform':
      'প্ল্যাটফর্মের সংরক্ষণ ক্ষমতা পূর্ণ হয়ে গেছে। নতুন আপলোড সাময়িকভাবে বন্ধ আছে।',
    'upload.quota.orgBilling':
      'এই আবেদনকারীর তথ্যে অ্যাক্সেস থাকা একটি প্রতিষ্ঠানের বিলিং স্থগিত থাকায় সমাধান না হওয়া পর্যন্ত নতুন আপলোড করা যাবে না।',
    'upload.quota.orgStorage':
      'এই আবেদনকারীর তথ্যে অ্যাক্সেস থাকা একটি প্রতিষ্ঠানের প্ল্যানের {limit} এমবি সংরক্ষণ সীমা পূর্ণ হয়ে গেছে।',
  },
);
