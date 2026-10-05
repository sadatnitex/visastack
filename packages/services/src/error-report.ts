import type { ObservabilityEvent } from './ports';

/**
 * Turns a thrown error into an observability event that is safe to write to a
 * log (Commercial V1 OPS-03: "instrument without PII leakage").
 *
 * Why this exists: the database layer's error message ends with the query's
 * bound parameters (`Failed query: select ... params: <values>`), and those
 * values are whatever the request was handling: an email address, a name, a
 * passport number. Logging the error object as it comes would write them into a
 * log aggregator that outlives the data. This keeps what diagnoses a failure,
 * which is the error type, the database error code, the statement text without
 * its values, and the call sites, and drops what identifies a person.
 */

const MAX_MESSAGE_LENGTH = 400;
const MAX_STACK_FRAMES = 5;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The five-character Postgres error code, wherever the driver or ORM wrapped it. */
export function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/** The message with bound parameter values, anything after them, and email addresses removed. */
export function redactErrorMessage(message: string): string {
  const withoutParams = message.split(/\r?\n\s*params:/i)[0] ?? message;
  return withoutParams
    .replace(EMAIL_PATTERN, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

/** Call-site frames only: the first stack line repeats the message, so it is not kept. */
function callSites(error: unknown): string | undefined {
  const stack = (error as { stack?: unknown } | null)?.stack;
  if (typeof stack !== 'string') return undefined;
  const frames = stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.trim());
  return frames.length > 0 ? frames.join(' | ') : undefined;
}

export function serverErrorEvent(
  where: string,
  error: unknown,
  extra: Readonly<Record<string, string>> = {},
): ObservabilityEvent {
  const message = error instanceof Error ? error.message : String(error);
  const code = databaseErrorCode(error);
  const sites = callSites(error);
  return {
    name: 'server_error',
    severity: 'error',
    metadata: {
      where,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(code ? { databaseCode: code } : {}),
      message: redactErrorMessage(message),
      ...(sites ? { callSites: sites } : {}),
      ...extra,
    },
  };
}
