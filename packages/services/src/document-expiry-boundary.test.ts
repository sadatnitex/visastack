import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A date a person typed for a document is the person's own word. It reaches the saved expiry date
 * only through the writer (`document-expiry.ts`), which never overwrites a read date, plus the two
 * places that set the saved date themselves and so add rows by the same rules (the passport reading
 * and the copy to another person). It is read back only where its source has to be shown or kept:
 * the lists, the AI output (which labels it as typed), the reminder sweep (which re-arms a corrected
 * date) and the account export. So only these files may name the table or its modules. A new
 * reader is a decision for the owner, made by adding it here with its reason.
 *
 * Every read of the entries must come newest first with the id as the tie-break, because that order
 * is what decides where the saved date came from. The access ratchet forbids one shared ungated
 * loader, so each reader keeps its own query and this test keeps them identical.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../../../apps/web/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.test-support\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const NAMES =
  /documentExpiryEntries|document_expiry_entries|document-expiry-tables|document-expiry-rules|\/document-expiry'|\bsetDocumentExpiry\b/;

function mentions(dir: string): string[] {
  return sourceFiles(dir)
    .filter((file) => NAMES.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(dir, file).replace(/\\/g, '/'))
    .sort();
}

describe('typed expiry dates stay behind a few known files', () => {
  it('only the writer, its rules and table check, the lists, the AI output, the reminder sweep, the passport reading, the copy, the export and the package index name them in the services', () => {
    expect(mentions(here)).toEqual([
      'document-expiry-tables.ts',
      'document-expiry.ts',
      'documents.ts',
      'export-csv.ts',
      'export.ts',
      'index.ts',
      'intake.ts',
      'notification-sweep.ts',
      'selected-output.ts',
      'umpe-document-copies.ts',
    ]);
  });

  it('only the document actions name them in the web app', () => {
    expect(mentions(webSrc)).toEqual(['app/app/applicant/[id]/actions.ts']);
  });

  it('every read of the entries orders them newest first with the id as the tie-break', () => {
    const readers = sourceFiles(here).filter((file) =>
      /\.from\(schema\.documentExpiryEntries\)/.test(readFileSync(file, 'utf8')),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.basename(file)).toMatch(/desc\(schema\.documentExpiryEntries\.createdAt\)/);
      expect(text, path.basename(file)).toMatch(/desc\(schema\.documentExpiryEntries\.id\)/);
    }
  });
});
