/**
 * Bengali drafts for the status page: the names of the features are live; what state each is in
 * (Working, Not Set Up Yet, Switched Off for Now) and the page's verdicts say what is true of the
 * product right now, so they are HELD (status wording) and show in English, marked English, until
 * signed off. Not approved by a person (message-kit.ts).
 */
import { held, o } from './message-kit';

export const STATUS_MESSAGES = {
  'status.name.authentication': o('Signing In', 'সাইন ইন'),
  'status.name.manualProfile': o('Building Your Profile by Hand', 'নিজে হাতে প্রোফাইল তৈরি'),
  'status.name.documentUpload': o('Uploading Documents', 'ডকুমেন্ট আপলোড'),
  'status.name.deterministicExtraction': o('Reading Details from Documents', 'ডকুমেন্ট থেকে তথ্য পড়া'),
  'status.name.aiExtraction': o('AI Suggestions from Documents', 'ডকুমেন্ট থেকে এআই-এর পরামর্শ'),
  'status.name.structuralValidation': o(
    'Checking Uploaded Files Are Valid',
    'আপলোড করা ফাইল সঠিক কি না পরীক্ষা',
  ),
  'status.name.malwareScanning': o('Virus Scanning of Uploads', 'আপলোডের ভাইরাস স্ক্যান'),
  'status.name.ownerPreview': o('Previewing Your Own Documents', 'নিজের ডকুমেন্টের প্রিভিউ'),
  'status.name.thirdPartyPreview': o(
    'Previewing Documents You Share with Others',
    'অন্যদের সঙ্গে শেয়ার করা ডকুমেন্টের প্রিভিউ',
  ),
  'status.name.originalDownload': o('Downloading Original Files', 'মূল ফাইল ডাউনলোড'),
  'status.name.redactedDownload': o('Downloading Safe Copies', 'নিরাপদ কপি ডাউনলোড'),
  'status.name.sharing': o('Sharing with Agencies', 'এজেন্সির সঙ্গে শেয়ার'),
  'status.name.agencyCollaboration': o('Agency Workspaces', 'এজেন্সির ওয়ার্কস্পেস'),
  'status.name.bulkExport': o('Exporting Records for Agencies', 'এজেন্সির জন্য রেকর্ড এক্সপোর্ট'),
  'status.name.missionWorkspace': o('Visa Case Workspaces', 'ভিসা ফাইলের ওয়ার্কস্পেস'),
  'status.name.packGeneration': o('Preparing Application Packs', 'আবেদনের প্যাক তৈরি'),
  'status.name.publicSignup': o('Open Sign-Up for Anyone', 'যে কেউ সাইন আপ করতে পারবে'),
  'status.name.payments': o('Payments', 'পেমেন্ট'),
  'status.name.aiConnector': o('AI App Connections', 'এআই অ্যাপ সংযোগ'),
  'status.name.realApplicantData': held(
    'status',
    'All Protections for Real Personal Data in Place',
    'আসল ব্যক্তিগত তথ্যের জন্য সব সুরক্ষা চালু আছে',
  ),
  'status.state.available': held('status', 'Working', 'কাজ করছে'),
  'status.state.degraded': held('status', 'Working with Limits', 'সীমাবদ্ধতাসহ কাজ করছে'),
  'status.state.unconfigured': held('status', 'Not Set Up Yet', 'এখনও সেট আপ করা হয়নি'),
  'status.state.disabled': held('status', 'Switched Off for Now', 'আপাতত বন্ধ'),
  'status.state.testPayments': held('status', 'Test Payments Only', 'শুধু টেস্ট পেমেন্ট'),
  'status.state.partlyLive': held('status', 'Partly Live', 'আংশিক চালু'),
  'status.verdict.checking': o('Checking…', 'পরীক্ষা করা হচ্ছে…'),
  'status.verdict.working': held('status', 'Everything is working', 'সবকিছু ঠিকঠাক কাজ করছে'),
  'status.verdict.limited': held('status', 'Some parts are having problems', 'কিছু অংশে সমস্যা হচ্ছে'),
  'status.verdict.unreachable': held(
    'status',
    'We can’t reach the service right now',
    'এই মুহূর্তে সেবাটির সঙ্গে যোগাযোগ করা যাচ্ছে না',
  ),
} as const;
