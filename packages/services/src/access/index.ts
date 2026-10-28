/**
 * The central authorization gate (see require-access.ts and principal.ts).
 * The proof and scope classes are exported for their types and their
 * `isGenuine` checks; their constructors refuse to run outside access/.
 */

export {
  type AccountPrincipal,
  type Principal,
  type SystemJob,
  StaffScope,
  SystemScope,
  SYSTEM_JOBS,
  accountPrincipal,
  staffPrincipal,
  systemPrincipal,
} from './principal';
export {
  type AccessActor,
  type AccessPurpose,
  type ActingFor,
  type ApplicantResourceRef,
  type AuthorizedResource,
  type RequireAccessOptions,
  AuthorizedApplicant,
  CONTRIBUTOR_ACTIONS,
  DEFAULT_DOCUMENT_PROTECTION,
  EACH_GRANT,
  RESTRICTED_DOCUMENT_CATEGORIES,
  RESTRICTED_DOCUMENT_TYPES,
  isRestrictedDocumentType,
  requireAccess,
} from './require-access';
export {
  type DocumentProtectionOverride,
  type DocumentProtectionSettings,
  applyDocumentProtectionOverrides,
} from './restricted-documents';
export { StepUpProof, verifyStepUp } from './step-up-proof';
export {
  type CalendarFeedHolder,
  generateCalendarFeedSecret,
  hashCalendarFeedSecret,
  isCalendarFeedSecretShape,
  requireCalendarFeedAccess,
  resolveCalendarFeedSecret,
} from './calendar-feed-secret';
