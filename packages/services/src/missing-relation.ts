/**
 * Postgres `undefined_table` (42P01) or `undefined_column` (42703), as raised
 * directly or wrapped by the driver: the expected failure between a deploy
 * and the migration that adds these tables.
 */
/**
 * Postgres's own wording, `relation "x" does not exist` or `column "y" does not exist`, read with
 * plain string checks: a pattern with an open-ended middle could run slowly on a crafted message.
 * Only the start of a long message is read.
 */
function missingRelationText(message: string): boolean {
  const text = message.slice(0, 1000).toLowerCase();
  const end = text.indexOf(' does not exist');
  if (end < 0) return false;
  const before = text.slice(0, end);
  return before.includes('relation ') || before.includes('column ');
}

export function isMissingRelationError(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42P01' || code === '42703') return true;
    if (typeof message === 'string' && missingRelationText(message)) return true;
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}
