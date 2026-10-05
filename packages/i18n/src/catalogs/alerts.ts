import { defineCatalog } from '../catalog';

/**
 * Alerts: the in-app alerts page and the text of each alert the platform sends
 * a traveller.
 *
 * An alert is stored once, in English, when the event happens, together with
 * the key and values it was built from. The page shows it in the reader's
 * language by looking the key up again, so one stored alert reads correctly for
 * whoever opens it. The retention and deletion notices state what will happen to
 * a person's data, so this catalog needs a privacy review of its Bangla.
 */
export const alerts = defineCatalog(
  { id: 'alerts', review: ['PRIVACY'] },
  {
    'alerts.eyebrow': 'Alerts',
    'alerts.title': 'Updates on your cases',
    'alerts.empty':
      'No alerts yet. Updates about your cases, requests for evidence and documents nearing expiry will appear here.',
    'alerts.new': 'New',
    'alerts.open': 'Open',
    'alerts.markRead': 'Mark read',

    'alert.evidenceRequestCreated.subject': 'New evidence request',
    'alert.evidenceRequestCreated.summary': 'An agency working your case has asked for evidence.',
    'alert.missionStatusChanged.subject': 'Update on your case',
    'alert.missionStatusChanged.summary': 'A reviewer recorded a decision on your case.',
    'alert.evidenceReplacementRequested.subject': 'Evidence needs a fresh submission',
    'alert.evidenceReplacementRequested.summary':
      'A reviewer requested a replacement for your submitted evidence.',
    'alert.evidenceReviewAccepted.subject': 'Evidence accepted',
    'alert.evidenceReviewAccepted.summary': 'A reviewer accepted your submitted evidence.',
    'alert.appointmentScheduled.subject': 'Appointment scheduled',
    'alert.appointmentScheduled.summary': 'An appointment was scheduled on your case.',
    'alert.taskOverdue.subject': 'Overdue task on your case',
    'alert.taskDueSoon.subject': 'Task due soon',
    'alert.taskDeadline.summary': 'A task on "{title}" needs your attention.',
    'alert.documentExpiry.subject': 'A document is expiring soon',
    'alert.documentExpiry.summary': '"{name}" is expiring soon. Check whether it needs renewing.',
    'alert.verificationExpiry.subject': 'An issuer confirmation is expiring soon',
    'alert.verificationExpiry.summary': 'The confirmation from "{issuer}" is expiring soon.',
    'alert.caseRetention.subject': 'Case data scheduled for deletion in 30 days',
    'alert.caseRetention.summary':
      'This case has been closed for {months} months. Its case records will be permanently deleted in 30 days. Export anything you still need before then.',
    'alert.inactiveAccount.subject': 'Your account has been inactive for a while',
    'alert.inactiveAccount.summary':
      "We haven't seen you sign in for {months} months. If you don't sign in within 30 days, we'll begin the account deletion process (with its own final review period before anything is actually deleted). Sign in any time to cancel this.",
  },
  {
    'alerts.eyebrow': 'বিজ্ঞপ্তি',
    'alerts.title': 'আপনার কেসের হালনাগাদ',
    'alerts.empty':
      'এখনও কোনো বিজ্ঞপ্তি নেই। আপনার কেস, প্রমাণের অনুরোধ এবং মেয়াদ শেষ হতে চলা নথি সম্পর্কে হালনাগাদ এখানে দেখা যাবে।',
    'alerts.new': 'নতুন',
    'alerts.open': 'খুলুন',
    'alerts.markRead': 'পঠিত হিসেবে চিহ্নিত করুন',

    'alert.evidenceRequestCreated.subject': 'প্রমাণের নতুন অনুরোধ',
    'alert.evidenceRequestCreated.summary': 'আপনার কেসে কাজ করা একটি এজেন্সি প্রমাণ চেয়েছে।',
    'alert.missionStatusChanged.subject': 'আপনার কেসের হালনাগাদ',
    'alert.missionStatusChanged.summary': 'একজন পর্যালোচক আপনার কেসে একটি সিদ্ধান্ত নথিভুক্ত করেছেন।',
    'alert.evidenceReplacementRequested.subject': 'প্রমাণ নতুন করে জমা দিতে হবে',
    'alert.evidenceReplacementRequested.summary':
      'একজন পর্যালোচক আপনার জমা দেওয়া প্রমাণের বদলে অন্য প্রমাণ চেয়েছেন।',
    'alert.evidenceReviewAccepted.subject': 'প্রমাণ গৃহীত হয়েছে',
    'alert.evidenceReviewAccepted.summary': 'একজন পর্যালোচক আপনার জমা দেওয়া প্রমাণ গ্রহণ করেছেন।',
    'alert.appointmentScheduled.subject': 'অ্যাপয়েন্টমেন্ট নির্ধারিত হয়েছে',
    'alert.appointmentScheduled.summary': 'আপনার কেসে একটি অ্যাপয়েন্টমেন্ট নির্ধারণ করা হয়েছে।',
    'alert.taskOverdue.subject': 'আপনার কেসের একটি কাজের সময়সীমা পেরিয়ে গেছে',
    'alert.taskDueSoon.subject': 'একটি কাজের সময়সীমা ঘনিয়ে আসছে',
    'alert.taskDeadline.summary': '"{title}" কেসের একটি কাজে আপনার মনোযোগ প্রয়োজন।',
    'alert.documentExpiry.subject': 'একটি নথির মেয়াদ শীঘ্রই শেষ হচ্ছে',
    'alert.documentExpiry.summary':
      '"{name}" নথির মেয়াদ শীঘ্রই শেষ হচ্ছে। নবায়ন করা দরকার কি না দেখে নিন।',
    'alert.verificationExpiry.subject': 'ইস্যুকারীর একটি নিশ্চিতকরণের মেয়াদ শীঘ্রই শেষ হচ্ছে',
    'alert.verificationExpiry.summary': '"{issuer}"-এর দেওয়া নিশ্চিতকরণের মেয়াদ শীঘ্রই শেষ হচ্ছে।',
    'alert.caseRetention.subject': 'কেসের তথ্য ৩০ দিনের মধ্যে মুছে ফেলা হবে',
    'alert.caseRetention.summary':
      'এই কেসটি {months} মাস ধরে বন্ধ আছে। ৩০ দিনের মধ্যে কেসের রেকর্ডগুলো স্থায়ীভাবে মুছে ফেলা হবে। এর আগে যা প্রয়োজন তা এক্সপোর্ট করে নিন।',
    'alert.inactiveAccount.subject': 'আপনার অ্যাকাউন্ট কিছুদিন ধরে নিষ্ক্রিয়',
    'alert.inactiveAccount.summary':
      'আমরা {months} মাস ধরে আপনাকে সাইন ইন করতে দেখিনি। ৩০ দিনের মধ্যে সাইন ইন না করলে আমরা অ্যাকাউন্ট মুছে ফেলার প্রক্রিয়া শুরু করব (সত্যিই কিছু মুছে ফেলার আগে এর নিজস্ব একটি চূড়ান্ত পর্যালোচনার সময় থাকবে)। এটি বাতিল করতে যেকোনো সময় সাইন ইন করুন।',
  },
);
