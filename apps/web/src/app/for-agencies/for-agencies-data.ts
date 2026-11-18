import type { PublicStatus } from '../../components/public-site/story';

/** WP-PUB4: the words of the public For Agencies page. Plain English, Title Case names, no invented figures. */

/** What an agency gets today: the same facts the home page states, one card each. */
export const AGENCY_POINTS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Ask for One Document',
    body: 'Ask a client for a specific document and see when it arrives.',
  },
  {
    title: 'See What Is Missing',
    body: 'Open a case and see at once what is missing or overdue.',
  },
  {
    title: 'Keep a Clear Record',
    body: 'Keep a clear record of who did what, and when.',
  },
];

/** The made-up case line: every row is an Example, each state shown with its own word. */
export const EXAMPLE_LINE: readonly {
  readonly status: PublicStatus;
  readonly name: string;
  readonly note: string;
}[] = [
  {
    status: 'received',
    name: 'Passport Scan',
    note: 'Arrived from the client. Nobody has checked it yet.',
  },
  {
    status: 'suggested',
    name: 'Date of Birth',
    note: 'Read from the scan. It waits for the client to confirm.',
  },
  { status: 'confirmed', name: 'Visa Photo', note: 'The client checked it and confirmed it.' },
];

/** The made-up sharing line. Saved is not Shared; ending access is a recorded step. */
export const EXAMPLE_SHARING: readonly PublicStatus[] = ['saved', 'shared', 'accessEnded'];
