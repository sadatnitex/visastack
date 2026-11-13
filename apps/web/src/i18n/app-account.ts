import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-account surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appAccountCatalog = defineCatalog({
  en: {
    'appAccount.appAccountPage.account': 'Account',
    'appAccount.appAccountPage.agencyDesk': 'Agency Desk',
    'appAccount.appAccountPage.askAboutYourCasesFromWhatsapp':
      'Ask about your cases from WhatsApp. You can disconnect it any time.',
    'appAccount.appAccountPage.dataRights': 'Data Rights',
    'appAccount.appAccountPage.exportYourDataReviewConsentHistory':
      'Export your data, review consent history, or delete your account.',
    'appAccount.appAccountPage.language': 'Language',
    'appAccount.appAccountPage.openPlanUsage': 'Open Plan & Usage',
    'appAccount.appAccountPage.openPrivacy': 'Open Privacy',
    'appAccount.appAccountPage.openWhatsappSettings': 'Open WhatsApp Settings',
    'appAccount.appAccountPage.optional': 'Optional',
    'appAccount.appAccountPage.otherAreasYouCanAccess': 'Other Areas You Can Access',
    'appAccount.appAccountPage.plan': 'Plan',
    'appAccount.appAccountPage.planUsage': 'Plan & Usage',
    'appAccount.appAccountPage.platformAdministration': 'Platform Administration',
    'appAccount.appAccountPage.preferences': 'Preferences',
    'appAccount.appAccountPage.privacy': 'Privacy',
    'appAccount.appAccountPage.roles': 'Roles',
    'appAccount.appAccountPage.session': 'Session',
    'appAccount.appAccountPage.signOut': 'Sign Out',
    'appAccount.appAccountPage.signOutOfThisDevice': 'Sign out of this device.',
    'appAccount.appAccountPage.signedIn': 'Signed In',
    'appAccount.appAccountPage.whatsapp': 'WhatsApp',
    'appAccount.appAccountPage.yourAccount': 'Your Account',
    'appAccount.appAccountPage.yourPlanWhatItIncludesAnd':
      'Your plan, what it includes and how much of it you have used.',
    'appAccount.appAccountPlanBillingPage.account': 'Account',
    'appAccount.appAccountPlanBillingPage.amount': 'Amount',
    'appAccount.appAccountPlanBillingPage.billingHistory': 'Billing History',
    'appAccount.appAccountPlanBillingPage.downloadInvoicePdf': 'Download Invoice (PDF)',
    'appAccount.appAccountPlanBillingPage.downloadReceiptPdf': 'Download Receipt (PDF)',
    'appAccount.appAccountPlanBillingPage.formatmoneyOnFormatbillingdate':
      '{formatMoney} on {formatBillingDate}',
    'appAccount.appAccountPlanBillingPage.noPurchasesYet': 'No Purchases Yet',
    'appAccount.appAccountPlanBillingPage.paidOn': 'Paid On',
    'appAccount.appAccountPlanBillingPage.period': 'Period',
    'appAccount.appAccountPlanBillingPage.receiptNumber': 'Receipt {number}',
    'appAccount.appAccountPlanBillingPage.receipts': 'Receipts',
    'appAccount.appAccountPlanBillingPage.receiptsForInvoiceref': 'Receipts for {invoiceRef}',
    'appAccount.appAccountPlanBillingPage.refund': 'Refund',
    'appAccount.appAccountPlanBillingPage.whatYouBoughtWithAnInvoice':
      'What you bought, with an invoice and receipts you can download.',
    'appAccount.appAccountPlanBillingPage.whenYouBuyAPlanIts':
      'When you buy a plan, its invoice and receipt appear here. Nothing is charged without you paying for it.',
    'appAccount.appAccountPlanBillingPage.youCanAskForAFull':
      'You can ask for a full refund until {formatBillingDateTime} (Bangladesh time), and you do not need to give a reason. The period it paid for ends once the refund is made.',
    'appAccount.appAccountPlanPage.aiFeatures': 'AI Features',
    'appAccount.appAccountPlanPage.beforeYouPay': 'Before You Pay',
    'appAccount.appAccountPlanPage.comparePlans': 'Compare Plans',
    'appAccount.appAccountPlanPage.complimentaryDuringPublicBetaNoPayment':
      'Complimentary during public beta. No payment method is required. Fair-use safeguards and your privacy permissions still apply.',
    'appAccount.appAccountPlanPage.confirmYourPurchase': 'Confirm Your Purchase',
    'appAccount.appAccountPlanPage.coversYouFrom': 'Covers You From',
    'appAccount.appAccountPlanPage.coversYouUntil': 'Covers You Until',
    'appAccount.appAccountPlanPage.currentPlan': 'Current Plan',
    'appAccount.appAccountPlanPage.eachPersonYouKeepARecord':
      "Each person you keep a record for can hold up to {mbLabel}. When you share a record with an agency, that agency's own plan can also limit what more can be added to it.",
    'appAccount.appAccountPlanPage.everySavedVersionOfEveryDocument':
      'Every saved version of every document counts. Each file can be up to {uploadLimitLabel}.',
    'appAccount.appAccountPlanPage.everythingInVisastackStaysFreeDuring':
      'Everything in VisaStack stays free during the beta. A paid plan gives you more room: more storage and higher daily limits, for you and everyone you keep a record for. It is paid in advance and never charges you again by itself.',
    'appAccount.appAccountPlanPage.inYourPlan': 'In Your Plan',
    'appAccount.appAccountPlanPage.moreRoom': 'More Room',
    'appAccount.appAccountPlanPage.noAutomaticChargeWeRemindYou':
      'No automatic charge. We remind you before it ends, and you decide then whether to pay again.',
    'appAccount.appAccountPlanPage.notInYourPlan': 'Not in Your Plan',
    'appAccount.appAccountPlanPage.nothingStoredYet': 'Nothing stored yet.',
    'appAccount.appAccountPlanPage.now': 'Now:',
    'appAccount.appAccountPlanPage.paidPlansForTravellersAreNot':
      'Paid plans for travellers are not offered yet, so there is nothing to choose or upgrade.',
    'appAccount.appAccountPlanPage.paidUntilFormatbillingdateFairUseSafeguards':
      'Paid until {formatBillingDate}. Fair-use safeguards and your privacy permissions still apply.',
    'appAccount.appAccountPlanPage.price': 'Price',
    'appAccount.appAccountPlanPage.reference': 'Reference',
    'appAccount.appAccountPlanPage.renewNow': 'Renew Now',
    'appAccount.appAccountPlanPage.storage': 'Storage',
    'appAccount.appAccountPlanPage.storageForTheWholeAccount': 'Storage for the Whole Account',
    'appAccount.appAccountPlanPage.storagePerPerson': 'Storage per Person',
    'appAccount.appAccountPlanPage.travellerFreeAndThePaidPlans':
      'Traveller Free and the Paid Plans Side by Side',
    'appAccount.appAccountPlanPage.whatYouGet': 'What You Get',
    'appAccount.appAccountPlanPage.whatYourPlanIncludes': 'What Your Plan Includes',
    'appAccount.appAccountPlanPage.whetherYourPlanIncludesEachFeature':
      'Whether your plan includes each feature, whether it works right now, and how much you used it today. For this count, only the number is kept, never what was read. Everything in VisaStack works without these features.',
    'appAccount.appAccountPlanPage.youCanCompareItWithThe':
      'You can compare it with the paid plans below.',
    'appAccount.appAccountPlanPage.yourAccount': 'Your Account',
    'appAccount.appAccountPlanPage.yourPlan': 'Your Plan',
    'appAccount.appAccountPlanPage.yourWholeAccount': 'Your Whole Account',
    'appAccount.appAccountWhatsappConnectForm.iAgreeToReceiveMessagesFrom':
      'I agree to receive messages from VisaStack on WhatsApp about my cases. I can send STOP at any time.',
    'appAccount.appAccountWhatsappConnectForm.iHaveSentIt': 'I Have Sent It',
    'appAccount.appAccountWhatsappConnectForm.openWhatsapp': 'Open WhatsApp',
    'appAccount.appAccountWhatsappConnectForm.sendThisMessageFromTheWhatsapp':
      'Send this message from the WhatsApp you want to connect. The code works for 10 minutes and only once.',
    'appAccount.appAccountWhatsappPage.askAboutYourCasesFromWhatsapp':
      'Ask about your cases from WhatsApp. Everything else stays in VisaStack.',
    'appAccount.appAccountWhatsappPage.connectWhatsapp': 'Connect WhatsApp',
    'appAccount.appAccountWhatsappPage.connected': 'Connected',
    'appAccount.appAccountWhatsappPage.connectedOn': 'Connected On',
    'appAccount.appAccountWhatsappPage.disconnectWhatsapp': 'Disconnect WhatsApp',
    'appAccount.appAccountWhatsappPage.documentsAreAddedInVisastackNot':
      'Documents are added in VisaStack, not in chat, so they stay private and checked.',
    'appAccount.appAccountWhatsappPage.getAOneTimeCodeHere':
      'Get a one-time code here, then send it from your WhatsApp. Only you can connect it, because the code comes from your signed-in account.',
    'appAccount.appAccountWhatsappPage.messages': 'Messages',
    'appAccount.appAccountWhatsappPage.messagesPassThroughWhatsappWhichIs':
      'Messages pass through WhatsApp, which is run by Meta.',
    'appAccount.appAccountWhatsappPage.notConnected': 'Not Connected',
    'appAccount.appAccountWhatsappPage.number': 'Number',
    'appAccount.appAccountWhatsappPage.offSendStartToTurnThem': 'Off (send START to turn them on)',
    'appAccount.appAccountWhatsappPage.on': 'On',
    'appAccount.appAccountWhatsappPage.privacyAndConsent': 'Privacy and Consent',
    'appAccount.appAccountWhatsappPage.sendMenuInWhatsappToSee':
      'Send MENU in WhatsApp to see what you can ask. Send STOP to turn messages off.',
    'appAccount.appAccountWhatsappPage.visastackNeverAsksForPassportId':
      'VisaStack never asks for passport, ID or bank details in WhatsApp.',
    'appAccount.appAccountWhatsappPage.whatHappensInWhatsapp': 'What Happens in WhatsApp',
    'appAccount.appAccountWhatsappPage.whatsappIsNotAvailableYet': 'WhatsApp Is Not Available Yet',
    'appAccount.appAccountWhatsappPage.youCanAskWhereYourCases':
      'You can ask where your cases stand, what is missing and what expires soon.',
    'appAccount.appAccountWhatsappPage.youCanUseEverythingInVisastack':
      'You can use everything in VisaStack without WhatsApp.',
    'appAccount.appAccountWhatsappPage.yourWhatsappIsConnected': 'Your WhatsApp Is Connected',
  },
  bn: {
    'appAccount.appAccountPage.account': 'অ্যাকাউন্ট',
    'appAccount.appAccountPage.agencyDesk': 'এজেন্সি ডেস্ক',
    'appAccount.appAccountPage.askAboutYourCasesFromWhatsapp':
      'WhatsApp থেকে আপনার ভিসা ফাইল নিয়ে জিজ্ঞেস করুন। যেকোনো সময় সংযোগটি বিচ্ছিন্ন করতে পারেন।',
    'appAccount.appAccountPage.dataRights': 'তথ্যের অধিকার',
    'appAccount.appAccountPage.exportYourDataReviewConsentHistory':
      'আপনার তথ্য এক্সপোর্ট করুন, সম্মতির ইতিহাস পর্যালোচনা করুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।',
    'appAccount.appAccountPage.openPlanUsage': 'প্ল্যান ও ব্যবহার খুলুন',
    'appAccount.appAccountPage.openWhatsappSettings': 'WhatsApp সেটিংস খুলুন',
    'appAccount.appAccountPage.otherAreasYouCanAccess': 'আপনি অ্যাক্সেস করতে পারেন এমন অন্যান্য অংশ',
    'appAccount.appAccountPage.roles': 'ভূমিকা',
    'appAccount.appAccountPage.session': 'সেশন',
    'appAccount.appAccountPage.signOut': 'সাইন আউট করুন',
    'appAccount.appAccountPage.signOutOfThisDevice': 'এই ডিভাইস থেকে সাইন আউট করুন।',
    'appAccount.appAccountPage.signedIn': 'সাইন ইন করা আছে',
    'appAccount.appAccountPage.whatsapp': 'WhatsApp',
    'appAccount.appAccountPage.yourAccount': 'আপনার অ্যাকাউন্ট',
    'appAccount.appAccountPage.yourPlanWhatItIncludesAnd':
      'আপনার প্ল্যান, তাতে কী আছে এবং আপনি তার কতটা ব্যবহার করেছেন।',
    'appAccount.appAccountPlanBillingPage.account': 'অ্যাকাউন্ট',
    'appAccount.appAccountPlanBillingPage.amount': 'পরিমাণ',
    'appAccount.appAccountPlanBillingPage.billingHistory': 'বিলিংয়ের ইতিহাস',
    'appAccount.appAccountPlanBillingPage.downloadReceiptPdf': 'রসিদ ডাউনলোড করুন (PDF)',
    'appAccount.appAccountPlanBillingPage.noPurchasesYet': 'এখনো কোনো কেনাকাটা নেই',
    'appAccount.appAccountPlanBillingPage.receipts': 'রসিদ',
    'appAccount.appAccountPlanBillingPage.receiptsForInvoiceref': '{invoiceRef}-এর রসিদ',
    'appAccount.appAccountPlanBillingPage.refund': 'রিফান্ড',
    'appAccount.appAccountPlanBillingPage.whatYouBoughtWithAnInvoice':
      'আপনি যা কিনেছেন, সঙ্গে ডাউনলোড করার মতো ইনভয়েস ও রসিদ।',
    'appAccount.appAccountPlanBillingPage.whenYouBuyAPlanIts':
      'আপনি কোনো প্ল্যান কিনলে তার ইনভয়েস ও রসিদ এখানে দেখা যাবে। আপনি নিজে পেমেন্ট না করলে কোনো চার্জ নেওয়া হয় না।',
    'appAccount.appAccountPlanPage.aiFeatures': 'এআই সুবিধা',
    'appAccount.appAccountPlanPage.beforeYouPay': 'পেমেন্ট করার আগে',
    'appAccount.appAccountPlanPage.comparePlans': 'প্ল্যানগুলো তুলনা করুন',
    'appAccount.appAccountPlanPage.complimentaryDuringPublicBetaNoPayment':
      'পাবলিক বিটা চলাকালে বিনামূল্যে। কোনো পেমেন্ট পদ্ধতি লাগে না। ন্যায্য ব্যবহারের সুরক্ষা এবং আপনার গোপনীয়তার অনুমতি এখনও প্রযোজ্য।',
    'appAccount.appAccountPlanPage.confirmYourPurchase': 'আপনার কেনাকাটা নিশ্চিত করুন',
    'appAccount.appAccountPlanPage.coversYouFrom': 'যে তারিখ থেকে কার্যকর',
    'appAccount.appAccountPlanPage.coversYouUntil': 'যে তারিখ পর্যন্ত কার্যকর',
    'appAccount.appAccountPlanPage.currentPlan': 'বর্তমান প্ল্যান',
    'appAccount.appAccountPlanPage.everythingInVisastackStaysFreeDuring':
      'বিটা চলাকালে VisaStack-এর সবকিছু বিনামূল্যে থাকছে। পেইড প্ল্যানে আপনি আরও জায়গা পান: বেশি স্টোরেজ ও বেশি দৈনিক সীমা, আপনার নিজের এবং যাঁদের রেকর্ড আপনি রাখেন তাঁদের সবার জন্য। এর দাম আগে দিতে হয়, আর এটি নিজে থেকে কখনো আবার চার্জ করে না।',
    'appAccount.appAccountPlanPage.inYourPlan': 'আপনার প্ল্যানে আছে',
    'appAccount.appAccountPlanPage.moreRoom': 'আরও জায়গা',
    'appAccount.appAccountPlanPage.noAutomaticChargeWeRemindYou':
      'স্বয়ংক্রিয়ভাবে কোনো চার্জ নেই। মেয়াদ শেষ হওয়ার আগে আমরা আপনাকে মনে করিয়ে দিই, তখন আপনি ঠিক করবেন আবার পেমেন্ট করবেন কি না।',
    'appAccount.appAccountPlanPage.notInYourPlan': 'আপনার প্ল্যানে নেই',
    'appAccount.appAccountPlanPage.nothingStoredYet': 'এখনো কিছু রাখা হয়নি।',
    'appAccount.appAccountPlanPage.now': 'এখন:',
    'appAccount.appAccountPlanPage.paidPlansForTravellersAreNot':
      'ভ্রমণকারীদের জন্য পেইড প্ল্যান এখনও দেওয়া হচ্ছে না, তাই বেছে নেওয়ার বা আপগ্রেড করার কিছু নেই।',
    'appAccount.appAccountPlanPage.price': 'দাম',
    'appAccount.appAccountPlanPage.renewNow': 'এখনই নবায়ন করুন',
    'appAccount.appAccountPlanPage.storage': 'স্টোরেজ',
    'appAccount.appAccountPlanPage.storageForTheWholeAccount': 'পুরো অ্যাকাউন্টের স্টোরেজ',
    'appAccount.appAccountPlanPage.storagePerPerson': 'প্রতিজনের স্টোরেজ',
    'appAccount.appAccountPlanPage.travellerFreeAndThePaidPlans':
      'ভ্রমণকারীর ফ্রি প্ল্যান ও পেইড প্ল্যানগুলো পাশাপাশি',
    'appAccount.appAccountPlanPage.whatYouGet': 'আপনি যা পাবেন',
    'appAccount.appAccountPlanPage.whatYourPlanIncludes': 'আপনার প্ল্যানে যা আছে',
    'appAccount.appAccountPlanPage.whetherYourPlanIncludesEachFeature':
      'আপনার প্ল্যানে প্রতিটি সুবিধা আছে কি না, এখন তা কাজ করছে কি না, এবং আজ আপনি কতটা ব্যবহার করেছেন। এই গণনার জন্য শুধু সংখ্যাটি রাখা হয়, কী পড়া হয়েছে তা কখনো নয়। এই সুবিধাগুলো ছাড়াও VisaStack-এর সবকিছু কাজ করে।',
    'appAccount.appAccountPlanPage.youCanCompareItWithThe':
      'নিচের পেইড প্ল্যানগুলোর সঙ্গে এটি তুলনা করতে পারেন।',
    'appAccount.appAccountPlanPage.yourAccount': 'আপনার অ্যাকাউন্ট',
    'appAccount.appAccountPlanPage.yourPlan': 'আপনার প্ল্যান',
    'appAccount.appAccountPlanPage.yourWholeAccount': 'আপনার পুরো অ্যাকাউন্ট',
    'appAccount.appAccountWhatsappConnectForm.iAgreeToReceiveMessagesFrom':
      'আমি আমার ভিসা ফাইল সম্পর্কে WhatsApp-এ VisaStack থেকে বার্তা পেতে রাজি। যেকোনো সময় আমি STOP পাঠাতে পারি।',
    'appAccount.appAccountWhatsappConnectForm.iHaveSentIt': 'আমি পাঠিয়ে দিয়েছি',
    'appAccount.appAccountWhatsappConnectForm.openWhatsapp': 'WhatsApp খুলুন',
    'appAccount.appAccountWhatsappConnectForm.sendThisMessageFromTheWhatsapp':
      'যে WhatsApp নম্বরটি যুক্ত করতে চান, সেখান থেকে এই বার্তাটি পাঠান। কোডটি ১০ মিনিট কাজ করে এবং শুধু একবার ব্যবহার করা যায়।',
    'appAccount.appAccountWhatsappPage.askAboutYourCasesFromWhatsapp':
      'WhatsApp থেকে আপনার ভিসা ফাইল নিয়ে জিজ্ঞেস করুন। বাকি সবকিছু VisaStack-এই থাকে।',
    'appAccount.appAccountWhatsappPage.connectWhatsapp': 'WhatsApp সংযুক্ত করুন',
    'appAccount.appAccountWhatsappPage.connected': 'সংযুক্ত',
    'appAccount.appAccountWhatsappPage.connectedOn': 'সংযুক্ত করার তারিখ',
    'appAccount.appAccountWhatsappPage.disconnectWhatsapp': 'WhatsApp বিচ্ছিন্ন করুন',
    'appAccount.appAccountWhatsappPage.documentsAreAddedInVisastackNot':
      'ডকুমেন্ট চ্যাটে নয়, VisaStack-এ যোগ করা হয়, তাই সেগুলো গোপন থাকে এবং পরীক্ষা করা হয়।',
    'appAccount.appAccountWhatsappPage.getAOneTimeCodeHere':
      'এখানে একটি এককালীন কোড নিন, তারপর আপনার WhatsApp থেকে সেটি পাঠান। কোডটি আপনার সাইন ইন করা অ্যাকাউন্ট থেকে আসে, তাই শুধু আপনিই এটি সংযুক্ত করতে পারেন।',
    'appAccount.appAccountWhatsappPage.messages': 'মেসেজ',
    'appAccount.appAccountWhatsappPage.messagesPassThroughWhatsappWhichIs':
      'মেসেজ WhatsApp-এর মাধ্যমে যায়, যা Meta পরিচালনা করে।',
    'appAccount.appAccountWhatsappPage.notConnected': 'সংযুক্ত নয়',
    'appAccount.appAccountWhatsappPage.number': 'নম্বর',
    'appAccount.appAccountWhatsappPage.offSendStartToTurnThem': 'বন্ধ (চালু করতে START পাঠান)',
    'appAccount.appAccountWhatsappPage.on': 'চালু',
    'appAccount.appAccountWhatsappPage.privacyAndConsent': 'গোপনীয়তা ও সম্মতি',
    'appAccount.appAccountWhatsappPage.sendMenuInWhatsappToSee':
      'কী জিজ্ঞেস করা যায় তা দেখতে WhatsApp-এ MENU পাঠান। বার্তা বন্ধ করতে STOP পাঠান।',
    'appAccount.appAccountWhatsappPage.visastackNeverAsksForPassportId':
      'VisaStack কখনো WhatsApp-এ পাসপোর্ট, আইডি বা ব্যাংকের তথ্য চায় না।',
    'appAccount.appAccountWhatsappPage.whatHappensInWhatsapp': 'WhatsApp-এ কী হয়',
    'appAccount.appAccountWhatsappPage.whatsappIsNotAvailableYet': 'WhatsApp এখনো চালু হয়নি',
    'appAccount.appAccountWhatsappPage.youCanAskWhereYourCases':
      'আপনার ভিসা ফাইলগুলো কোন অবস্থায় আছে, কী বাকি আছে এবং কোনটির মেয়াদ শিগগিরই শেষ হবে, তা জিজ্ঞেস করতে পারেন।',
    'appAccount.appAccountWhatsappPage.youCanUseEverythingInVisastack':
      'WhatsApp ছাড়াই আপনি VisaStack-এর সবকিছু ব্যবহার করতে পারেন।',
    'appAccount.appAccountWhatsappPage.yourWhatsappIsConnected': 'আপনার WhatsApp সংযুক্ত আছে',
  },
});
