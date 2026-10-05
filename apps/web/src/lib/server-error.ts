import 'server-only';
import { formatObservabilityLine, serverErrorEvent } from '@visastack/services';

/**
 * Logs a server-side failure as one structured, sanitised `server_error` event
 * (Commercial V1 OPS-03). Use this instead of `console.error(label, error)` for
 * anything that may have touched the database: the raw error carries the
 * query's bound values, which are whatever the request was handling.
 *
 * Synchronous and dependency-light on purpose, so it is safe to call from a
 * `catch`, a pool `error` listener or a cron route without loading anything
 * heavy.
 */
export function reportServerError(
  where: string,
  error: unknown,
  extra: Readonly<Record<string, string>> = {},
): void {
  console.error(formatObservabilityLine(serverErrorEvent(where, error, extra)));
}

/**
 * Logs that a preview could not be rendered, as a `render_failure` event
 * (Commercial V1 OPS-03 "render failures"). Carries the content type only: never
 * the file name, the renderer's own detail text or any identifier, because the
 * thing being rendered is a person's document.
 */
export function reportRenderFailure(contentType: string): void {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const safe = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type) && type.length <= 100;
  console.warn(
    formatObservabilityLine({
      name: 'render_failure',
      severity: 'warning',
      metadata: { contentType: safe ? type : 'unknown' },
    }),
  );
}
