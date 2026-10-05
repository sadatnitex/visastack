import { defineCatalog } from '../catalog';

/**
 * What the error screen says. Kept in a catalog of its own, apart from the rest
 * of the frame, because the error boundary is a browser component: it is the one
 * screen that cannot have its words handed to it by a server page, so it carries
 * these few itself, and carries nothing else.
 */
export const errors = defineCatalog(
  { id: 'errors', review: [] },
  {
    'error.generic.title': 'Something went wrong',
    'error.generic.body': "This wasn't caused by anything you did, and your data was not affected.",
    'shell.error.heading': 'We hit a snag loading this page',
    'shell.error.body':
      'This is on our side, not yours. Nothing you had entered on this page was lost or corrupted. Try again in a moment; if it keeps happening, sign out and back in.',
    'shell.error.retry': 'Try again',
    'shell.error.home': 'Back to home',
    'shell.error.reference': 'Reference: {digest}',
    'error.global.body': 'An unexpected error interrupted the page. Please try again.',
  },
  {
    'error.generic.title': 'কিছু ভুল হয়েছে',
    'error.generic.body': 'এটি আপনার কারণে ঘটেনি, এবং আপনার তথ্য প্রভাবিত হয়নি।',
    'shell.error.heading': 'এই পাতাটি লোড করতে গিয়ে সমস্যা হয়েছে',
    'shell.error.body':
      'সমস্যাটি আমাদের দিকে, আপনার দিকে নয়। এই পাতায় আপনি যা লিখেছিলেন তার কিছুই হারায়নি বা নষ্ট হয়নি। একটু পরে আবার চেষ্টা করুন; বারবার হলে সাইন আউট করে আবার সাইন ইন করুন।',
    'shell.error.retry': 'আবার চেষ্টা করুন',
    'shell.error.home': 'হোম পাতায় ফিরুন',
    'shell.error.reference': 'রেফারেন্স: {digest}',
    'error.global.body': 'একটি অপ্রত্যাশিত ত্রুটিতে পাতাটি থেমে গেছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
  },
);
