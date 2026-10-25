import type { PermissionAction } from '@visastack/core';
import { type StepUpAssuranceFields, verifyStepUpAssurance } from '../step-up';

/**
 * Proof that the person recently confirmed who they are, for exactly one
 * account, one action and one record. `requireAccess` accepts only this,
 * never a boolean: a caller cannot simply claim a step-up happened.
 *
 * Only `verifyStepUp` can make one, and only from a signed, unexpired
 * assurance token (step-up.ts) that names the same account, action and
 * record. Like the other gate classes it has a private constructor and a
 * `#private` brand, so an object literal or a spread copy is not one.
 */

let minting = false;
let mint: (accountId: string, action: PermissionAction, resourceId: string) => StepUpProof;

export class StepUpProof {
  readonly #brand = 'StepUpProof';
  readonly accountId: string;
  readonly action: PermissionAction;
  readonly resourceId: string;

  private constructor(accountId: string, action: PermissionAction, resourceId: string) {
    if (!minting) throw new Error('a StepUpProof can only be made by verifyStepUp()');
    this.accountId = accountId;
    this.action = action;
    this.resourceId = resourceId;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is StepUpProof {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  /** True only for a genuine proof issued for this exact account, action and record. */
  static covers(
    value: unknown,
    expected: {
      readonly accountId: string;
      readonly action: PermissionAction;
      readonly resourceId: string;
    },
  ): boolean {
    return (
      StepUpProof.isGenuine(value) &&
      value.accountId === expected.accountId &&
      value.action === expected.action &&
      value.resourceId === expected.resourceId
    );
  }

  static {
    mint = (accountId, action, resourceId) => {
      minting = true;
      try {
        return new StepUpProof(accountId, action, resourceId);
      } finally {
        minting = false;
      }
    };
  }
}

/**
 * Turn a signed step-up assurance token into a proof, or nothing when the
 * signature, expiry, account, action or record does not match.
 */
export function verifyStepUp(
  secret: string,
  token: StepUpAssuranceFields,
  expected: {
    readonly accountId: string;
    readonly action: PermissionAction;
    readonly resourceId: string;
  },
): StepUpProof | undefined {
  if (secret.length === 0) return undefined;
  if (!verifyStepUpAssurance(secret, token, expected)) return undefined;
  return mint(expected.accountId, expected.action, expected.resourceId);
}
