/** R5: the words and made-up rows of the public For Agencies page. Plain English, Title Case names, no invented figures. */

/** The made-up case list beside the headline. Every row is an Example (the table tags itself). */
export const EXAMPLE_CASES = [
  {
    name: 'Aisha K.',
    code: 'sg',
    country: 'Singapore',
    filled: 6,
    missing: 2,
    status: 'Being Prepared',
  },
  {
    name: 'Rafi H.',
    code: 'de',
    country: 'Germany',
    filled: 3,
    missing: 5,
    status: 'Waiting on Client',
  },
  {
    name: 'Nadia S.',
    code: 'jp',
    country: 'Japan',
    filled: 8,
    missing: 'Complete',
    status: 'Ready to Share',
  },
] as const;

/** What changes at an agency desk: three cards, each with a drawing of the kind of paper it is about. */
export const DESK_CARDS: readonly {
  readonly title: string;
  readonly body: string;
  readonly picture: string;
}[] = [
  {
    title: 'One List of Cases',
    body: 'Each row shows its ring and what is missing.',
    picture: 'flight_ticket',
  },
  {
    title: 'Only What Is Shared',
    body: 'Clients choose what you see, and can end it.',
    picture: 'travel_insurance',
  },
  {
    title: 'Completeness, Not Approval',
    body: 'The ring counts what is complete. It never promises a visa.',
    picture: 'passport',
  },
];

/** The Plans words. Nothing here is a price or a tier: selling is not open, so none is shown. */
export const PLANS_LINE = 'Pricing is shown here when selling opens.';
export const PLANS_ACCESS_CLOSED =
  'Agency access is by invitation while we test with practice records.';
export const PLANS_ACCESS_OPEN = 'Accounts are free during the public beta.';
