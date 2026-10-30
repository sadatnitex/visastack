import type { PermissionAction } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
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
let mint: (
  accountId: string,
  action: PermissionAction,
  resourceId: string,
  expiresAtMs: number,
) => StepUpProof;

export class StepUpProof {
  readonly #brand = 'StepUpProof';
  readonly accountId: string;
  readonly action: PermissionAction;
  readonly resourceId: string;
  /** When the signed token it came from runs out; the proof runs out with it. */
  readonly expiresAtMs: number;

  private constructor(
    accountId: string,
    action: PermissionAction,
    resourceId: string,
    expiresAtMs: number,
  ) {
    if (!minting) throw new Error('a StepUpProof can only be made by verifyStepUp()');
    this.accountId = accountId;
    this.action = action;
    this.resourceId = resourceId;
    this.expiresAtMs = expiresAtMs;
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
      value.resourceId === expected.resourceId &&
      value.expiresAtMs > Date.now()
    );
  }

  static {
    mint = (accountId, action, resourceId, expiresAtMs) => {
      minting = true;
      try {
        return new StepUpProof(accountId, action, resourceId, expiresAtMs);
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
  return mint(expected.accountId, expected.action, expected.resourceId, token.exp * 1000);
}

/** How long a proof made for one AI connection call lives: long enough for one call, no more. */
const AI_CONNECTION_PROOF_MS = 60 * 1000;

/**
 * The standing identity check behind an AI connection whose owner turned on "Full Document
 * Numbers". The person confirmed who they are on the consent screen before that choice could be
 * saved (S13), and the stored connection is the authority from then on (ADR 0021 section 5).
 *
 * Nothing is taken on trust from the caller: the connection is read again here, and a proof is
 * made only when it is live (activated, not turned off, not past its end), has full numbers on,
 * and its account still owns the record. The proof covers exactly `EXPORT_PROFILE` on that one
 * record, for that owner, for one minute (never past the connection's own end), which is what the
 * context composer asks for. Only the AI gate (`with-ai-connection.ts`) may call this; a guard
 * test fails on any other caller.
 */
export async function stepUpFromAiConnection(
  tx: Db,
  connectionId: string,
): Promise<StepUpProof | undefined> {
  // Always the real time, as in the access gate: a caller-chosen clock could revive an ended connection.
  const now = Date.now();
  try {
    const row = first(
      await tx
        .select({
          accountId: schema.aiConnections.accountId,
          applicantId: schema.aiConnections.applicantId,
          revealIdentifiers: schema.aiConnections.revealIdentifiers,
          activatedAt: schema.aiConnections.activatedAt,
          revokedAt: schema.aiConnections.revokedAt,
          expiresAt: schema.aiConnections.expiresAt,
          ownerAccountId: schema.applicants.ownerAccountId,
        })
        .from(schema.aiConnections)
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.aiConnections.applicantId))
        .where(eq(schema.aiConnections.id, connectionId))
        .limit(1),
    );
    if (
      !row ||
      // An agency connection (S22) names no record and never shows full numbers.
      row.applicantId === null ||
      !row.revealIdentifiers ||
      !row.activatedAt ||
      row.revokedAt ||
      row.ownerAccountId !== row.accountId ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= now)
    ) {
      return undefined;
    }
    const end = Math.min(
      now + AI_CONNECTION_PROOF_MS,
      row.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    return mint(row.accountId, 'EXPORT_PROFILE', row.applicantId, end);
  } catch (error) {
    if (isMissingRelationError(error)) return undefined;
    throw error;
  }
}

/**
 * The standing identity check behind one document the owner ticked as an "Original" under
 * "Original Files" for an AI connection (S20). The person confirmed who they are on the consent
 * screen or in Change Access before an Original could be stored, and the stored choice is the
 * authority from then on, exactly as for Full Document Numbers above.
 *
 * Nothing is taken on trust: the connection and the choice are read again here, and a proof is
 * made only when the connection is live (activated, not turned off, not past its end), its account
 * still owns the record, the document is on that record, and the document is stored as an
 * Original for this connection right now. The proof covers exactly `DOWNLOAD_ORIGINAL` on that one
 * document, for that owner, for one minute (never past the connection's own end). Only the AI gate
 * (`with-ai-connection.ts`) may call this; a guard test fails on any other caller.
 */
export async function stepUpForAiOriginalFile(
  tx: Db,
  connectionId: string,
  documentId: string,
): Promise<StepUpProof | undefined> {
  // Always the real time, as in the access gate: a caller-chosen clock could revive an ended connection.
  const now = Date.now();
  try {
    const row = first(
      await tx
        .select({
          accountId: schema.aiConnections.accountId,
          activatedAt: schema.aiConnections.activatedAt,
          revokedAt: schema.aiConnections.revokedAt,
          expiresAt: schema.aiConnections.expiresAt,
          ownerAccountId: schema.applicants.ownerAccountId,
          variant: schema.aiConnectionDocuments.variant,
          documentId: schema.documents.id,
        })
        .from(schema.aiConnectionDocuments)
        .innerJoin(
          schema.aiConnections,
          eq(schema.aiConnections.id, schema.aiConnectionDocuments.connectionId),
        )
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.aiConnections.applicantId))
        .innerJoin(
          schema.documents,
          and(
            eq(schema.documents.id, schema.aiConnectionDocuments.documentId),
            eq(schema.documents.applicantId, schema.aiConnections.applicantId),
          ),
        )
        .where(
          and(
            eq(schema.aiConnectionDocuments.connectionId, connectionId),
            eq(schema.aiConnectionDocuments.documentId, documentId),
          ),
        )
        .limit(1),
    );
    if (
      !row ||
      row.variant !== 'ORIGINAL' ||
      !row.activatedAt ||
      row.revokedAt ||
      row.ownerAccountId !== row.accountId ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= now)
    ) {
      return undefined;
    }
    const end = Math.min(
      now + AI_CONNECTION_PROOF_MS,
      row.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    return mint(row.accountId, 'DOWNLOAD_ORIGINAL', row.documentId, end);
  } catch (error) {
    if (isMissingRelationError(error)) return undefined;
    throw error;
  }
}
