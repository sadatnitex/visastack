import { defineCatalog } from '../catalog';

/**
 * Upload: what a traveller is told about a document they uploaded, from
 * "uploading" to "ready" or "quarantined". The safety wording (scanned,
 * quarantined, structural validation) must say exactly what happened and no
 * more, so its Bangla needs a security review.
 */
export const upload = defineCatalog(
  { id: 'upload', review: ['SECURITY'] },
  {
    'document.scanning': 'This document is being scanned for safety.',
    'document.quarantined': 'This document was flagged and needs attention.',
    'document.status.clean': 'Clean',
    'document.status.pending': 'Pending',
    'document.status.scanning': 'Scanning',
    'document.status.quarantined': 'Quarantined',
    'document.processing.uploading': 'Uploading',
    'document.processing.quarantined': 'In quarantine',
    'document.processing.scanning': 'Scanning',
    'document.processing.normalizing': 'Structural validation',
    'document.processing.extracting': 'Processing',
    'document.processing.awaitingReview': 'Needs review',
    'document.processing.ready': 'Ready',
    'document.processing.needsAttention': 'Needs attention',
    'document.processing.failed': 'Failed',
    'document.processing.rejected': 'Rejected',
  },
  {
    'document.scanning': 'নিরাপত্তার জন্য এই নথিটি স্ক্যান করা হচ্ছে।',
    'document.quarantined': 'এই নথিটি চিহ্নিত করা হয়েছে এবং মনোযোগ প্রয়োজন।',
    'document.status.clean': 'পরিষ্কার',
    'document.status.pending': 'মুলতুবি',
    'document.status.scanning': 'স্ক্যান করা হচ্ছে',
    'document.status.quarantined': 'চিহ্নিত',
    'document.processing.uploading': 'আপলোড হচ্ছে',
    'document.processing.quarantined': 'কোয়ারেন্টাইনে',
    'document.processing.scanning': 'স্ক্যান করা হচ্ছে',
    'document.processing.normalizing': 'কাঠামোগত যাচাই',
    'document.processing.extracting': 'প্রক্রিয়াকরণ হচ্ছে',
    'document.processing.awaitingReview': 'পর্যালোচনা প্রয়োজন',
    'document.processing.ready': 'প্রস্তুত',
    'document.processing.needsAttention': 'মনোযোগ প্রয়োজন',
    'document.processing.failed': 'ব্যর্থ হয়েছে',
    'document.processing.rejected': 'প্রত্যাখ্যাত',
  },
);
