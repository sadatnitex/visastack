/**
 * Client/server boundary of every module under apps/web/src, from the import graph.
 *
 * - A file with a 'use client' directive is `client`.
 * - A file with no directive is `client` when only client modules can reach it, `server` when
 *   only server modules can, `shared` when both can (skipped: neither useT nor getServerT is safe
 *   there), and `unknown` when nothing imports it and it is not a route file.
 * Server roots are the Next.js route files; the walk from them stops at 'use client' files.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];
const SERVER_ROOT_RE =
  /\/app\/(.*\/)?(page|layout|template|not-found|global-not-found|default|loading|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.tsx?$|\/(middleware|instrumentation)\.ts$/;

export function directiveOf(code) {
  const sf = ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) break;
    if (st.expression.text === 'use client') return 'client';
    if (st.expression.text === 'use server') return 'server_action';
  }
  return null;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) out.push(p);
  }
  return out;
}

/**
 * @param {string} root repository root
 * @param {{ overrides?: Map<string,string> }} [opts] in-memory file contents (relative path -> code)
 * @returns {Map<string, 'client'|'server'|'shared'|'unknown'>} keyed by repo-relative path
 */
export function buildBoundary(root, opts = {}) {
  const srcAbs = path.join(root, 'apps/web/src');
  const files = walk(srcAbs, []).map((f) => path.relative(root, f).split(path.sep).join('/'));
  const fileSet = new Set(files);
  const read = (rel) => opts.overrides?.get(rel) ?? fs.readFileSync(path.join(root, rel), 'utf8');
  const resolve = (fromRel, spec) => {
    let base;
    if (spec.startsWith('@/')) base = `apps/web/src/${spec.slice(2)}`;
    else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromRel), spec);
    else return null;
    base = path.posix.normalize(base);
    if (fileSet.has(base)) return base;
    for (const e of EXTS) if (fileSet.has(base + e)) return base + e;
    return null;
  };
  const directive = new Map();
  const imports = new Map();
  for (const rel of files) {
    const code = read(rel);
    directive.set(rel, directiveOf(code));
    const info = ts.preProcessFile(code, true, true);
    imports.set(
      rel,
      info.importedFiles.map((f) => resolve(rel, f.fileName)).filter((x) => x !== null),
    );
  }
  const bfs = (roots, stopAtClient) => {
    const seen = new Set();
    const queue = [...roots];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const g of imports.get(f) ?? []) {
        if (stopAtClient && directive.get(g) === 'client') continue;
        queue.push(g);
      }
    }
    return seen;
  };
  const clientReach = bfs(
    files.filter((f) => directive.get(f) === 'client'),
    false,
  );
  const serverReach = bfs(
    files.filter((f) => SERVER_ROOT_RE.test(f) && directive.get(f) !== 'client'),
    true,
  );
  const out = new Map();
  for (const f of files) {
    if (directive.get(f) === 'client') out.set(f, 'client');
    else if (clientReach.has(f) && serverReach.has(f)) out.set(f, 'shared');
    else if (clientReach.has(f)) out.set(f, 'client');
    else if (serverReach.has(f)) out.set(f, 'server');
    else out.set(f, 'unknown');
  }
  return out;
}
