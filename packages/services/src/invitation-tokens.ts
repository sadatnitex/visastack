import { createHash, randomBytes } from 'node:crypto';

/**
 * Shared primitive for every hashed, single-use invitation token in this
 * codebase (`invitations.ts`'s organization invitations, `client-invitations.ts`'s
 * IAM-03 client invitations): a cryptographically random 256-bit token,
 * returned once to the caller and never persisted; only its SHA-256 hash is
 * stored, so a database read alone can never reconstruct a working link.
 */

const TOKEN_BYTES = 32;

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
