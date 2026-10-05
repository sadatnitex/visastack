import type { ObservabilityEvent } from './ports';

/**
 * The one line an observability event becomes in a log: JSON with a fixed key
 * order, so a log search or alert rule on `name` or `severity` always works.
 * Shared by the console adapter and by the web app's error reporting so the two
 * can never drift apart.
 */
export function formatObservabilityLine(event: ObservabilityEvent, at: Date = new Date()): string {
  return JSON.stringify({
    at: at.toISOString(),
    name: event.name,
    severity: event.severity,
    ...(event.metadata ? { metadata: event.metadata } : {}),
  });
}
