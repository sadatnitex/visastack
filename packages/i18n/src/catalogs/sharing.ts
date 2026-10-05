import { defineCatalog } from '../catalog';

/**
 * Sharing: who a traveller's information is shared with and in what state the
 * share is. Granting, pausing and revoking access are consent decisions, so the
 * Bangla needs a consent and privacy review.
 */
export const sharing = defineCatalog(
  { id: 'sharing', review: ['CONSENT', 'PRIVACY'] },
  {
    'grant.pending': 'Waiting for {recipient} to accept.',
    'grant.revoked': 'Access has been revoked.',
    'grant.status.pendingAcceptance': 'Pending acceptance',
    'grant.status.awaitingYourAcceptance': 'Awaiting your acceptance',
    'grant.status.active': 'Active',
    'grant.status.paused': 'Paused',
    'grant.status.revoked': 'Revoked',
    'grant.status.expired': 'Expired',
  },
  {
    'grant.pending': '{recipient} গ্রহণ করার অপেক্ষায়।',
    'grant.revoked': 'অ্যাক্সেস প্রত্যাহার করা হয়েছে।',
    'grant.status.pendingAcceptance': 'গ্রহণের অপেক্ষায়',
    'grant.status.awaitingYourAcceptance': 'আপনার গ্রহণের অপেক্ষায়',
    'grant.status.active': 'সক্রিয়',
    'grant.status.paused': 'বিরত',
    'grant.status.revoked': 'প্রত্যাহৃত',
    'grant.status.expired': 'মেয়াদ উত্তীর্ণ',
  },
);
