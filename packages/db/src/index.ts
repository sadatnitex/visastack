/**
 * @visastack/db — canonical persistence layer.
 *
 * Exposes the Drizzle schema and the tamper-evident audit primitives. The
 * concrete database client (Neon in production, PGlite in tests) is created
 * by the caller and passed the schema, keeping this package driver-agnostic.
 */

export * as schema from './schema';
export {
  canonicalizeAuditFields,
  computeAuditHash,
  verifyAuditChain,
  type AuditFieldValue,
} from './audit';
