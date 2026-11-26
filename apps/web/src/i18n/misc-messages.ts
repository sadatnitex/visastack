/**
 * Bengali drafts for the small public screens: the not-found page, account recovery, an invitation
 * link that is missing, a payment link that has expired, and the lines that join sign-in and sign-up.
 * What says something about an account or a payment is HELD; buttons and plain error lines are live.
 * Not approved by a person (message-kit.ts).
 */
import { held, o } from './message-kit';

export const MISC_MESSAGES = {
  'misc.notFound.eyebrow': o('Not Found', 'পাওয়া যায়নি'),
  'misc.notFound.heading': o("We Couldn't Find That Page", 'আমরা পাতাটি খুঁজে পাইনি'),
  'misc.notFound.body': o(
    'The link may be out of date, or the record may have been removed or revoked. Check the address, or head back to your workspace.',
    'লিংকটি পুরোনো হয়ে থাকতে পারে, অথবা রেকর্ডটি মুছে ফেলা বা প্রত্যাহার করা হয়ে থাকতে পারে। ঠিকানাটি দেখে নিন, অথবা আপনার ওয়ার্কস্পেসে ফিরে যান।',
  ),
  'misc.goWorkspace': o('Go to Workspace', 'ওয়ার্কস্পেসে যান'),
  'misc.backHome': o('Back to Home', 'হোম পাতায় ফিরে যান'),
  'misc.signOut': o('Sign Out', 'সাইন আউট করুন'),
  'misc.recovery.one': held(
    'claim',
    'We could not safely connect this sign-in to an account. Your records have not been changed. If you already have another sign-in for VisaStack, sign out and use that one. If your account was made before VisaStack changed how people sign in, contact VisaStack support or the person who invited you: once they have checked with you, sign in again with the email and password you just used.',
    'আমরা এই সাইন-ইনটি নিরাপদে কোনো অ্যাকাউন্টের সঙ্গে যুক্ত করতে পারিনি। আপনার রেকর্ডে কোনো পরিবর্তন হয়নি। VisaStack-এর জন্য আপনার যদি আগে থেকেই অন্য সাইন-ইন থাকে, সাইন আউট করে সেটি ব্যবহার করুন। VisaStack মানুষের সাইন-ইনের নিয়ম বদলানোর আগে আপনার অ্যাকাউন্ট তৈরি হয়ে থাকলে VisaStack সহায়তা বা আপনাকে যিনি আমন্ত্রণ জানিয়েছেন তাঁর সঙ্গে যোগাযোগ করুন: তাঁরা আপনার সঙ্গে যাচাই করার পর এইমাত্র ব্যবহার করা ইমেইল ও পাসওয়ার্ড দিয়ে আবার সাইন ইন করুন।',
  ),
  'misc.recovery.two': held(
    'claim',
    'Resetting a password confirms access to your email. It does not transfer existing records to another account.',
    'পাসওয়ার্ড রিসেট করলে আপনার ইমেইলে আপনার প্রবেশাধিকার নিশ্চিত হয়। এতে বিদ্যমান রেকর্ড অন্য কোনো অ্যাকাউন্টে সরানো হয় না।',
  ),
  'misc.invitation.ask': o(
    'Ask the person who invited you for a new link.',
    'আপনাকে যিনি আমন্ত্রণ জানিয়েছেন, তাঁর কাছ থেকে নতুন লিংক চেয়ে নিন।',
  ),
  'misc.payment.heading': held(
    'status',
    'This Payment Link Is No Longer Available',
    'এই পেমেন্ট লিংকটি আর পাওয়া যাচ্ছে না',
  ),
  'misc.payment.body': held(
    'status',
    'The link may have expired. Open VisaStack to see the latest state of your payment.',
    'লিংকটির মেয়াদ শেষ হয়ে থাকতে পারে। আপনার পেমেন্টের সর্বশেষ অবস্থা দেখতে VisaStack খুলুন।',
  ),
  'misc.newHere': o('New here?', 'নতুন এখানে?'),
  'misc.haveAccount': o('Already have an account?', 'আগে থেকেই অ্যাকাউন্ট আছে?'),
  'misc.consent.agree': held('legal', 'I agree to the', 'আমি সম্মত আছি:'),
  'misc.consent.terms': held('legal', 'terms of use', 'ব্যবহারের শর্তাবলিতে'),
  'misc.consent.acknowledge': held('legal', 'and acknowledge the', 'এবং স্বীকার করছি:'),
  'misc.consent.privacy': held('legal', 'privacy notice', 'গোপনীয়তা নোটিশ'),
} as const;
