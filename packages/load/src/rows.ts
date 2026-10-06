/** Rows from `db.execute(...)`. Both the Neon and in-memory drivers return `{ rows }`, but the shared handle types it as unknown. */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
