import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the home surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const homeCatalog = defineCatalog({
  en: {
    'home.countryChecklistPicker.continueWithName': 'Continue With {name}',
    'home.countryChecklistPicker.createFreeAccountForName': 'Create Free Account for {name}',
    'home.countryChecklistPicker.forAnOrdinaryBangladeshiPassportThis':
      'For an ordinary Bangladeshi passport. This is a list of what is usually asked for. It is not a decision and not a promise. Rules change, so confirm on the official page before you apply.',
    'home.countryChecklistPicker.forExampleJapan': 'For example: Japan',
    'home.countryChecklistPicker.needsChecking': 'Needs Checking',
    'home.countryChecklistPicker.openTheOfficialPage': 'Open the Official Page',
    'home.countryChecklistPicker.optional': '(optional)',
    'home.countryChecklistPicker.signInToStartWithName': 'Sign In to Start With {name}',
    'home.countryChecklistPicker.thisListMayNotBeComplete':
      'This list may not be complete. Check the official page for everything you need to submit.',
    'home.countryChecklistPicker.typeANameOrOpenThe':
      'Type a name or open the list. Checklists are ready for {withChecklist} of {length} countries today. For the rest we point you to the official page.',
    'home.countryChecklistPicker.visaType': 'Visa Type',
    'home.countryChecklistPicker.weKeepYourCountryForThe':
      'We keep your country for the next step, so your checklist is waiting.',
    'home.countryChecklistPicker.whichCountryDoYouWantTo': 'Which Country Do You Want to Visit?',
    'home.countryChecklistPicker.yourChecklistAppearsHereAsSoon':
      'Your checklist appears here as soon as you pick a country.',
    'home.error.backToHome': 'Back to Home',
    'home.error.referenceDigest': 'Reference: {digest}',
    'home.error.somethingWentWrong': 'Something Went Wrong',
    'home.error.thisIsOnOurSideNot':
      'This is on our side, not yours. Everything you already saved is safe. If you were typing something, you may need to enter it again. Try again in a moment; if it keeps happening, sign out and back in.',
    'home.error.tryAgain': 'Try Again',
    'home.error.weHitASnagLoadingThis': 'We hit a snag loading this page',
    'home.layout.aboutThisVersion': 'About This Version',
    'home.layout.footer': 'Footer',
    'home.layout.footerAbout': 'One private profile for every visa.',
    'home.layout.footerAccount': 'Account',
    'home.layout.footerTrust': 'Trust',
    'home.layout.getStarted': 'Get Started',
    'home.layout.getfullyearVisastackProprietaryAndConfidential':
      '© {getFullYear} VisaStack. Proprietary and confidential.',
    'home.layout.language': 'Language',
    'home.layout.noticePilot': 'VisaStack Private Pilot',
    'home.layout.noticePilotShort': 'Test version. Made-up details only.',
    'home.layout.footerAsIs': 'Provided as is during the public beta.',
    'home.layout.noticePublicBeta': 'VisaStack Public Beta',
    'home.layout.privacy': 'Privacy',
    'home.layout.privacyAndControl': 'Privacy and Control',
    'home.layout.product': 'Product',
    'home.layout.publicTrust': 'Public Trust',
    'home.layout.skipToContent': 'Skip to Content',
    'home.layout.status': 'Status',
    'home.layout.terms': 'Terms',
    'home.layout.workspace': 'Workspace',
    'home.page.aCleanFile': 'A clean file',
    'home.page.createYourFreeAccount': 'Create your free account',
    'home.page.forAgencies': 'For Agencies',
    'home.page.freePublicBeta': 'Free Public Beta',
    'home.page.howItWorks': 'How It Works',
    'home.page.inviteOnlyPilot': 'Invite-Only Pilot',
    'home.page.itIsFreeToUseAt':
      'It is free to use. The status page shows exactly what works today.',
    'home.page.openYourWorkspace': 'Open your workspace',
    'home.page.pleaseUseMadeUpDetailsOr':
      'Please use made-up details, or documents with all personal information permanently blacked out. Real applicant details are not accepted yet.',
    'home.page.registrationIsOpenForPublicBeta':
      'Registration is open for public beta, and some features are not switched on yet.',
    'home.page.seeWhatWorksToday': 'See What Works Today',
    'home.page.signInDidnTCompletePlease':
      'Sign-in didn’t complete. Please try again. If it keeps happening, contact support and quote reference',
    'home.page.signInToGetStarted': 'Sign in to get started',
    'home.page.thisIsAPrivatePilotFor':
      'This is a private pilot for invited users, and some features are not switched on yet.',
    'home.page.whatWorksToday': 'What Works Today',
    'home.phone.seeAll': 'See All {count}',
    'home.phone.showFewer': 'Show Fewer',
  },
  bn: {
    'home.countryChecklistPicker.forExampleJapan': 'যেমন: জাপান',
    'home.countryChecklistPicker.needsChecking': 'পরীক্ষা করা দরকার',
    'home.countryChecklistPicker.optional': '(ঐচ্ছিক)',
    'home.countryChecklistPicker.whichCountryDoYouWantTo': 'কোন দেশে যেতে চান?',
    'home.countryChecklistPicker.yourChecklistAppearsHereAsSoon':
      'দেশ বেছে নিলেই আপনার চেকলিস্ট এখানে দেখা যাবে।',
    'home.error.backToHome': 'হোমে ফিরে যান',
    'home.error.thisIsOnOurSideNot':
      'এটি আমাদের দিকের সমস্যা, আপনার নয়। আপনি আগে যা সংরক্ষণ করেছেন তা নিরাপদ আছে। কিছু লিখতে থাকলে হয়তো আবার লিখতে হতে পারে। একটু পরে আবার চেষ্টা করুন; সমস্যা চলতে থাকলে সাইন আউট করে আবার সাইন ইন করুন।',
    'home.layout.aboutThisVersion': 'এই সংস্করণ সম্পর্কে',
    'home.layout.footer': 'ফুটার',
    'home.layout.footerAbout': 'প্রতিটি ভিসার জন্য একটি ব্যক্তিগত প্রোফাইল।',
    'home.layout.footerAccount': 'অ্যাকাউন্ট',
    'home.layout.footerTrust': 'আস্থা',
    'home.layout.getStarted': 'শুরু করুন',
    'home.layout.getfullyearVisastackProprietaryAndConfidential':
      '© {getFullYear} VisaStack। মালিকানাধীন ও গোপনীয়।',
    'home.layout.language': 'ভাষা',
    'home.layout.noticePilot': 'VisaStack প্রাইভেট পাইলট',
    'home.layout.noticePilotShort': 'পরীক্ষামূলক সংস্করণ। শুধু বানানো তথ্য।',
    'home.layout.noticePublicBeta': 'VisaStack পাবলিক বিটা',
    'home.layout.privacy': 'গোপনীয়তা',
    'home.layout.privacyAndControl': 'গোপনীয়তা ও নিয়ন্ত্রণ',
    'home.layout.product': 'প্রোডাক্ট',
    'home.layout.skipToContent': 'মূল বিষয়বস্তুতে যান',
    'home.layout.terms': 'শর্তাবলি',
    'home.layout.workspace': 'ওয়ার্কস্পেস',
    'home.page.aCleanFile': 'একটি গোছানো ভিসা ফাইল',
    'home.page.forAgencies': 'এজেন্সির জন্য',
    'home.page.howItWorks': 'এটি যেভাবে কাজ করে',
    'home.page.inviteOnlyPilot': 'শুধু আমন্ত্রিতদের জন্য পাইলট',
    'home.page.pleaseUseMadeUpDetailsOr':
      'অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যাতে সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে। আসল আবেদনকারীর তথ্য এখনো গ্রহণ করা হয় না।',
    'home.page.seeWhatWorksToday': 'আজ কী কাজ করছে তা দেখুন',
    'home.page.signInToGetStarted': 'শুরু করতে সাইন ইন করুন',
    'home.page.whatWorksToday': 'আজ যা কাজ করছে',
    'home.phone.seeAll': 'সব {count}টি দেখুন',
    'home.phone.showFewer': 'কম দেখান',
  },
});
