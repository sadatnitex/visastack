import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replaceDocument } from '../lifecycle/replace';
import type { ChangeImpact } from './contract';
import { assessDetailChangeImpact } from './detail';
import { assessDocumentChangeImpact } from './document';
import {
  HEAVY,
  PASSPORT_TYPE,
  buildImpactWorld,
  changeEmploymentDetail,
  makeDocument,
  must,
  ownerManage,
} from './scenario.test-support';

/*
 * Four real results of the shared scenario, kept as files, so the interface is tested against
 * what the service really returns rather than hand-made examples. Each file is exactly the JSON
 * form of a `ChangeImpact` (dates as ISO strings) and nothing else.
 *
 * To make the files stable, the ids the database makes up are replaced by fixed placeholders
 * ("<case:live>", "<request:passport>" ...) and the dates the database stamps are replaced by
 * fixed moments counted back from the clock the reads are given. Nothing else is touched: the
 * items, their order, outcomes, reasons, names and next steps are what the reads returned.
 *
 * The comparison fails on any difference and never rewrites a file by itself. After a deliberate
 * change, write the files again with UPDATE_CHANGE_IMPACT_GOLDEN=1 and review the difference.
 */

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const CLOCK = new Date('2026-11-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
/** What each database-stamped date becomes, by the field it sits in. */
const FIXED_DATES: Readonly<Record<string, string>> = {
  sentAt: new Date(CLOCK.getTime() - 48 * HOUR).toISOString(),
  decidedAt: new Date(CLOCK.getTime() - 24 * HOUR).toISOString(),
  changedAt: new Date(CLOCK.getTime() - HOUR).toISOString(),
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** The JSON form of a result with made-up ids and stamped dates replaced by stable ones. */
function stable(impact: ChangeImpact, placeholders: ReadonlyMap<string, string>): unknown {
  let text = JSON.stringify(impact, (key, value: unknown) =>
    typeof value === 'string' && FIXED_DATES[key] !== undefined ? FIXED_DATES[key] : value,
  );
  for (const [id, placeholder] of placeholders) text = text.split(id).join(placeholder);
  expect(text, 'an id without a placeholder').not.toMatch(UUID);
  return JSON.parse(text);
}

function compareWithFile(name: string, actual: unknown): void {
  const file = path.join(GOLDEN_DIR, name);
  const { UPDATE_CHANGE_IMPACT_GOLDEN: update } = process.env;
  if (update === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
  }
  expect(existsSync(file), `${name} is missing`).toBe(true);
  expect(actual, name).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

describe('golden results of the shared scenario', () => {
  it(
    'match the committed files exactly',
    async () => {
      // Never rewrite on a CI machine, whatever the environment says.
      const { CI: ci, UPDATE_CHANGE_IMPACT_GOLDEN: update } = process.env;
      expect(ci && update).toBeFalsy();

      const w = await buildImpactWorld();
      const p2 = await makeDocument(w.db, w.rahim, PASSPORT_TYPE, 'sample-passport-newer.pdf');
      const placeholders = new Map<string, string>([
        [w.liveCaseId, '<case:live>'],
        [w.finishedCaseId, '<case:finished>'],
        [w.documentRequestId, '<request:passport>'],
        [w.detailRequestId, '<request:employment>'],
        [w.agencyAShareId, '<share:agency-a>'],
        [w.agencyBShareId, '<share:agency-b>'],
        [w.agencyA.organizationId, '<agency:a>'],
        [w.agencyB.organizationId, '<agency:b>'],
        [w.p1.documentId, '<document:p1>'],
        [p2.documentId, '<document:p2>'],
        [w.controlDocument.documentId, '<document:control>'],
        [w.e.factId, '<detail:employment>'],
      ]);
      const proof = await ownerManage(w.db, w.rahim);
      const options = { now: CLOCK };
      const readDocument = async (documentId: string, replacementDocumentId?: string) =>
        stable(
          must(
            await assessDocumentChangeImpact(
              proof,
              { documentId, ...(replacementDocumentId ? { replacementDocumentId } : {}) },
              options,
            ),
            'document',
          ),
          placeholders,
        );

      // The older passport before the replacement, with the newer one named as the candidate.
      compareWithFile('document-preview.json', await readDocument(w.p1.documentId, p2.documentId));
      // A document nothing uses.
      compareWithFile('quiet.json', await readDocument(w.controlDocument.documentId));

      must(
        await replaceDocument(proof, {
          oldDocumentId: w.p1.documentId,
          newDocumentId: p2.documentId,
        }),
        'replace',
      );
      compareWithFile('document-recorded.json', await readDocument(w.p1.documentId));

      await changeEmploymentDetail(w);
      compareWithFile(
        'detail-recorded.json',
        stable(
          must(await assessDetailChangeImpact(proof, { factId: w.e.factId }, options), 'detail'),
          placeholders,
        ),
      );
    },
    HEAVY,
  );
});
