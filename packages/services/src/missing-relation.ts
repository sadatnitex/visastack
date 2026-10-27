/**
 * Postgres `undefined_table` (42P01) or `undefined_column` (42703), as raised
 * directly or wrapped by the driver: the expected failure between a deploy
 * and the migration that adds these tables.
 */
export function isMissingRelationError(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42P01' || code === '42703') return true;
    if (typeof message === 'string' && /(relation|column) .* does not exist/i.test(message)) {
      return true;
    }
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}
