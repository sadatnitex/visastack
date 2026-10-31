/**
 * Compile-time proof that gate values cannot be forged. Every line marked
 * `@ts-expect-error` must fail to type-check; if one ever compiles, the
 * directive itself becomes an error, so `pnpm run typecheck` and
 * forgery.test.ts both go red. Never imported at run time.
 */
import type { Applicant } from '../applicants';
import {
  AuthorizedApplicant,
  type RequireAccessOptions,
  type SelfScope,
  type StaffScope,
  StepUpProof,
  type SystemScope,
} from './index';

declare const proof: AuthorizedApplicant<'MANAGE'>;
declare const previewProof: AuthorizedApplicant<'PREVIEW'>;
declare const applicantY: Applicant;
declare const staff: StaffScope<'PACK_MANAGE'>;
declare const job: SystemScope<'process-erasure'>;
declare const stepUp: StepUpProof;
declare const self: SelfScope;

// A spread copy loses the #private brand, so it is not a proof.
// @ts-expect-error spread forgery of a proof
export const forgedProof: AuthorizedApplicant<'MANAGE'> = { ...proof, applicant: applicantY };

// The constructor is private.
// @ts-expect-error direct construction of a proof
export const builtProof = new AuthorizedApplicant({} as never);

// A proof for one action is not a proof for another.
// @ts-expect-error PREVIEW proof used as MANAGE proof
export const widenedProof: AuthorizedApplicant<'MANAGE'> = previewProof;

// @ts-expect-error spread forgery of a staff scope
export const forgedStaff: StaffScope<'PACK_MANAGE'> = { ...staff, accountId: 'someone-else' };

// @ts-expect-error a staff scope for one platform action used for another
export const otherStaff: StaffScope<'RETENTION_PURGE'> = staff;

// @ts-expect-error spread forgery of a system scope
export const forgedJob: SystemScope<'process-erasure'> = { ...job };

// @ts-expect-error a system scope for one job used for another
export const otherJob: SystemScope<'process-intake'> = job;

// @ts-expect-error spread forgery of a step-up proof
export const forgedStepUp: StepUpProof = { ...stepUp };

// @ts-expect-error direct construction of a step-up proof
export const builtStepUp = new StepUpProof('a', 'PREVIEW', 'b');

// A step-up is never a boolean a caller can claim.
// @ts-expect-error step-up claimed as a boolean
export const claimedStepUp: RequireAccessOptions = { purpose: 'self', stepUpSatisfied: true };

// The evaluation time is never caller-chosen.
// @ts-expect-error caller-chosen clock
export const chosenClock: RequireAccessOptions = { purpose: 'self', now: new Date(0) };

// ADR 0025: a self scope names the signed-in person; a copy naming someone else is not one.
// @ts-expect-error spread forgery of a self scope
export const forgedSelf: SelfScope = { ...self, accountId: 'someone-else' };

// @ts-expect-error a staff scope is not a self scope
export const staffAsSelf: SelfScope = staff;
