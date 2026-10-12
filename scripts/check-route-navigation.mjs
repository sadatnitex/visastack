import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function sourceFiles(cwd) {
  try {
    return execFileSync('rg', ['--files', 'apps/web/src', 'packages'], { cwd, encoding: 'utf8' })
      .trim()
      .split('\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const files = [];
    function walk(relative) {
      for (const entry of fs.readdirSync(path.join(cwd, relative), { withFileTypes: true })) {
        if (['node_modules', 'dist', 'build', '.next', '.turbo'].includes(entry.name)) continue;
        const candidate = path.join(relative, entry.name);
        if (entry.isDirectory()) walk(candidate);
        else if (entry.isFile()) files.push(candidate);
      }
    }
    walk('apps/web/src');
    walk('packages');
    return files;
  }
}

/** Source destinations include links, navigation data, redirects, GET forms and invitation emails.
 * This guards the route graph; it does not claim authenticated or provider-backed acceptance.
 */
export function auditNavigation(cwd = process.cwd()) {
  const files = sourceFiles(cwd).filter(
    (p) => /\.(tsx?|jsx?)$/.test(p) && !/(?:\.test\.|test-support|\/tests\/)/.test(p),
  );
  const pages = files
    .filter((p) => p.startsWith('apps/web/src/app/') && p.endsWith('/page.tsx'))
    .map((p) => `/${p.slice('apps/web/src/app/'.length, -'/page.tsx'.length)}`)
    .map((p) => (p === '/' ? '/' : p.replace(/\([^/]+\)\//g, '')));
  const handlers = files
    .filter((p) => p.startsWith('apps/web/src/app/') && p.endsWith('/route.ts'))
    .map((p) => `/${p.slice('apps/web/src/app/'.length, -'/route.ts'.length)}`);
  const references = [];
  function matches(route, target) {
    const a = route.split('/');
    const b = target.split('/');
    return a.length === b.length && a.every((s, i) => (s.startsWith('[') ? !!b[i] : s === b[i]));
  }
  for (const file of files) {
    const s = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(cwd, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const vars = [];
    function collect(n) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let scope = n.parent;
        while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
        vars.push({ name: n.name.text, init: n.initializer, scope });
      }
      ts.forEachChild(n, collect);
    }
    collect(s);
    function value(n, depth = 0) {
      if (!n || depth > 5) return '*';
      if (ts.isStringLiteralLike(n)) return n.text;
      if (ts.isTemplateExpression(n))
        return (
          n.head.text +
          n.templateSpans.map((x) => value(x.expression, depth + 1) + x.literal.text).join('')
        );
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return value(n.left, depth + 1) + value(n.right, depth + 1);
      if (ts.isIdentifier(n)) {
        const candidates = vars
          .filter(
            (x) =>
              x.name === n.text &&
              x.scope &&
              x.scope.pos <= n.pos &&
              x.scope.end >= n.end &&
              x.init.pos < n.pos,
          )
          .sort((a, b) => a.scope.end - a.scope.pos - (b.scope.end - b.scope.pos));
        if (candidates[0]) return value(candidates[0].init, depth + 1);
      }
      return '*';
    }
    function record(n, kind) {
      let v = value(n);
      if (v.startsWith('*')) {
        const idx = v.search(/\/(?:app|auth)\/|\/invitation(?:[?#]|$)/);
        if (idx > 0) v = v.slice(idx);
      }
      if (!v.startsWith('/') || v.startsWith('//')) return;
      v = v.split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (
        v.startsWith('/api/') ||
        v.includes('**') ||
        (v.includes('*') &&
          v
            .split('/')
            .some((x, i) => x === '*' && !pages.some((p) => p.split('/')[i]?.startsWith('['))))
      )
        return;
      references.push({
        target: v,
        file,
        line: s.getLineAndCharacterOfPosition(n.getStart(s)).line + 1,
        kind,
      });
    }
    function walk(n) {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        /^(?:accept|acceptance)(?:Url|URL)$/.test(n.name.text) &&
        n.initializer
      )
        record(n.initializer, 'email-acceptance');
      if (ts.isJsxAttribute(n) && ['href', 'action'].includes(n.name.getText(s)) && n.initializer)
        record(
          ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer,
          'link',
        );
      if (
        ts.isPropertyAssignment(n) &&
        ['href', 'redirectTo', 'callbackURL', 'redirectUrl'].includes(
          n.name.getText(s).replace(/['"]/g, ''),
        )
      )
        record(n.initializer, 'destination');
      if (
        ts.isCallExpression(n) &&
        /(?:^redirect$|\.redirect$|\.push$|\.replace$)/.test(n.expression.getText(s)) &&
        n.arguments[0]
      )
        record(n.arguments[0], 'redirect');
      if (ts.isNewExpression(n) && n.expression.getText(s) === 'URL' && n.arguments?.[0])
        record(n.arguments[0], 'url');
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        n.left.getText(s).endsWith('.pathname')
      )
        record(n.right, 'pathname');
      ts.forEachChild(n, walk);
    }
    walk(s);
  }
  const invalid = references.filter(
    (x) =>
      ![...pages, ...handlers].some((p) => matches(p, x.target)) &&
      !pages.some((p) => p.startsWith(`${x.target}/`)),
  );
  const uncovered = pages.filter((p) => !references.some((x) => matches(p, x.target)));
  return { pages: pages.sort(), references, invalid, uncovered };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditNavigation(process.argv[2] || process.cwd());
  if (report.invalid.length || report.uncovered.length) {
    console.error(
      JSON.stringify({ invalid: report.invalid, unreferencedPages: report.uncovered }, null, 2),
    );
    process.exitCode = 1;
  } else {
    console.info(
      `Navigation: ${report.pages.length} pages, ${report.references.length} source references, no dangling targets or unreferenced pages.`,
    );
  }
}
