import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A traveller's edits to their own checklist are display only. The readiness engine, the package,
 * the handoff, snapshots, the selected output, AI, exports and every other reader of the checklist
 * must never see them: if one did, typed text could change what a case needs, or reach a prompt or
 * a frozen record. So only these files may name the table or its module (the classification list
 * only so privacy tooling knows the table exists). A new reader is a decision
 * for the owner, made by adding it here with its reason.
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
  /caseChecklistEdits|case-checklist-edit|case_checklist_edits|setChecklistWording|listCaseChecklistEdits/;

function mentions(dir: string): string[] {
  return sourceFiles(dir)
    .filter((file) => NAMES.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(dir, file).replace(/\\/g, '/'))
    .sort();
}

describe('traveller checklist edits stay out of the engine', () => {
  it('only the edits module, the retention purge, the data classification list and the package index name them in the services', () => {
    expect(mentions(here)).toEqual([
      'case-checklist-edit-tables.ts',
      'case-checklist-edits.ts',
      'case-retention.ts',
      'index.ts',
      'lifecycle/travellers/classification.ts',
    ]);
  });

  it('only the case page and its edit action name them in the web app', () => {
    expect(mentions(webSrc)).toEqual([
      'app/app/mission/[id]/edits-actions.ts',
      'app/app/mission/[id]/page.tsx',
    ]);
  });
});
