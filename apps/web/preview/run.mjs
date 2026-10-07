// `pnpm --filter @visastack/web preview`: seed a made-up world, render every page, then
// screenshot and check each one. Output goes to apps/web/.preview (not committed).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('./node_modules/.bin/vitest', ['run', '-c', 'vitest.preview.config.ts']);
run('node', ['preview/shoot.mjs']);
