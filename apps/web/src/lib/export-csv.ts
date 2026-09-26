import type { AccountExport } from '@visastack/services';
import { buildExportCsvTables } from '@visastack/services';
import JSZip from 'jszip';

/**
 * Bundles the account export's CSV tables into a ZIP (master directive
 * Part 7 §14: "readable JSON/CSV metadata"). Lives in the web layer, not
 * packages/services, because it needs jszip -- an infra/serialization
 * concern, same split as apps/web/src/lib/ai.ts keeping env resolution out
 * of packages/services.
 *
 * Every entry name is a fixed literal from `buildExportCsvTables` (never
 * derived from user data), so this cannot produce a path-traversal or
 * name-collision entry -- the "safe ZIP paths/names" requirement in the
 * directive's "Large export" section is satisfied trivially here. That
 * section's heavier requirements (async durable job, encrypted transient
 * storage, 24h artifact expiry) apply to exports carrying original
 * document bytes, which this bundle deliberately does not include (see
 * export.ts's `knownGaps`) -- this stays a synchronous, in-request
 * response, exactly like the existing JSON export.
 */
export async function buildExportZip(data: AccountExport): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(data.manifest, null, 2));
  for (const csvTable of buildExportCsvTables(data)) {
    if (csvTable.rowCount > 0) {
      zip.file(csvTable.name, csvTable.csv);
    }
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}
