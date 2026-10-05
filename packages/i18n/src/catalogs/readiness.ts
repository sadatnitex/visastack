import { defineCatalog } from '../catalog';

/**
 * Readiness: what a case says about whether the required items are in place.
 * A readiness statement must never read as a promise about the outcome of an
 * application, so its Bangla needs a legal review for that as well as for
 * meaning.
 */
export const readiness = defineCatalog(
  { id: 'readiness', review: ['LEGAL'] },
  {
    'mission.readiness.missing': '{count} requirement(s) still needed',
    'mission.readiness.ready': 'All required items are provided.',
    'mission.readiness.needsReview': '{count} requirement(s) need more information to confirm.',
    'mission.readiness.manualOnly': 'This case is not automatically assessed.',
  },
  {
    'mission.readiness.missing': '{count}টি প্রয়োজনীয় নথি এখনও বাকি',
    'mission.readiness.ready': 'সমস্ত প্রয়োজনীয় নথি প্রদান করা হয়েছে।',
    'mission.readiness.needsReview': '{count}টি বিষয় নিশ্চিত করতে আরও তথ্য প্রয়োজন।',
    'mission.readiness.manualOnly': 'এই কেসটি স্বয়ংক্রিয়ভাবে মূল্যায়ন করা হয় না।',
  },
);
