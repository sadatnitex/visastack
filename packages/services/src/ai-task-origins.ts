import { inArray } from 'drizzle-orm';
import { aiSuggestionsAvailable } from './ai-suggestions';
import { type Db, schema } from './db';

/** The AI app that added a task (S21), as it was named when it added it. */
export interface TaskAddedBy {
  /** Cleaned again before it is shown. */
  readonly appName: string;
  readonly appHost: string;
}

/**
 * Which of these tasks an AI app added, and which app. Read beside a task list the owner is
 * already allowed to read: the rows hold no record data, only the app's name and address, keyed by
 * task. Empty until migration 0105 runs.
 *
 * A task an AI app added is private to the record's owner (owner decision, 30 Oct 2026): every
 * agency read and write of tasks leaves it out through `agencyVisibleTasks`.
 */
export async function taskAddedByApps(
  db: Db,
  taskIds: readonly string[],
): Promise<ReadonlyMap<string, TaskAddedBy>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0 || !(await aiSuggestionsAvailable(db))) return new Map();
  const rows = await db
    .select({
      taskId: schema.aiTaskOrigins.taskId,
      appName: schema.aiTaskOrigins.clientName,
      appHost: schema.aiTaskOrigins.clientHost,
    })
    .from(schema.aiTaskOrigins)
    .where(inArray(schema.aiTaskOrigins.taskId, ids));
  return new Map(
    rows.map((row) => [row.taskId, { appName: row.appName, appHost: row.appHost }] as const),
  );
}
