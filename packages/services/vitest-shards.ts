import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Splits the service tests into CI shards by how long each file takes, not by file name.
 *
 * Vitest's own split gives every shard the same number of files, picked by a hash of the name. The
 * service files differ a lot in length, so on 31 Oct 2026 the six shards took between 101 and 270
 * seconds and every pull request waited for the slowest one. Here the files are handed out
 * longest first, each to the shard with the least work so far.
 *
 * Every file lands in exactly one shard, so nothing is ever skipped. A file missing from the
 * timing list (a new test) counts as an average file. A stale list only makes the shards less even;
 * it can never drop or repeat a test. Refresh the list with `node scripts/agent/shard-weights.mjs`.
 */

/** Milliseconds per test file, relative to this package (for example "src/audit.test.ts"). */
export type ShardWeights = Readonly<Record<string, number>>;

export function loadShardWeights(): ShardWeights {
  return JSON.parse(readFileSync(new URL('./shard-weights.json', import.meta.url), 'utf8'));
}

/** Assigns every path to one of `count` shards; returns the paths of each shard, in shard order. */
export function assignShards(
  paths: readonly string[],
  weights: ShardWeights,
  count: number,
): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`invalid shard count ${count}`);
  const known = Object.values(weights)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const average = known.length > 0 ? (known[Math.floor(known.length / 2)] ?? 1) : 1;
  const weightOf = (path: string) => {
    const value = weights[path];
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : average;
  };
  const files = [...new Set(paths)]
    .map((path) => ({ path, weight: weightOf(path) }))
    .sort((a, b) => b.weight - a.weight || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ load: 0, paths: [] as string[] }));
  for (const file of files) {
    let lightest = 0;
    for (let i = 1; i < count; i += 1) {
      if ((shards[i]?.load ?? 0) < (shards[lightest]?.load ?? 0)) lightest = i;
    }
    const target = shards[lightest];
    if (!target) throw new Error('shard missing');
    target.paths.push(file.path);
    target.load += file.weight;
  }
  return shards.map((shard) => shard.paths);
}

export default class BalancedShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { config } = this.ctx;
    const shard = config.shard;
    if (!shard) return files;
    const pathOf = (spec: TestSpecification) =>
      relative(config.root, spec.moduleId).split(sep).join('/');
    const mine = new Set(
      assignShards(files.map(pathOf), loadShardWeights(), shard.count)[shard.index - 1] ?? [],
    );
    return files.filter((spec) => mine.has(pathOf(spec)));
  }
}
