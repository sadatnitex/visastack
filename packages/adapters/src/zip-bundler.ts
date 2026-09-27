import type { ZipBundler } from '@visastack/services';
import JSZip from 'jszip';

/**
 * The concrete `ZipBundler` for account export jobs (PRV-04, Part 7 §14).
 * Kept out of `packages/services` for the same reason `apps/web/src/lib/
 * export-csv.ts`'s own ZIP writer is -- that module stays free of a concrete
 * ZIP library dependency, matching the established env/infra split from
 * `ai.ts`. In-memory bundling is sufficient at this codebase's real scale
 * (the platform's own `maxAccountEvidenceBytes` quota bounds a single
 * account's total evidence at a comfortably in-memory size); each file's
 * bytes are added incrementally via `zip.file()` rather than held in an
 * intermediate array-of-all-bytes first.
 */
export class JszipBundler implements ZipBundler {
  async build(
    files: ReadonlyArray<{ readonly name: string; readonly bytes: Uint8Array }>,
  ): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.name, file.bytes);
    }
    return zip.generateAsync({ type: 'uint8array' });
  }
}
