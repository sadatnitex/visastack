#!/usr/bin/env node
// Steward audit: runs the repository's own safety gates in one pass and prints a short table.
// The gates are listed in scripts/steward/steward.config.json ("audit"), so each repository
// decides what counts as a vulnerability or orphan check. Exit code 1 if any gate fails.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, say } from './lib.mjs';

export function runGate(gate, cwd, timeoutMs = 10 * 60_000) {
  return new Promise((resolve) => {
    const [command, ...args] = gate.cmd;
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).split('\n').slice(-8).join('\n');
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ name: gate.name, ok: false, code: -1, note: `could not start: ${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ name: gate.name, ok: code === 0, code, note: code === 0 ? '' : tail.trim() });
    });
  });
}

export function renderAudit(results) {
  const out = ['AUDIT'];
  for (const r of results) out.push(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}`);
  for (const r of results.filter((x) => !x.ok)) {
    out.push('', `--- ${r.name} (exit ${r.code}) ---`, r.note);
  }
  const failed = results.filter((r) => !r.ok).length;
  out.push('', failed ? `${failed} gate${failed === 1 ? '' : 's'} failed` : 'all gates passed');
  return out.join('\n');
}

async function main() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const results = [];
  for (const gate of config.audit) results.push(await runGate(gate, cwd));
  say(renderAudit(results));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
