/**
 * @visastack/adapters — concrete, no-external-dependency infrastructure
 * adapters that satisfy the service-layer ports. Today: Neon-bytea storage and
 * a built-in structural safety scanner (ADR-0011). Swap for S3/ClamAV later
 * behind the same interfaces with no domain change.
 */

export {
  type BlobTokenFields,
  NeonBlobStorage,
  type NeonBlobStorageOptions,
  verifyBlobToken,
} from './neon-blob';

export { BasicSafetyScanner, type BasicSafetyScannerOptions } from './scanner';
