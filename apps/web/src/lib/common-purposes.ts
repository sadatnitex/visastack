/**
 * The eight purposes the Start a Trip forms show first, as picture tiles, before the full grouped
 * list. They are the reasons Bangladesh travellers start a trip most often: a holiday, seeing
 * family, business, study, work, treatment, Hajj or Umrah, and a stop on the way. Keys only: the
 * word and the picture of each come from the purpose list itself (`case-choices.ts`,
 * `item-icons.ts`), so a rename or a new picture there reaches the tile with no change here.
 * A test keeps every key in the purpose list. Safe to import from browser code.
 */
export const COMMON_PURPOSE_KEYS = [
  'tourism',
  'family_or_friends_visit',
  'business_visit',
  'bachelors_or_masters_degree',
  'employer_sponsored_skilled_job',
  'medical_treatment',
  'religious_travel',
  'transit_or_airside_transit',
] as const;
