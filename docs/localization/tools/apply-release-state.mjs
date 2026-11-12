#!/usr/bin/env node
/**
 * Applies the owner's blanket approval state (release-state.mjs) to the committed register and
 * review-queue CSVs. Same derivation as build-register.mjs, for a checkout that cannot run the
 * render pipeline. Idempotent. `--check` changes nothing and exits 1 when a file would change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/i18n/register.mjs';
import { approvedGroups, queueStates, registerStates } from './release-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REGISTER = 'docs/localization/VISASTACK_TRANSLATION_REGISTER.csv';
const QUEUES = [
  'docs/localization/data/review-queues/01-ordinary-ui.csv',
  'docs/localization/data/review-queues/02-commercial.csv',
  'docs/localization/data/review-queues/03-privacy-consent-legal.csv',
  'docs/localization/data/review-queues/04-official-visa-requirements.csv',
];

const quote = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rewrite one CSV text: `states(row)` returns the columns to overwrite. */
export function rewrite(text, states) {
  const rows = parseCsv(text);
  const head = text.slice(0, text.indexOf('\n')).split(',');
  const lines = [head.join(',')];
  for (const r of rows) {
    Object.assign(r, states(r));
    lines.push(head.map((h) => quote(r[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function derive(root = ROOT) {
  const approved = approvedGroups(root);
  const out = new Map();
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  out.set(
    REGISTER,
    rewrite(read(REGISTER), (r) =>
      registerStates(r.semantic_group, approved, {
        review_state: r.review_state,
        release_state: r.release_state,
      }),
    ),
  );
  for (const rel of QUEUES)
    out.set(
      rel,
      rewrite(read(rel), (r) =>
        queueStates(r.semantic_group, approved, {
          review_state: r.review_state,
          reviewer_sign_off: r.reviewer_sign_off,
          sign_off_date: r.sign_off_date,
        }),
      ),
    );
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, text] of derive()) {
    const abs = path.join(ROOT, rel);
    if (fs.readFileSync(abs, 'utf8') === text) continue;
    stale++;
    if (!check) fs.writeFileSync(abs, text);
    process.stdout.write(`${check ? 'would change' : 'updated'} ${rel}\n`);
  }
  if (check && stale) process.exit(1);
}
