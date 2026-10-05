import { defineCatalog } from '../catalog';

/**
 * The frame around every page: the site header and footer, the signed-in
 * navigation, the applicant's section tabs, the pilot banner, the error and
 * not-found pages, and the generic messages a failed action falls back to.
 * Ordinary interface copy; nothing legal turns on these words.
 */
export const shell = defineCatalog(
  { id: 'shell', review: [] },
  {
    // The browser tab and the title a screen reader announces for the page.
    'shell.meta.title': 'VisaStack - one profile, every visa',

    // Site header and footer.
    'shell.skipToContent': 'Skip to content',
    'shell.language': 'Language',
    'shell.nav.platform': 'Platform',
    'shell.nav.publicTrust': 'Public trust',
    'shell.nav.status': 'Status',
    'nav.signIn': 'Sign in',
    'nav.workspace': 'Workspace',
    'shell.footer.rights': '© {year} VisaStack. Proprietary and confidential.',
    'shell.footer.hosting': 'Built remote-first on Vercel + Neon.',

    // Pilot banner (shown only while the deployment is a pilot or a preview).
    'shell.pilot.label': 'VisaStack Controlled Pilot',
    'shell.pilot.detail':
      'Internal controlled pilot. Use synthetic or irreversibly redacted information only.',
    'shell.preview.label': 'VisaStack Development Preview',
    'shell.preview.detail': 'Development/preview build. Not for real applicant data.',
    'shell.pilot.whatsLive': "What's live",

    // Signed-in navigation.
    'shell.app.overview': 'Overview',
    'shell.app.applicants': 'Applicants',
    'shell.app.shared': 'Shared with me',
    'shell.app.alerts': 'Alerts',
    'shell.app.privacy': 'Privacy',
    'shell.app.account': 'Account',
    'shell.app.agency': 'Agency',
    'shell.app.admin': 'Admin',
    'shell.app.signOut': 'Sign out',
    'shell.nav.primary': 'Primary',

    // One applicant's section tabs.
    'shell.applicant.eyebrow': 'Applicant',
    'shell.applicant.navLabel': 'Applicant sections',
    'shell.applicant.overview': 'Overview',
    'shell.applicant.profile': 'Profile',
    'shell.applicant.documents': 'Documents',
    'shell.applicant.cases': 'Cases',
    'shell.applicant.sharing': 'Sharing',
    'shell.applicant.evidence': 'Evidence',
    'shell.applicant.expiry': 'Expiry',
    'shell.applicant.history': 'History',

    // Loading.
    'shell.loading': 'Loading…',

    // Not-found page.
    'error.notFound.title': 'Page not found',
    'shell.notFound.eyebrow': 'Not found',
    'shell.notFound.heading': "We couldn't find that page",
    'shell.notFound.body':
      'The link may be out of date, or the record may have been removed or revoked. Check the address, or head back to your workspace.',
    'shell.notFound.workspace': 'Go to workspace',

    // What a failed action says when the reason is not one of the specific messages below.
    'error.code.forbidden': 'You do not have permission to do this.',
    'error.code.step_up_required': 'Please confirm your identity again to continue.',
    'error.code.not_found': 'We could not find what you asked for.',
    'error.code.consent_required': 'Consent is required before we can continue.',
    'error.code.unknown_field':
      'Something you entered could not be accepted. Check it and try again.',
    'error.code.invalid': 'Something you entered could not be accepted. Check it and try again.',
    'error.code.upstream_error':
      'A service we depend on is not responding. Please try again in a moment.',
    'error.code.rate_limited': 'Too many attempts. Please wait a moment and try again.',
    'error.code.encryption_unavailable':
      'This action is not available right now. Please try again later.',
    'error.code.stale': 'This page is out of date. Reload it and try again.',
    'error.code.unknown': 'Something went wrong. Please try again.',
    'error.stepUpNotConfigured':
      'This action requires step-up verification, which is not configured in this environment.',

    // Shown on screens whose Bangla text is still waiting for a professional review.
    'shell.translationNotice':
      'The professional legal review of this Bangla translation is not finished yet. If anything is unclear, check the English version.',
  },
  {
    'shell.meta.title': 'VisaStack - একটি প্রোফাইল, সব ভিসা',

    'shell.skipToContent': 'মূল বিষয়বস্তুতে যান',
    'shell.language': 'ভাষা',
    'shell.nav.platform': 'প্ল্যাটফর্ম',
    'shell.nav.publicTrust': 'প্রকাশ্য আস্থা-তথ্য',
    'shell.nav.status': 'সিস্টেমের অবস্থা',
    'nav.signIn': 'সাইন ইন',
    'nav.workspace': 'ওয়ার্কস্পেস',
    'shell.footer.rights': '© {year} VisaStack। মালিকানাধীন ও গোপনীয়।',
    'shell.footer.hosting': 'Vercel ও Neon-এর উপর রিমোট-ফার্স্ট পদ্ধতিতে তৈরি।',

    'shell.pilot.label': 'VisaStack নিয়ন্ত্রিত পাইলট',
    'shell.pilot.detail':
      'অভ্যন্তরীণ নিয়ন্ত্রিত পাইলট। শুধু কৃত্রিম তথ্য অথবা এমনভাবে গোপন করা তথ্য ব্যবহার করুন, যা আর ফিরিয়ে আনা যায় না।',
    'shell.preview.label': 'VisaStack ডেভেলপমেন্ট প্রিভিউ',
    'shell.preview.detail': 'ডেভেলপমেন্ট/প্রিভিউ সংস্করণ। প্রকৃত আবেদনকারীর তথ্যের জন্য নয়।',
    'shell.pilot.whatsLive': 'কী চালু আছে',

    'shell.app.overview': 'সারসংক্ষেপ',
    'shell.app.applicants': 'আবেদনকারী',
    'shell.app.shared': 'আমার সাথে শেয়ার করা',
    'shell.app.alerts': 'বিজ্ঞপ্তি',
    'shell.app.privacy': 'গোপনীয়তা',
    'shell.app.account': 'অ্যাকাউন্ট',
    'shell.app.agency': 'এজেন্সি',
    'shell.app.admin': 'অ্যাডমিন',
    'shell.app.signOut': 'সাইন আউট',
    'shell.nav.primary': 'প্রধান',

    'shell.applicant.eyebrow': 'আবেদনকারী',
    'shell.applicant.navLabel': 'আবেদনকারীর বিভাগসমূহ',
    'shell.applicant.overview': 'সারসংক্ষেপ',
    'shell.applicant.profile': 'প্রোফাইল',
    'shell.applicant.documents': 'নথি',
    'shell.applicant.cases': 'কেস',
    'shell.applicant.sharing': 'শেয়ারিং',
    'shell.applicant.evidence': 'প্রমাণ',
    'shell.applicant.expiry': 'মেয়াদ',
    'shell.applicant.history': 'ইতিহাস',

    'shell.loading': 'লোড হচ্ছে…',

    'error.notFound.title': 'পৃষ্ঠা পাওয়া যায়নি',
    'shell.notFound.eyebrow': 'পাওয়া যায়নি',
    'shell.notFound.heading': 'আমরা সেই পাতাটি খুঁজে পাইনি',
    'shell.notFound.body':
      'লিংকটি পুরনো হয়ে থাকতে পারে, অথবা রেকর্ডটি সরানো বা প্রত্যাহার করা হয়ে থাকতে পারে। ঠিকানাটি দেখে নিন, অথবা আপনার ওয়ার্কস্পেসে ফিরে যান।',
    'shell.notFound.workspace': 'ওয়ার্কস্পেসে যান',

    'error.code.forbidden': 'এটি করার অনুমতি আপনার নেই।',
    'error.code.step_up_required': 'চালিয়ে যেতে অনুগ্রহ করে আবার আপনার পরিচয় নিশ্চিত করুন।',
    'error.code.not_found': 'আপনি যা চেয়েছেন তা আমরা খুঁজে পাইনি।',
    'error.code.consent_required': 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।',
    'error.code.unknown_field': 'আপনার লেখা কিছু গ্রহণ করা যায়নি। যাচাই করে আবার চেষ্টা করুন।',
    'error.code.invalid': 'আপনার লেখা কিছু গ্রহণ করা যায়নি। যাচাই করে আবার চেষ্টা করুন।',
    'error.code.upstream_error': 'আমাদের নির্ভরশীল একটি সেবা সাড়া দিচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
    'error.code.rate_limited': 'অনেকবার চেষ্টা করা হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন।',
    'error.code.encryption_unavailable': 'এই কাজটি এখন করা যাচ্ছে না। পরে আবার চেষ্টা করুন।',
    'error.code.stale': 'এই পাতাটি পুরনো হয়ে গেছে। পাতাটি আবার লোড করে চেষ্টা করুন।',
    'error.code.unknown': 'কিছু একটা ভুল হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'error.stepUpNotConfigured': 'এই কাজের জন্য স্টেপ-আপ যাচাই প্রয়োজন, যা এই পরিবেশে চালু করা নেই।',

    'shell.translationNotice':
      'এই বাংলা অনুবাদের পেশাদার আইনি পর্যালোচনা এখনও শেষ হয়নি। কিছু অস্পষ্ট মনে হলে ইংরেজি সংস্করণ দেখে নিন।',
  },
);
