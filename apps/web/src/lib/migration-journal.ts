import type { MigrationJournalEntry } from '@visastack/db';
import journal from '../../../../packages/db/migrations/meta/_journal.json';

/**
 * The migrations this build ships, read from the same journal the migrator
 * uses. Bundled at build time, so it describes the code that is running, which
 * is exactly what a database has to be compared against.
 */
export const SHIPPED_MIGRATIONS: readonly MigrationJournalEntry[] = journal.entries.map(
  (entry) => ({ tag: entry.tag, when: entry.when }),
);
