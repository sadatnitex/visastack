import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PermissionAction } from '@visastack/core';

/**
 * Document access-context token (Commercial V1 EVI-06/SEC-05).
 *
 * `blob-token.ts` (packages/adapters) proves "this object key was
 * authorized, and this token has not expired". It carries no actor or
 * grant information at all, by design (it is storage-generic, reused by
 * every backend). That alone cannot satisfy the directive's "redemption
 * must recheck access" / "revoking a grant before redemption must make an
 * already issued token fail": a stateless capability token, once signed,
 * has nothing left to revoke.
 *
 * This is a second, separate signed token, transmitted as its own set of
 * query parameters on the same delivery URL alongside the blob token's own
 * (`d`/`v`/`exp`/`sig`/`f`, all prefixed `at` here so neither set can
 * collide with or be mistaken for the other). It lets the serving route
 * replay the ORIGINAL authorization decision against LIVE state at
 * redemption time, not the state that held at mint time. Deliberately not
 * merged into `blob-token.ts`: that module stays storage-generic (works
 * for any object, not just documents), while this one is document/
 * policy-specific and lives beside the service layer that understands
 * `Actor`/`Grant`.
 *
 * Follows `blob-token.ts`'s own field-per-query-param convention rather
 * than packing every field into one opaque delimited string: each value is
 * read back via `URLSearchParams.get`, which already decodes exactly once,
 * correctly, with no risk of a value's own characters colliding with a
 * hand-rolled delimiter or being encoded more times on the way out than
 * decoded on the way back in.
 *
 * Mirrors `step-up.ts`'s own split: pure functions here that take `secret`
 * as an explicit parameter and never read the environment themselves, with
 * the env-resolving caller in `apps/web`.
 */

export type DocumentAccessActorKind =
  | 'applicant_owner'
  | 'organization_member'
  | 'individual_recipient'
  | 'support_admin';

export interface DocumentAccessTokenFields {
  readonly documentId: string;
  /**
   * The specific version `accessDocument` resolved as "latest" at mint
   * time, and whose storage object the accompanying blob token's own
   * objectKey is bound to. Redemption re-verifies THIS version's
   * servability, never "whatever document_versions reports as latest
   * right now", a version added between mint and redemption must not
   * change which version's safety state is actually checked, and a
   * version that becomes unservable (erased, superseded) between mint
   * and redemption must still fail redemption even if a newer sibling
   * version happens to be servable (directive Part 3 §10: "exact
   * version" is one of the properties redemption must re-evaluate).
   */
  readonly documentVersionId: string;
  readonly actorKind: DocumentAccessActorKind;
  /** Absent only for `applicant_owner`, which carries no account id of its own in `Actor`. */
  readonly actorAccountId?: string;
  /** Present only for `organization_member`, so redemption can re-fetch CURRENT membership. */
  readonly organizationId?: string;
  readonly action: PermissionAction;
  readonly purpose: string;
  readonly stepUpSatisfied: boolean;
  readonly exp: number;
  readonly sig: string;
}

const PAYLOAD_PREFIX = 'DAT1';

function signingPayload(fields: Omit<DocumentAccessTokenFields, 'sig'>): string {
  // Each field is individually delimiter-escaped for this signing string
  // specifically (independent of how the token is actually transmitted,
  // which is one query parameter per field, each already exactly-once
  // URL-decoded by URLSearchParams) so no field's own content, including a
  // literal '.', can be mistaken for the join delimiter here.
  return [
    PAYLOAD_PREFIX,
    fields.documentId,
    fields.documentVersionId,
    fields.actorKind,
    fields.actorAccountId ?? '',
    fields.organizationId ?? '',
    fields.action,
    encodeURIComponent(fields.purpose),
    fields.stepUpSatisfied ? '1' : '0',
    fields.exp,
  ].join('.');
}

export function signDocumentAccessToken(
  secret: string,
  fields: Omit<DocumentAccessTokenFields, 'sig'>,
): string {
  return createHmac('sha256', secret).update(signingPayload(fields)).digest('hex');
}

/** Verify a document access-context token: correct signature and not expired. */
export function verifyDocumentAccessToken(
  secret: string,
  fields: DocumentAccessTokenFields,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(fields.exp) || fields.exp * 1000 < now) return false;
  const expected = signDocumentAccessToken(secret, fields);
  const a = Buffer.from(expected);
  const b = Buffer.from(fields.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Query-parameter names `accessDocument`/the serving route use for this token's fields. */
export const DOCUMENT_ACCESS_TOKEN_PARAMS = {
  documentId: 'adid',
  documentVersionId: 'advi',
  actorKind: 'aak',
  actorAccountId: 'aaid',
  organizationId: 'aoid',
  action: 'aact',
  purpose: 'apur',
  stepUpSatisfied: 'asu',
  exp: 'aexp',
  sig: 'asig',
} as const;

/**
 * Appends this token's fields to `url` as individual query parameters
 * (`DOCUMENT_ACCESS_TOKEN_PARAMS`), each `encodeURIComponent`-escaped the
 * same way `neon-blob.ts`/`vercel-blob.ts` already escape the blob token's
 * own `f` (filename) parameter.
 */
export function appendDocumentAccessToken(url: string, fields: DocumentAccessTokenFields): string {
  const p = DOCUMENT_ACCESS_TOKEN_PARAMS;
  const pairs: Array<[string, string]> = [
    [p.documentId, fields.documentId],
    [p.documentVersionId, fields.documentVersionId],
    [p.actorKind, fields.actorKind],
    [p.action, fields.action],
    [p.purpose, fields.purpose],
    [p.stepUpSatisfied, fields.stepUpSatisfied ? '1' : '0'],
    [p.exp, String(fields.exp)],
    [p.sig, fields.sig],
  ];
  if (fields.actorAccountId) pairs.push([p.actorAccountId, fields.actorAccountId]);
  if (fields.organizationId) pairs.push([p.organizationId, fields.organizationId]);
  const query = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${query}`;
}

/**
 * Reads this token's fields back from already-decoded `URLSearchParams`
 * (the standard way a Next.js route reads its own request URL). Returns
 * `undefined` when any required field is missing or malformed, never
 * throws.
 */
export function readDocumentAccessToken(
  searchParams: URLSearchParams,
): DocumentAccessTokenFields | undefined {
  const p = DOCUMENT_ACCESS_TOKEN_PARAMS;
  const documentId = searchParams.get(p.documentId);
  const documentVersionId = searchParams.get(p.documentVersionId);
  const actorKind = searchParams.get(p.actorKind);
  const action = searchParams.get(p.action);
  const purpose = searchParams.get(p.purpose);
  const expRaw = searchParams.get(p.exp);
  const sig = searchParams.get(p.sig);
  if (!documentId || !documentVersionId || !actorKind || !action || !purpose || !expRaw || !sig) {
    return undefined;
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return undefined;
  if (
    actorKind !== 'applicant_owner' &&
    actorKind !== 'organization_member' &&
    actorKind !== 'individual_recipient' &&
    actorKind !== 'support_admin'
  ) {
    return undefined;
  }
  const actorAccountId = searchParams.get(p.actorAccountId);
  const organizationId = searchParams.get(p.organizationId);
  return {
    documentId,
    documentVersionId,
    actorKind,
    ...(actorAccountId ? { actorAccountId } : {}),
    ...(organizationId ? { organizationId } : {}),
    action: action as PermissionAction,
    purpose,
    stepUpSatisfied: searchParams.get(p.stepUpSatisfied) === '1',
    exp,
    sig,
  };
}
