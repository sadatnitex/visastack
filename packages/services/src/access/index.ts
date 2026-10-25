/**
 * The central authorization gate (see require-access.ts). The brand symbols
 * in brand.ts are intentionally not re-exported.
 */

export {
  type AccountPrincipal,
  type Principal,
  type StaffScope,
  type SystemJob,
  type SystemScope,
  SYSTEM_JOBS,
  accountPrincipal,
  staffPrincipal,
  systemPrincipal,
} from './principal';
export {
  type AccessActor,
  type AccessPurpose,
  type ApplicantResourceRef,
  type AuthorizedApplicant,
  type AuthorizedResource,
  type RequireAccessOptions,
  CONTRIBUTOR_ACTIONS,
  EACH_GRANT,
  requireAccess,
} from './require-access';
