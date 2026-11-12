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
    'appAccount.appAccountPage.session': 'সেশন',
    'appAccount.appAccountPage.signOut': 'সাইন আউট করুন',
    'appAccount.appAccountPage.signOutOfThisDevice': 'এই ডিভাইস থেকে সাইন আউট করুন।',
    'appAccount.appAccountPage.signedIn': 'সাইন ইন করা আছে',
    'appAccount.appAccountPage.yourAccount': 'আপনার অ্যাকাউন্ট',
    'appAccount.appAccountPlanPage.storage': 'স্টোরেজ',
    'appAccount.appAccountPlanPage.yourAccount': 'আপনার অ্যাকাউন্ট',
    'appAccount.appAccountPlanPage.yourWholeAccount': 'আপনার পুরো অ্যাকাউন্ট',
    'appAccount.appAccountWhatsappConnectForm.iHaveSentIt': 'আমি পাঠিয়ে দিয়েছি',
    'appAccount.appAccountWhatsappPage.on': 'চালু',
  },
});
