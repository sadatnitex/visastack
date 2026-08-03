import type { ObservabilityEvent, ObservabilityPort } from '@visastack/services';

/**
 * The pilot's observability provider: a structured JSON line to stdout
 * (master directive §7 "PR 11" pilot provider: "internal alert dashboard").
 * Vercel's own log viewer and alerting already aggregate and surface stdout
 * from every deployment — that IS the internal alert dashboard available
 * today, not a placeholder standing in for one still to be built.
 */
export class ConsoleObservabilityPort implements ObservabilityPort {
  record(event: ObservabilityEvent): void {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      name: event.name,
      severity: event.severity,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    });
    if (event.severity === 'error') console.error(line);
    else if (event.severity === 'warning') console.warn(line);
    else console.info(line);
  }
}
