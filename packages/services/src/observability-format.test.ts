import { describe, expect, it } from 'vitest';
import { formatObservabilityLine } from './observability-format';

describe('formatObservabilityLine', () => {
  const at = new Date('2026-10-05T12:00:00.000Z');

  it('writes one JSON line with a fixed key order', () => {
    const line = formatObservabilityLine(
      { name: 'job_failure', severity: 'error', metadata: { jobType: 'INTAKE' } },
      at,
    );
    expect(line).toBe(
      '{"at":"2026-10-05T12:00:00.000Z","name":"job_failure","severity":"error","metadata":{"jobType":"INTAKE"}}',
    );
    expect(line).not.toContain('\n');
  });

  it('omits metadata when there is none', () => {
    expect(formatObservabilityLine({ name: 'x', severity: 'info' }, at)).toBe(
      '{"at":"2026-10-05T12:00:00.000Z","name":"x","severity":"info"}',
    );
  });
});
