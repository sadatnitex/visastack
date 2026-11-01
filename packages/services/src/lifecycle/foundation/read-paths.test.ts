import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  READ_TABLES,
  type ReadLists,
  type ReadSite,
  type ReadTable,
  checkReadSites,
  readSitesOf,
} from './read-paths.test-support';

/*
 * The lifecycle read-path guard (PROGRAMME section 3.3): every exported service function that
 * reads `documents` (from or join), or lists `applicants`, must add the lifecycle rule
 * (`presentDocumentCondition` / `everydayDocumentCondition`, or the applicant pair), or be listed
 * in its owning lane's baseline (to be migrated) or in read-exempt.json (permanent, with reasons).
 * Baselines only shrink: a new unlisted read fails, and so does a listed entry that now complies.
 * Each lane edits only its own baseline file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../..');
const baselineDir = path.join(here, 'read-baseline');

/** Which service modules each lane's baseline may hold (PROGRAMME 5.1 and the lane F brief). */
const LANE_MODULES: Readonly<Record<string, (moduleId: string) => boolean>> = {
  A1: (id) => id === 'missions',
  B: (id) => id === 'wallet' || id === 'notification-sweep',
  E: (id) => id === 'applicants',
  A2: (id) => !['missions', 'wallet', 'notification-sweep', 'applicants'].includes(id),
};

function serviceSites(): ReadSite[] {
  const sites: ReadSite[] = [];
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (/\.test\.ts$|\.test-support\.ts$|\.d\.ts$/.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    const moduleId = path.relative(srcDir, full).replace(/\\/g, '/').replace(/\.ts$/, '');
    sites.push(...readSitesOf(moduleId, readFileSync(full, 'utf8')));
  }
  return sites;
}

function loadLists(): ReadLists {
  const baselines: Record<string, Record<ReadTable, readonly string[]>> = {};
  for (const file of readdirSync(baselineDir)) {
    if (!file.endsWith('.json')) continue;
    baselines[file.replace(/\.json$/, '')] = JSON.parse(
      readFileSync(path.join(baselineDir, file), 'utf8'),
    ) as Record<ReadTable, readonly string[]>;
  }
  const exempt = JSON.parse(readFileSync(path.join(here, 'read-exempt.json'), 'utf8')) as Record<
    ReadTable,
    Record<string, string>
  >;
  return { baselines, exempt };
}

describe('lifecycle read paths', () => {
  const sites = serviceSites();
  const lists = loadLists();

  it('finds the read sites (the scan is not silently empty)', () => {
    expect(sites.filter((site) => site.table === 'documents').length).toBeGreaterThan(20);
    expect(sites.filter((site) => site.table === 'applicants').length).toBeGreaterThan(5);
  });

  it('lists every read that does not apply the lifecycle rule, and only those', () => {
    const problems = checkReadSites(sites, lists);
    expect(
      problems.unlisted,
      'add the lifecycle condition (or, for a permanent reason, read-exempt.json)',
    ).toEqual([]);
    expect(
      problems.stale,
      'remove these entries from your lane baseline: they comply now or are gone',
    ).toEqual([]);
    expect(
      problems.staleExempt,
      'remove these from read-exempt.json: they no longer read the table',
    ).toEqual([]);
    expect(problems.duplicated).toEqual([]);
  });

  it('keeps one baseline file per owning lane, each holding only its own modules', () => {
    expect(Object.keys(lists.baselines).sort()).toEqual(Object.keys(LANE_MODULES).sort());
    for (const [lane, baseline] of Object.entries(lists.baselines)) {
      expect(Object.keys(baseline).sort(), lane).toEqual([...READ_TABLES].sort());
      for (const table of READ_TABLES) {
        const entries = baseline[table] ?? [];
        expect([...entries].sort(), `${lane} ${table} sorted`).toEqual(entries);
        for (const id of entries) {
          const moduleId = id.split('#')[0] ?? '';
          expect(LANE_MODULES[lane]?.(moduleId), `${lane} may not hold ${id}`).toBe(true);
        }
      }
    }
  });

  it('gives every permanent exception a reason', () => {
    for (const table of READ_TABLES) {
      for (const [id, reason] of Object.entries(lists.exempt[table] ?? {})) {
        expect(reason.length, id).toBeGreaterThan(20);
      }
    }
  });
});

describe('the read-path analyser', () => {
  const lists = (baseline: Partial<Record<ReadTable, string[]>> = {}): ReadLists => ({
    baselines: {
      A2: { documents: baseline.documents ?? [], applicants: baseline.applicants ?? [] },
    },
    exempt: { documents: {}, applicants: {} },
  });
  const header = `import { and, eq } from 'drizzle-orm';
import { schema } from './db';
import { everydayDocumentCondition } from './lifecycle/foundation';
`;

  it('fails on a new unlisted read', () => {
    const sites = readSitesOf(
      'fixture',
      `${header}export async function listThings(db) { return db.select().from(schema.documents); }`,
    );
    expect(checkReadSites(sites, lists()).unlisted).toEqual(['documents:fixture#listThings']);
  });

  it('fails on a baseline entry that already complies', () => {
    const sites = readSitesOf(
      'fixture',
      `${header}export async function listThings(db) {
        return db.select().from(schema.documents).where(and(eq(schema.documents.applicantId, 'x'), everydayDocumentCondition()));
      }`,
    );
    expect(sites).toEqual([{ id: 'fixture#listThings', table: 'documents', complies: true }]);
    expect(checkReadSites(sites, lists({ documents: ['fixture#listThings'] })).stale).toEqual([
      'A2:documents:fixture#listThings',
    ]);
    expect(checkReadSites(sites, lists()).unlisted).toEqual([]);
  });

  it('follows aliases, joins and private helpers, and ignores comments and strings', () => {
    const sites = readSitesOf(
      'fixture',
      `${header}const docs = schema.documents;
      async function inner(db) { return db.select().from(schema.missions).innerJoin(docs, eq(docs.id, schema.missions.id)); }
      export async function viaHelper(db) { return inner(db); }
      export async function onlyWords(db) {
        // db.select().from(schema.documents) presentDocumentCondition
        return 'from(schema.documents) everydayDocumentCondition';
      }`,
    );
    expect(sites).toEqual([{ id: 'fixture#viaHelper', table: 'documents', complies: false }]);
  });

  it('exempts an applicant read keyed on its id, but not a join on it', () => {
    const sites = readSitesOf(
      'fixture',
      `${header}export async function one(db, id) { return db.select().from(schema.applicants).where(eq(schema.applicants.id, id)); }
      export async function many(db, owner) {
        return db.select().from(schema.missions).innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId)).where(eq(schema.applicants.ownerAccountId, owner));
      }`,
    );
    expect(sites).toEqual([{ id: 'fixture#many', table: 'applicants', complies: false }]);
  });

  it('counts a condition only when imported from the foundation', () => {
    const sites = readSitesOf(
      'fixture',
      `import { schema } from './db';
      const everydayDocumentCondition = () => undefined;
      export async function spoof(db) { return db.select().from(schema.documents).where(everydayDocumentCondition()); }`,
    );
    expect(sites).toEqual([{ id: 'fixture#spoof', table: 'documents', complies: false }]);
  });
});
