import type { Messages } from '../../../lib/client-messages';

/** The words `DeletionPanel` shows; the page picks them with `pickMessages(locale, DELETION_PANEL_KEYS)`. */
export const DELETION_PANEL_KEYS = [
  'privacy.deletion.pending',
  'privacy.deletion.cancel',
  'privacy.deletion.cancelling',
  'privacy.deletion.blocked.one',
  'privacy.deletion.blocked.other',
  'privacy.deletion.hold',
  'privacy.deletion.scope.case',
  'privacy.deletion.scope.document',
  'privacy.deletion.scope.profile',
  'privacy.deletion.review.none',
  'privacy.deletion.access.none',
  'privacy.deletion.warning',
  'privacy.deletion.impact.applicants.one',
  'privacy.deletion.impact.applicants.other',
  'privacy.deletion.impact.none',
  'privacy.deletion.impact.cases.one',
  'privacy.deletion.impact.cases.other',
  'privacy.deletion.impact.documents.one',
  'privacy.deletion.impact.documents.other',
  'privacy.deletion.impact.roles.one',
  'privacy.deletion.impact.roles.other',
  'privacy.deletion.impact.notes.one',
  'privacy.deletion.impact.notes.other',
  'privacy.deletion.copy',
  'privacy.deletion.confirm',
  'privacy.deletion.reason',
  'privacy.deletion.reasonPlaceholder',
  'privacy.deletion.request',
  'privacy.deletion.requesting',
] as const;

export type DeletionPanelMessages = Messages<(typeof DELETION_PANEL_KEYS)[number]>;
