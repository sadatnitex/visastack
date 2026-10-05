import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleObservabilityPort } from './observability';

describe('ConsoleObservabilityPort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an error to stderr, a warning to warn and the rest to info, as one JSON line each', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const port = new ConsoleObservabilityPort();
    port.record({ name: 'a', severity: 'error' });
    port.record({ name: 'b', severity: 'warning', metadata: { n: 1 } });
    port.record({ name: 'c', severity: 'info' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(parsed).toMatchObject({ name: 'b', severity: 'warning', metadata: { n: 1 } });
    expect(typeof parsed.at).toBe('string');
  });
});
