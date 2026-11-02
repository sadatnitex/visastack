import { createHash } from 'node:crypto';
import { hashInvitationToken } from '../invitation-tokens';
import { isUuid } from '../lifecycle/foundation/ids';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';

/**
 * The two proofs that open the guest desk tables of an agency document request (UMPE P8, ADR 0026
 * D4). A guest has no account, so neither proof names a person: each is possession of one secret,
 * checked live by the service that receives it. The access ratchet (`enforcement.test.ts`) holds
 * every exported service touching the guest or request tables to taking a request gate.
 *
 * - `GuestCollectionSessionProof`: possession of a desk session id, the random value in the
 *   httpOnly `/collect` cookie. It carries only the id's SHA-256; services find the session by it
 *   and re-check, every time, that the session is live (not revoked, not idle for 30 minutes, not
 *   past its 12 hour end) and that its link is still open. Only `guestCollectionSessionProof`
 *   makes one, and a static test allows only the public `/collect` route to call it.
 * - `GuestCodeDeliveryProof`: possession of a sealed one-time code at send time. Only the
 *   notification worker, which unseals it from the queued email, makes one (`guestCodeDeliveryProof`),
 *   so it can ask whether the code may still be sent.
 *
 * Both are classes with a private constructor and a `#private` brand, like `CollectionLinkProof`:
 * an object literal or a spread copy is not one, at compile time or at run time.
 */

let mintingSession = false;
let mintSession: (sessionHash: string) => GuestCollectionSessionProof;
let mintingDelivery = false;
let mintDelivery: (codeId: string, codeHash: string) => GuestCodeDeliveryProof;

export class GuestCollectionSessionProof {
  readonly #brand = 'GuestCollectionSessionProof';
  readonly kind = 'guest_collection_session' as const;
  /** The SHA-256 of the presented session id: what the session table stores. */
  readonly sessionHash: string;

  private constructor(sessionHash: string) {
    if (!mintingSession) {
      throw new Error(
        'a GuestCollectionSessionProof can only be made by guestCollectionSessionProof()',
      );
    }
    this.sessionHash = sessionHash;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is GuestCollectionSessionProof {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintSession = (sessionHash: string): GuestCollectionSessionProof => {
      mintingSession = true;
      try {
        return new GuestCollectionSessionProof(sessionHash);
      } finally {
        mintingSession = false;
      }
    };
  }
}

export class GuestCodeDeliveryProof {
  readonly #brand = 'GuestCodeDeliveryProof';
  readonly kind = 'guest_code_delivery' as const;
  readonly codeId: string;
  /** The salted SHA-256 of the unsealed code: what the code table stores. */
  readonly codeHash: string;

  private constructor(codeId: string, codeHash: string) {
    if (!mintingDelivery) {
      throw new Error('a GuestCodeDeliveryProof can only be made by guestCodeDeliveryProof()');
    }
    this.codeId = codeId;
    this.codeHash = codeHash;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is GuestCodeDeliveryProof {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintDelivery = (codeId: string, codeHash: string): GuestCodeDeliveryProof => {
      mintingDelivery = true;
      try {
        return new GuestCodeDeliveryProof(codeId, codeHash);
      } finally {
        mintingDelivery = false;
      }
    };
  }
}

/** A raw session id: 32 random bytes in base64url (`generateInvitationToken`). */
const SESSION_SHAPE = /^[A-Za-z0-9_-]{43}$/;
/** A one-time code: exactly six digits. */
const CODE_SHAPE = /^\d{6}$/;

/**
 * The stored form of a one-time code: a SHA-256 salted with the code row's id, so the same six
 * digits never hash alike twice. A code is worthless without the session that asked for it (whose
 * raw id is never stored), so a copy of the table alone cannot open a desk.
 */
export function guestCodeHash(codeId: string, code: string): string {
  return createHash('sha256').update(`guest-code:${codeId}:${code}`, 'utf8').digest('hex');
}

/** Whether `value` is six digits, after spaces and dashes a person may type are removed. */
export function normalizeGuestCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  return CODE_SHAPE.test(digits) ? digits : null;
}

/**
 * A proof of holding a desk session id, or null for anything that cannot be one (or while the
 * switch is off). It proves nothing until a service finds the live session it names.
 */
export function guestCollectionSessionProof(
  rawSessionId: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GuestCollectionSessionProof | null {
  if (!agencyCollectionRequestsEnabled(env)) return null;
  if (typeof rawSessionId !== 'string' || !SESSION_SHAPE.test(rawSessionId)) return null;
  return mintSession(hashInvitationToken(rawSessionId));
}

/**
 * A proof of holding the code a queued email carries, or null for anything malformed (or while the
 * switch is off). Only the notification worker calls this.
 */
export function guestCodeDeliveryProof(
  codeId: unknown,
  code: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GuestCodeDeliveryProof | null {
  if (!agencyCollectionRequestsEnabled(env)) return null;
  if (typeof codeId !== 'string' || !isUuid(codeId)) return null;
  const digits = typeof code === 'string' && CODE_SHAPE.test(code) ? code : null;
  if (!digits) return null;
  return mintDelivery(codeId, guestCodeHash(codeId, digits));
}
