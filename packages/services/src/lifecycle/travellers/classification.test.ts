import { createMigratedPglite } from '@visastack/db/testing';
import { describe, expect, it } from 'vitest';
import { APPLICANT_REFERENCES } from './classification';

const HEAVY = 60_000;

/*
 * Red first (LC-E): every column that points at a traveller record must be classified, so a new
 * table can never be forgotten by "Remove Empty Record". Read from a fully migrated database: every
 * foreign key to `applicants`, and every column named like `*applicant_id` even without one.
 */
describe('traveller reference classification', () => {
  it(
    'classifies every column that points at a traveller record, and nothing that does not exist',
    async () => {
      const client = await createMigratedPglite();
      const { rows } = await client.query<{ table_name: string; column_name: string }>(`
        select c.conrelid::regclass::text as table_name, a.attname as column_name
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.confrelid = 'applicants'::regclass
        union
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public' and column_name like '%applicant_id'
           and table_name <> 'applicants'`);
      const inDatabase = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
      const classified = new Set(APPLICANT_REFERENCES.map((ref) => `${ref.table}.${ref.column}`));
      const unclassified = [...inDatabase].filter((key) => !classified.has(key)).sort();
      const stale = [...classified].filter((key) => !inDatabase.has(key)).sort();
      expect(unclassified, 'classify these in lifecycle/travellers/classification.ts').toEqual([]);
      expect(stale, 'these classified columns no longer exist').toEqual([]);
      expect(classified.size).toBe(APPLICANT_REFERENCES.length);
    },
    HEAVY,
  );

  it('counts every table the brief names as data, so a record holding any of them is never removed', () => {
    const data = new Set(
      APPLICANT_REFERENCES.filter((ref) => ref.kind === 'DATA').map((ref) => ref.table),
    );
    for (const table of [
      'facts',
      'documents',
      'missions',
      'grants',
      'sharing_invitations',
      'evidence_requests',
      'contributor_requests',
      'client_invitations',
      'acknowledgements',
      'applicant_photos',
      'ai_connections',
      'calendar_feeds',
      'profile_field_exemptions',
      'notifications',
    ]) {
      expect(data.has(table), table).toBe(true);
    }
    // Only a running erasure is "unfinished"; only the lifecycle row and the audit log never block.
    expect(
      APPLICANT_REFERENCES.filter((ref) => ref.kind !== 'DATA').map(
        (ref) => `${ref.table}:${ref.kind}`,
      ),
    ).toEqual(['erasure_jobs:UNFINISHED', 'applicant_lifecycle:OWN_STATE', 'audit_events:KEPT']);
  });
});
