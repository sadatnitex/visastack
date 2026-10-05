import { afterEach, describe, expect, it, vi } from 'vitest';
import { tolerate } from './tolerate';

describe('tolerate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the value and records nothing when the read works', async () => {
    const failed: string[] = [];
    await expect(tolerate('ok', async () => 42, 0, failed)).resolves.toBe(42);
    expect(failed).toEqual([]);
  });

  it('returns the fallback, records the label and logs the message when the read fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed: string[] = [];
    const value = await tolerate(
      'AI cost',
      async () => {
        throw new Error('relation "ocr_runs" does not exist');
      },
      0,
      failed,
    );
    expect(value).toBe(0);
    expect(failed).toEqual(['AI cost']);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('AI cost');
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('ocr_runs');
  });

  it('keeps going across several failures, recording each section once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed: string[] = [];
    const boom = async () => {
      throw new Error('x');
    };
    const [a, b, c] = await Promise.all([
      tolerate('a', boom, 'fa', failed),
      tolerate('b', async () => 'fine', 'fb', failed),
      tolerate('c', boom, 'fc', failed),
    ]);
    expect([a, b, c]).toEqual(['fa', 'fine', 'fc']);
    expect([...failed].sort()).toEqual(['a', 'c']);
  });

  it('does not swallow a non-Error rejection into silence', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed: string[] = [];
    await tolerate('weird', () => Promise.reject('plain string'), 1, failed);
    expect(failed).toEqual(['weird']);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('plain string');
  });
});
