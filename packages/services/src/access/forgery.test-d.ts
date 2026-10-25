/**
 * Compile-time proof that gate values cannot be forged. Every line marked
 * `@ts-expect-error` must fail to type-check; if one ever compiles, the
 * directive itself becomes an error, so `pnpm run typecheck` and
 * forgery.test.ts both go red. Never imported at run time.
 */
import type { Applicant } from '../applicants';
import { AuthorizedApplicant, type StaffScope, type SystemScope } from './index';

declare const proof: AuthorizedApplicant<'MANAGE'>;
declare const previewProof: AuthorizedApplicant<'PREVIEW'>;
declare const applicantY: Applicant;
declare const staff: StaffScope<'PACK_MANAGE'>;
declare const job: SystemScope<'process-erasure'>;

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
