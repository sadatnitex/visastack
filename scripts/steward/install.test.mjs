import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOOK_COMMAND, install, mergeSettings, starterConfig } from './install.mjs';

const source = resolve(fileURLToPath(import.meta.url), '../../..');

test('settings merge adds the hook once and keeps other hooks', () => {
  const existing = {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [] },
    other: 1,
  };
  const once = mergeSettings(existing);
  const twice = mergeSettings(once);
  assert.equal(once.hooks.SessionStart.length, 2);
  assert.equal(twice.hooks.SessionStart.length, 2);
  assert.equal(twice.other, 1);
  assert.ok(twice.hooks.SessionStart.some((g) => g.hooks.some((h) => h.command === HOOK_COMMAND)));
  assert.equal(mergeSettings(null).hooks.SessionStart.length, 1);
});

test('installing into a fresh repo copies the kit and never overwrites a config', () => {
  const target = mkdtempSync(join(tmpdir(), 'steward-'));
  const log = install({ source, target, repo: 'acme/app' });
  assert.ok(log.some((line) => line.startsWith('copied scripts/steward/preflight.mjs')));
  assert.ok(existsSync(join(target, 'scripts/steward/lib.mjs')));
  const config = JSON.parse(
    readFileSync(join(target, 'scripts/steward/steward.config.json'), 'utf8'),
  );
  assert.equal(config.repo, 'acme/app');
  assert.deepEqual(config, starterConfig('acme/app'));

  writeFileSync(join(target, 'scripts/steward/steward.config.json'), '{"repo":"acme/custom"}\n');
  install({ source, target, repo: 'acme/app' });
  assert.equal(
    JSON.parse(readFileSync(join(target, 'scripts/steward/steward.config.json'), 'utf8')).repo,
    'acme/custom',
  );

  mkdirSync(join(target, '.claude'), { recursive: true });
  const settings = JSON.parse(readFileSync(join(target, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 1);
});
