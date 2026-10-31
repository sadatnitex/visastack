import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignShards, loadShardWeights } from './vitest-shards';

const paths = Array.from({ length: 40 }, (_, i) => `src/file-${String(i).padStart(2, '0')}.test.ts`);
const weights = Object.fromEntries(paths.map((path, i) => [path, ((i * 7919) % 97) * 100 + 50]));

describe('balanced service test shards', () => {
  it('puts every file in exactly one shard, for any shard count', () => {
    for (let count = 1; count <= 9; count += 1) {
      const shards = assignShards(paths, weights, count);
      expect(shards).toHaveLength(count);
      const all = shards.flat();
      expect(all).toHaveLength(paths.length);
      expect(new Set(all)).toEqual(new Set(paths));
    }
  });

  it('still runs files that have no timing yet', () => {
    const fresh = [...paths, 'src/brand-new.test.ts'];
    expect(assignShards(fresh, weights, 6).flat()).toContain('src/brand-new.test.ts');
    expect(assignShards(fresh, {}, 3).flat().sort()).toEqual([...fresh].sort());
  });

  it('gives every shard the same answer whatever order the files arrive in', () => {
    const forward = assignShards(paths, weights, 6);
    const backward = assignShards([...paths].reverse(), weights, 6);
    expect(backward).toEqual(forward);
  });

  it('spreads the work evenly', () => {
    const loads = assignShards(paths, weights, 6).map((shard) =>
      shard.reduce((sum, path) => sum + (weights[path] ?? 0), 0),
    );
    const heaviest = Math.max(...Object.values(weights));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(heaviest);
  });

  it('refuses a shard count that is not a whole positive number', () => {
    expect(() => assignShards(paths, weights, 0)).toThrow();
    expect(() => assignShards(paths, weights, 1.5)).toThrow();
  });

  it('keeps a readable timing list and stays wired into the test settings', () => {
    const list = loadShardWeights();
    expect(Object.keys(list).length).toBeGreaterThan(100);
    for (const value of Object.values(list)) expect(value).toBeGreaterThan(0);
    const config = readFileSync(new URL('./vitest.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/sequencer: BalancedShardSequencer/);
  });
});
