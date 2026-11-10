/**
 * How much of VisaStack is built from patterns people in Bangladesh already know from the apps
 * they use every day (owner direction, 10 Nov 2026: more than 60 percent, without looking busy).
 *
 * One row per screen per pattern. We copy the pattern, never an app's logo, colours or look.
 *
 * - `familiar`: it works the way the named everyday app works, so nobody has to learn it.
 * - `partly`: it borrows some of it, but a person still has to work something out.
 * - `bespoke`: it is ours. Allowed only with a reason (it is a rare screen, or the product needs
 *   something no everyday app has).
 *
 * `weight` (1 to 5) is how often a traveller meets the pattern, so a tab bar counts for more than
 * a rare staff screen. The share is an ESTIMATE from reading the code, not a measurement with
 * people: it is a way to stop it sliding back, and to see where the next gain is.
 * `familiar-conformance.test.tsx` holds the registry to account: the weighted share can never fall
 * below `familiar-baseline.json`, a listed file must exist, a bespoke row needs a reason, and a
 * row that claims `proof` must still contain it.
 */
export type FamiliarClass = 'familiar' | 'partly' | 'bespoke';

export interface FamiliarRow {
  readonly screen: string;
  readonly pattern: string;
  readonly class: FamiliarClass;
  /** The everyday app moment it matches, in a few words. */
  readonly matches: string;
  readonly weight: 1 | 2 | 3 | 4 | 5;
  /** Files of the pattern, relative to apps/web/src. */
  readonly files: readonly string[];
  /** Required when `bespoke`; says why it is not a known pattern. */
  readonly reason?: string;
  /** For a row this programme converted: text that must still be in the file. */
  readonly proof?: { readonly file: string; readonly includes: string };
}

export const FAMILIAR_ROWS: readonly FamiliarRow[] = [
  {
    screen: 'every signed-in screen (phone)',
    pattern: 'bottom tab bar with counts',
    class: 'familiar',
    matches: 'WhatsApp and Facebook bottom tabs, with a number on a tab',
    weight: 5,
    files: ['app/app/app-nav.tsx', 'lib/tab-badges.ts'],
    proof: { file: 'app/app/app-nav.tsx', includes: 'app-tab-badge' },
  },
  {
    screen: 'top bar',
    pattern: 'bell with a red count',
    class: 'familiar',
    matches: 'Facebook notifications bell',
    weight: 4,
    files: ['app/app/workspace-record-toolbar.tsx'],
  },
  {
    screen: 'notifications',
    pattern: 'notification list',
    class: 'familiar',
    matches: 'Facebook and Gmail notification list',
    weight: 3,
    files: ['app/app/notifications/notification-list.tsx'],
  },
  {
    screen: 'case, documents, sharing',
    pattern: 'list with a side panel',
    class: 'partly',
    matches: 'Gmail and Drive list with a reading pane',
    weight: 5,
    files: ['components/list-pattern/list-with-pane.tsx'],
  },
  {
    screen: 'case, documents',
    pattern: 'grouped list with folders',
    class: 'partly',
    matches: 'Drive folders',
    weight: 4,
    files: ['components/list-pattern/grouped-list.tsx'],
  },
  {
    screen: 'documents, case checklist',
    pattern: 'filter bar',
    class: 'familiar',
    matches:
      'Google Drive and Gmail: the search box is always in view, the other filters sit behind a Filters button with a number',
    weight: 3,
    files: ['components/list-pattern/list-filter-bar.tsx'],
    proof: { file: 'components/list-pattern/list-filter-bar.tsx', includes: 'lp-filters-toggle' },
  },
  {
    screen: 'cases, group trips',
    pattern: 'search box above a long list',
    class: 'familiar',
    matches: 'Gmail and Drive search: type, the list narrows, one plain line when nothing matches',
    weight: 2,
    files: [
      'components/list-pattern/searchable-list.tsx',
      'app/app/applicant/[id]/missions/page.tsx',
      'app/app/trips/(list)/page.tsx',
    ],
    proof: {
      file: 'app/app/applicant/[id]/missions/page.tsx',
      includes: 'searchLabel="Search Cases"',
    },
  },
  {
    screen: 'home',
    pattern: 'recent activity statement',
    class: 'familiar',
    matches: 'bKash statement: the last few dated lines, then See All',
    weight: 3,
    files: ['app/app/(home)/recent-activity.tsx', 'lib/recent-activity.ts'],
    proof: { file: 'app/app/(home)/recent-activity.tsx', includes: 'See All' },
  },
  {
    screen: 'agency cases',
    pattern: 'case search',
    class: 'familiar',
    matches: 'Gmail search box',
    weight: 3,
    files: ['app/app/agency/[orgId]/case-search-form.tsx'],
  },
  {
    screen: 'lists everywhere',
    pattern: 'status chip',
    class: 'familiar',
    matches: 'Foodpanda order status label',
    weight: 5,
    files: ['components/ui-lift/status-pill.tsx'],
  },
  {
    screen: 'case',
    pattern: 'order-tracking stages',
    class: 'familiar',
    matches: 'Foodpanda and Pathao order tracker: "Now" headline, steps down a line on a phone',
    weight: 4,
    files: ['components/ui-lift/step-bar.tsx', 'components/case-preparation-summary.tsx'],
    proof: { file: 'components/ui-lift/step-bar.tsx', includes: 'lift-steps-now' },
  },
  {
    screen: 'home, case',
    pattern: 'progress ring',
    class: 'partly',
    matches: 'Drive storage ring, but readiness is not a quota',
    weight: 4,
    files: ['components/progress-ring.tsx'],
  },
  {
    screen: 'case, documents',
    pattern: 'progress meter',
    class: 'familiar',
    matches: 'Drive upload progress bar',
    weight: 2,
    files: ['components/ui-lift/progress-meter.tsx'],
  },
  {
    screen: 'add documents',
    pattern: 'camera or file upload',
    class: 'partly',
    matches: 'WhatsApp attach, but with a type to choose',
    weight: 5,
    files: ['app/app/applicant/[id]/document-uploader.tsx'],
  },
  {
    screen: 'add documents',
    pattern: 'upload receipt',
    class: 'bespoke',
    matches: 'bKash receipt, but ours lists checks run on the file',
    weight: 3,
    files: ['app/app/applicant/[id]/documents/add/page.tsx'],
    reason:
      'It reports what was really checked on each file, which no everyday app does; it must stay exact.',
  },
  {
    screen: 'every form',
    pattern: 'result after an action',
    class: 'familiar',
    matches: 'bKash "Successful" and Gmail snackbar, with the plain line kept for screen readers',
    weight: 5,
    files: ['components/form-feedback.tsx', 'components/toast.tsx'],
    proof: { file: 'components/form-feedback.tsx', includes: 'showToast' },
  },
  {
    screen: 'sharing',
    pattern: 'done notice',
    class: 'familiar',
    matches: 'Gmail "Conversation archived" snackbar',
    weight: 3,
    files: ['app/app/applicant/[id]/sharing/done-notice.tsx'],
    proof: { file: 'app/app/applicant/[id]/sharing/done-notice.tsx', includes: 'showToast' },
  },
  {
    screen: 'documents, lifecycle',
    pattern: 'undo',
    class: 'familiar',
    matches: 'Gmail Undo',
    weight: 2,
    files: ['components/lifecycle/undo-status.tsx'],
  },
  {
    screen: 'case, forms',
    pattern: 'sticky action bar',
    class: 'familiar',
    matches: 'Daraz bottom Buy Now bar',
    weight: 3,
    files: ['components/sticky-action-bar.tsx'],
  },
  {
    screen: 'lists',
    pattern: 'empty state',
    class: 'familiar',
    matches: 'Daraz empty cart',
    weight: 3,
    files: ['components/ui-lift/empty-panel.tsx'],
  },
  {
    screen: 'home, case',
    pattern: 'next step panel',
    class: 'partly',
    matches: 'bKash home suggestion card, but with more words',
    weight: 5,
    files: ['components/ui-lift/next-step-panel.tsx'],
  },
  {
    screen: 'documents, case',
    pattern: 'auto refresh',
    class: 'partly',
    matches: 'WhatsApp message ticks updating on their own',
    weight: 2,
    files: ['components/auto-refresh.tsx'],
  },
  {
    screen: 'reference codes',
    pattern: 'copy a code',
    class: 'familiar',
    matches: 'bKash copy TrxID',
    weight: 2,
    files: ['components/reference-code.tsx'],
  },
  {
    screen: 'agency requests',
    pattern: 'WhatsApp link',
    class: 'familiar',
    matches: 'Share to WhatsApp',
    weight: 2,
    files: ['app/app/agency/[orgId]/collection/collection-link-panel.tsx'],
  },
  {
    screen: 'evidence requests',
    pattern: 'request list',
    class: 'partly',
    matches: 'WhatsApp chat list, but grouped by who is waiting',
    weight: 4,
    files: ['app/app/applicant/[id]/evidence/page.tsx'],
  },
  {
    screen: 'sharing',
    pattern: 'permission picker',
    class: 'partly',
    matches: 'Facebook audience picker, with more choices',
    weight: 3,
    files: ['app/app/applicant/[id]/sharing/grant-form.tsx'],
  },
  {
    screen: 'account',
    pattern: 'install app card',
    class: 'familiar',
    matches: 'Add to Home Screen prompt',
    weight: 1,
    files: ['components/pwa/install-app-card.tsx'],
  },
  {
    screen: 'documents, case, home',
    pattern: 'depth switch',
    class: 'bespoke',
    matches: 'None: Glance, Guided and Full',
    weight: 2,
    files: ['components/depth-switch.tsx'],
    reason: 'No everyday app lets a person choose how much explanation to see; this is our own.',
  },
  {
    screen: 'home, case',
    pattern: 'deadline clock',
    class: 'partly',
    matches: "Pathao pickup countdown, but the dates are each person's own",
    weight: 2,
    files: ['components/deadline-clock.tsx'],
  },
  {
    screen: 'agency home',
    pattern: 'do next list',
    class: 'partly',
    matches: 'Gmail priority inbox',
    weight: 3,
    files: ['app/app/agency/[orgId]/do-next-list.tsx'],
  },
  {
    screen: 'activity',
    pattern: 'activity log',
    class: 'partly',
    matches: 'Facebook activity log',
    weight: 2,
    files: ['components/activity-log.tsx'],
  },
  {
    screen: 'name review, drafts, safe copies',
    pattern: 'review editors',
    class: 'bespoke',
    matches: 'None: a person approves what a machine suggested',
    weight: 1,
    files: [
      'app/app/applicant/[id]/name-review.tsx',
      'app/app/applicant/[id]/sharing/ai-drafts.tsx',
      'components/safe-copy-editor.tsx',
    ],
    reason: 'Approving a suggestion before it is used has no everyday-app equivalent.',
  },
  {
    screen: 'account',
    pattern: 'profile photo',
    class: 'familiar',
    matches: 'WhatsApp profile photo crop',
    weight: 1,
    files: ['components/profile-photo/profile-photo-control.tsx'],
  },
  {
    screen: 'documents (phone)',
    pattern: 'floating add button',
    class: 'familiar',
    matches: 'Gmail compose and Drive "+" button, bottom right above the bar',
    weight: 3,
    files: ['app/app/applicant/[id]/documents/page.tsx'],
    proof: { file: 'app/app/applicant/[id]/documents/page.tsx', includes: 'docs-add-fab' },
  },
  {
    screen: 'staff sign-in protection',
    pattern: 'code entry as digit boxes',
    class: 'familiar',
    matches: 'WhatsApp and bank verification code boxes',
    weight: 1,
    files: ['app/app/staff-code/forms.tsx', 'components/code-input.tsx'],
    proof: { file: 'app/app/staff-code/forms.tsx', includes: 'CodeInput' },
  },
  {
    screen: 'guest document request',
    pattern: 'code entry as digit boxes',
    class: 'familiar',
    matches: 'WhatsApp and bank verification code boxes',
    weight: 2,
    files: ['app/collect/guest-forms.tsx', 'components/code-input.tsx'],
    proof: { file: 'app/collect/guest-forms.tsx', includes: 'CodeInput' },
  },
];

/** The two shares the baseline records, from the rows as they are now. */
export function familiarShares(rows: readonly FamiliarRow[] = FAMILIAR_ROWS): {
  readonly weighted: number;
  readonly count: number;
  readonly rows: number;
} {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const familiar = rows.filter((row) => row.class === 'familiar');
  const familiarWeight = familiar.reduce((sum, row) => sum + row.weight, 0);
  return {
    weighted: total === 0 ? 0 : familiarWeight / total,
    count: rows.length === 0 ? 0 : familiar.length / rows.length,
    rows: rows.length,
  };
}
