import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf';
import { Recorder, percentile, summarise } from './stats';

describe('percentile and summary', () => {
  it('uses nearest rank', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 99)).toBe(5);
  });

  it('counts errors and keeps samples per label', async () => {
    const r = new Recorder();
    await r.time('a', async () => 1);
    await expect(
      r.time('a', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(r.summary('a').count).toBe(2);
    expect(r.summary('a').errors).toBe(1);
    expect(summarise([1, 2, 3]).mean).toBe(2);
  });
});

describe('reference PDF', () => {
  it('is a real PDF with the requested page count marker', () => {
    const bytes = buildPdf(10);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 10');
    expect(bytes.length).toBeGreaterThan(10_000);
  });
});

describe('in-memory file store', () => {
  it('returns a fresh copy on every read so one reader cannot empty it for the next', async () => {
    const { MemoryBlobStore } = await import('./memory-blobs');
    const store = new MemoryBlobStore();
    await store.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k',
      contentType: 'application/pdf',
      bytes: buildPdf(1),
    });
    const first = await store.getObject('k');
    structuredClone(first?.bytes.buffer, { transfer: [first?.bytes.buffer as ArrayBuffer] });
    const second = await store.getObject('k');
    expect(second?.bytes.byteLength).toBeGreaterThan(100);
  });
});

describe('process readings', () => {
  it('parses CPU ticks and resident pages, including a process name with spaces', async () => {
    const { parseCpuTicks, parseResidentPages } = await import('./proc');
    const stat =
      '123 (post gres) S 1 123 123 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 1 0 100 1000 100 0';
    expect(parseCpuTicks(stat)).toBe(300);
    expect(parseResidentPages('5000 1200 300 10 0 800 0')).toBe(1200);
  });
});

describe('machine busy share', () => {
  it('is the busy part of the elapsed jiffies', async () => {
    const { busyPercent } = await import('./proc');
    expect(busyPercent({ total: 1000, idle: 800 }, { total: 2000, idle: 1300 })).toBe(50);
    expect(busyPercent({ total: 5, idle: 5 }, { total: 5, idle: 5 })).toBe(0);
  });
});
