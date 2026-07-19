/**
 * @visastack/policy — server-authoritative, default-deny authorization.
 *
 * VisaStack's policy engine is the authoritative decision point for
 * applicant-resource access (Build Spec §15). It is pure and deterministic:
 * given an actor, action, resource, and context, it returns an explicit
 * allow/deny `Decision`.
 */

export { authorize, STEP_UP_ACTIONS } from './authorize';
export type {
  Actor,
  AuthContext,
  AuthorizeInput,
  Decision,
  DenyReason,
  Grant,
  GrantStatus,
  Membership,
  Resource,
} from './types';
