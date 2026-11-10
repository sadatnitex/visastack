/**
 * Every signed-in screen and which list pattern it uses (case page plan, 9 Nov 2026, sections 8
 * and 10). One pattern, one kit (`components/list-pattern`): a screen that shows a list is either
 * built from the kit or waiting for its phase. `pattern-conformance.test.tsx` holds the registry
 * to account: a converted screen must import the kit and hand-build no table, and the count of
 * screens still waiting can only go down.
 *
 * - `list+pane`: a list whose rows open a panel (full screen on a narrow screen).
 * - `list`: rows only; a row opens its own screen.
 * - `cards`: a screen of cards, not a list (no row pattern applies).
 * - `exempt`: staff or one-off screens kept apart on purpose (the reason says why).
 */
export type PatternKind = 'list+pane' | 'list' | 'cards' | 'exempt';

export interface PatternScreen {
  readonly screen: string;
  readonly pattern: PatternKind;
  /** Files of the screen, relative to apps/web/src. The first is the page. */
  readonly files: readonly string[];
  /** Built from the kit. */
  readonly converted: boolean;
  /** Not yet fully on the kit, and what already is (a screen with this still counts as waiting). */
  readonly partial?: string;
  /** The rollout package that converts it (plan section 9). */
  readonly phase: number;
  readonly reason?: string;
}

export const PATTERN_SCREENS: readonly PatternScreen[] = [
  {
    screen: 'case',
    pattern: 'list+pane',
    files: ['app/app/mission/[id]/page.tsx', 'app/app/mission/[id]/case-checklist.tsx'],
    converted: true,
    phase: 1,
  },
  {
    screen: 'documents',
    pattern: 'list+pane',
    // The list is the wallet browser; the page only hands it the documents and their detail panes.
    files: ['components/document-wallet-browser.tsx'],
    converted: false,
    partial:
      'The panel behaviour and the filter bar come from the kit. The rows and the selection stay its own: they carry the file-kind icon and the date line, the one list where a file-kind icon belongs (plan decision 10).',
    phase: 2,
  },
  {
    screen: 'evidence-requests',
    pattern: 'list+pane',
    files: ['app/app/applicant/[id]/evidence/page.tsx'],
    converted: false,
    phase: 4,
  },
  {
    screen: 'sharing',
    pattern: 'list+pane',
    files: ['app/app/applicant/[id]/sharing/page.tsx'],
    converted: true,
    phase: 5,
  },
  {
    screen: 'home',
    pattern: 'list',
    files: ['app/app/(home)/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'traveller',
    pattern: 'list',
    files: ['app/app/applicant/[id]/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'cases',
    pattern: 'list',
    files: ['app/app/applicant/[id]/missions/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'notifications',
    pattern: 'list',
    files: ['app/app/notifications/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'trips',
    pattern: 'list',
    files: ['app/app/trips/(list)/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'account',
    pattern: 'cards',
    files: ['app/app/account/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'privacy',
    pattern: 'cards',
    files: ['app/app/privacy/page.tsx'],
    converted: false,
    phase: 6,
  },
  {
    screen: 'agency-overview',
    pattern: 'list+pane',
    files: ['app/app/agency/[orgId]/page.tsx'],
    converted: false,
    phase: 7,
  },
  {
    screen: 'agency-clients',
    pattern: 'list+pane',
    files: ['app/app/agency/[orgId]/clients/page.tsx'],
    converted: false,
    phase: 7,
  },
  {
    screen: 'agency-cases',
    pattern: 'list+pane',
    files: ['app/app/agency/[orgId]/cases/page.tsx'],
    converted: false,
    phase: 7,
  },
  {
    screen: 'agency-requests',
    pattern: 'list+pane',
    files: ['app/app/agency/[orgId]/collection/page.tsx'],
    converted: false,
    phase: 7,
  },
  {
    screen: 'agency-checklists',
    pattern: 'list+pane',
    files: ['app/app/agency/[orgId]/checklists/page.tsx'],
    converted: false,
    phase: 7,
  },
  {
    screen: 'profile',
    pattern: 'list+pane',
    files: ['app/app/applicant/[id]/profile/page.tsx'],
    converted: false,
    phase: 8,
  },
  {
    screen: 'admin-pack-studio',
    pattern: 'exempt',
    files: ['app/app/admin/packs/page.tsx'],
    converted: false,
    phase: 9,
    reason: 'Staff screens keep naming and headings only, and join the pattern last, if at all.',
  },
];
