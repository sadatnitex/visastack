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
export {
  createNeonDb,
  createPooledDb,
  checkConnection,
  isSchemaApplied,
  resolveDatabaseUrl,
  DATABASE_URL_ENV_CANDIDATES,
  type ExecutableDb,
  type NeonDb,
  type PooledDb,
} from './client';
export {
  getMigrationStatus,
  type MigrationJournalEntry,
  type MigrationStatus,
} from './migration-status';
