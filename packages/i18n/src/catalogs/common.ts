import { defineCatalog } from '../catalog';

/**
 * Words and short sentences that many screens share: the buttons and notices that
 * read the same wherever they appear. Ordinary copy; nothing legal turns on it.
 */
export const common = defineCatalog(
  { id: 'common', review: [] },
  {
    'common.saving': 'Saving…',
    'common.save': 'Save',
    'common.approve': 'Approve',
    'common.reject': 'Reject',
    'common.acknowledge': 'Acknowledge',
    'common.dismiss': 'Dismiss',
    'common.preview': 'Preview',
    'common.notAuthorized': 'Not authorized.',
    'common.unknownAction': 'Unknown action.',
  },
  {
    'common.saving': 'সংরক্ষণ হচ্ছে…',
    'common.save': 'সংরক্ষণ করুন',
    'common.approve': 'অনুমোদন করুন',
    'common.reject': 'প্রত্যাখ্যান করুন',
    'common.acknowledge': 'জেনেছি',
    'common.dismiss': 'বাদ দিন',
    'common.preview': 'প্রিভিউ',
    'common.notAuthorized': 'অনুমতি নেই।',
    'common.unknownAction': 'কাজটি চেনা যায়নি।',
  },
);
