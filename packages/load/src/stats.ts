/** Percentile by the nearest-rank method on a copy of the samples. Returns 0 for no samples. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] as number;
}

export interface Summary {
  readonly count: number;
  readonly errors: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

export function summarise(samples: readonly number[], errors = 0): Summary {
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    errors,
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    p99: round(percentile(samples, 99)),
    max: round(samples.length ? Math.max(...samples) : 0),
    mean: round(samples.length ? total / samples.length : 0),
  };
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Collects timings by label. */
export class Recorder {
  private readonly times = new Map<string, number[]>();
  private readonly failures = new Map<string, number>();

  async time<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await run();
    } catch (error) {
      this.failures.set(label, (this.failures.get(label) ?? 0) + 1);
      throw error;
    } finally {
      const list = this.times.get(label) ?? [];
      list.push(performance.now() - start);
      this.times.set(label, list);
    }
  }

  record(label: string, ms: number): void {
    const list = this.times.get(label) ?? [];
    list.push(ms);
    this.times.set(label, list);
  }

  fail(label: string): void {
    this.failures.set(label, (this.failures.get(label) ?? 0) + 1);
  }

  labels(): string[] {
    return [...new Set([...this.times.keys(), ...this.failures.keys()])].sort();
  }

  samples(label: string): number[] {
    return this.times.get(label) ?? [];
  }

  summary(label: string): Summary {
    return summarise(this.samples(label), this.failures.get(label) ?? 0);
  }

  all(): number[] {
    return [...this.times.values()].flat();
  }

  totalErrors(): number {
    return [...this.failures.values()].reduce((a, b) => a + b, 0);
  }
}
