import { defineCatalog } from '../catalog';

/**
 * The traveller's home: the overview page, the list of people the account
 * manages, the form that adds one, and the account page. Ordinary interface
 * copy. The statement a person makes when adding a record for someone else is
 * consent wording and lives in the consent catalog.
 */
export const account = defineCatalog(
  { id: 'account', review: [] },
  {
    // Overview.
    'account.overview.eyebrow': 'Overview',
    'account.overview.title': 'Welcome back',
    'account.action.addFirst': 'Add your first applicant',
    'account.action.review': 'Review {name}',
    'account.action.view': 'View applicants',

    'account.glance.kicker': 'Status',
    'account.glance.title': 'At a glance',
    'account.glance.applicants': 'Applicants',
    'account.glance.documents': 'Documents uploaded',
    'account.glance.cases': 'Active cases',
    'account.glance.invitations': 'Sharing invitations awaiting you',
    'account.glance.pending': '{count} pending',
    'account.glance.none': 'None',

    'account.attention.kicker': 'Attention',
    'account.attention.title': 'Needs your attention',
    'account.attention.empty': 'Nothing needs your attention right now.',
    'account.attention.proposals': 'AI proposal(s) awaiting your review',
    'account.attention.requests': 'Evidence request(s) awaiting a response',
    'account.attention.invitations': 'Sharing invitation(s) awaiting your acceptance',

    // The people on the account.
    'account.applicants.eyebrow': 'Applicants',
    'account.applicants.title': 'People on your account',
    'account.applicants.subtitle':
      'Yourself and anyone you manage records for, such as family members or a minor under your guardianship.',
    'account.applicants.listKicker': 'All applicants',
    'account.applicants.count.one': '{count} record',
    'account.applicants.count.other': '{count} records',
    'account.applicants.empty': 'No applicant records yet.',
    'account.applicants.newKicker': 'New',
    'account.applicants.addTitle': 'Add an applicant',
    'account.applicants.needConsent':
      'Grant <b>Core processing</b> consent from <link>Overview</link> to start adding applicant records.',

    // The add-applicant form.
    'account.add.name': 'Full name',
    'account.add.relationship': 'Relationship',
    'account.add.submit': 'Add applicant',
    'account.add.submitting': 'Adding…',
    'account.add.nameRequired': 'Enter a name.',
    'account.add.done': '{name} added.',
    'applicant.relationship.self': 'Myself',
    'applicant.relationship.familyMember': 'Family member',
    'applicant.relationship.minorGuardian': 'Minor (guardian)',

    // The account page.
    'account.page.eyebrow': 'Account',
    'account.language.kicker': 'Preferences',
    'account.language.title': 'Language',
    'account.language.body': 'Applies immediately across the whole product.',
    'account.language.switch': 'Switch to {language}',
    'account.privacy.kicker': 'Data rights',
    'account.privacy.title': 'Privacy',
    'account.privacy.body': 'Export your data, review consent history, or delete your account.',
    'account.privacy.open': 'Open Privacy',
    'account.roles.kicker': 'Roles',
    'account.roles.title': 'Other areas you can access',
    'account.roles.agency': 'Agency Desk',
    'account.roles.admin': 'Platform administration',
    'account.session.kicker': 'Session',
    'account.session.title': 'Signed in',
    'account.session.body': 'Sign out of this device.',
  },
  {
    'account.overview.eyebrow': 'সারসংক্ষেপ',
    'account.overview.title': 'আবার স্বাগতম',
    'account.action.addFirst': 'আপনার প্রথম আবেদনকারী যোগ করুন',
    'account.action.review': 'পর্যালোচনা করুন: {name}',
    'account.action.view': 'আবেদনকারীদের দেখুন',

    'account.glance.kicker': 'অবস্থা',
    'account.glance.title': 'এক নজরে',
    'account.glance.applicants': 'আবেদনকারী',
    'account.glance.documents': 'আপলোড করা নথি',
    'account.glance.cases': 'চলমান কেস',
    'account.glance.invitations': 'আপনার অপেক্ষায় থাকা শেয়ারিং আমন্ত্রণ',
    'account.glance.pending': '{count}টি অপেক্ষমাণ',
    'account.glance.none': 'নেই',

    'account.attention.kicker': 'মনোযোগ',
    'account.attention.title': 'আপনার মনোযোগ প্রয়োজন',
    'account.attention.empty': 'এই মুহূর্তে আপনার মনোযোগ দেওয়ার মতো কিছু নেই।',
    'account.attention.proposals': 'আপনার পর্যালোচনার অপেক্ষায় থাকা এআই প্রস্তাব',
    'account.attention.requests': 'উত্তরের অপেক্ষায় থাকা প্রমাণের অনুরোধ',
    'account.attention.invitations': 'আপনার গ্রহণের অপেক্ষায় থাকা শেয়ারিং আমন্ত্রণ',

    'account.applicants.eyebrow': 'আবেদনকারী',
    'account.applicants.title': 'আপনার অ্যাকাউন্টে থাকা ব্যক্তিরা',
    'account.applicants.subtitle':
      'আপনি নিজে এবং যাদের রেকর্ড আপনি পরিচালনা করেন, যেমন পরিবারের সদস্য বা আপনার অভিভাবকত্বে থাকা নাবালক।',
    'account.applicants.listKicker': 'সব আবেদনকারী',
    'account.applicants.count.one': '{count}টি রেকর্ড',
    'account.applicants.count.other': '{count}টি রেকর্ড',
    'account.applicants.empty': 'এখনও কোনো আবেদনকারীর রেকর্ড নেই।',
    'account.applicants.newKicker': 'নতুন',
    'account.applicants.addTitle': 'একজন আবেদনকারী যোগ করুন',
    'account.applicants.needConsent':
      'আবেদনকারীর রেকর্ড যোগ করা শুরু করতে <link>সারসংক্ষেপ</link> পাতা থেকে <b>মূল প্রক্রিয়াকরণে</b> সম্মতি দিন।',

    'account.add.name': 'পূর্ণ নাম',
    'account.add.relationship': 'সম্পর্ক',
    'account.add.submit': 'আবেদনকারী যোগ করুন',
    'account.add.submitting': 'যোগ করা হচ্ছে…',
    'account.add.nameRequired': 'একটি নাম লিখুন।',
    'account.add.done': '{name} যোগ করা হয়েছে।',
    'applicant.relationship.self': 'নিজে',
    'applicant.relationship.familyMember': 'পরিবারের সদস্য',
    'applicant.relationship.minorGuardian': 'নাবালক (অভিভাবক)',

    'account.page.eyebrow': 'অ্যাকাউন্ট',
    'account.language.kicker': 'পছন্দ',
    'account.language.title': 'ভাষা',
    'account.language.body': 'সম্পূর্ণ পণ্যজুড়ে সঙ্গে সঙ্গে প্রযোজ্য হয়।',
    'account.language.switch': '{language}-এ পরিবর্তন করুন',
    'account.privacy.kicker': 'তথ্যের অধিকার',
    'account.privacy.title': 'গোপনীয়তা',
    'account.privacy.body': 'আপনার তথ্য এক্সপোর্ট করুন, সম্মতির ইতিহাস দেখুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।',
    'account.privacy.open': 'গোপনীয়তা খুলুন',
    'account.roles.kicker': 'ভূমিকা',
    'account.roles.title': 'আপনি যেসব অন্য এলাকায় প্রবেশ করতে পারেন',
    'account.roles.agency': 'এজেন্সি ডেস্ক',
    'account.roles.admin': 'প্ল্যাটফর্ম প্রশাসন',
    'account.session.kicker': 'সেশন',
    'account.session.title': 'সাইন ইন করা আছে',
    'account.session.body': 'এই ডিভাইস থেকে সাইন আউট করুন।',
  },
);
