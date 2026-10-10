import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import ts from 'typescript';

export function checkCss(css, source = 'stylesheet') {
  const errors = [];
  const ast = postcss.parse(css, { from: source });
  ast.walkAtRules('media', (rule) => {
    if (/prefers-color-scheme\s*:\s*dark/i.test(rule.params))
      errors.push(`${source}:${rule.source.start.line}: automatic dark appearance`);
  });
  ast.walkDecls((declaration) => {
    const { prop, value } = declaration;
    if (/^(?:box-shadow|text-shadow|(?:-webkit-)?backdrop-filter)$/.test(prop) && value !== 'none')
      errors.push(`${source}:${declaration.source.start.line}: ${prop}`);
    if (/\b(?:linear-gradient|radial-gradient|blur|drop-shadow)\s*\(/i.test(value))
      errors.push(`${source}:${declaration.source.start.line}: decorative effect`);
    if (
      /^(?:background|background-color|--[\w-]+)$/.test(prop) &&
      (/rgba\([^)]*,\s*0?\.\d+\s*\)/i.test(value) ||
        /(?:rgb|hsl)\([^)]*\/\s*(?:0?\.\d+|[1-9]?\d%)\s*\)/i.test(value))
    )
      errors.push(`${source}:${declaration.source.start.line}: translucent surface`);
  });
  return errors;
}

export function checkInline(source, filename = 'component.tsx') {
  const errors = [];
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings = new Map();
  const index = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      bindings.set(node.name.text, node.initializer);
    ts.forEachChild(node, index);
  };
  index(file);
  const inspect = (node, seen = new Set()) => {
    if (ts.isIdentifier(node) && bindings.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text);
      inspect(bindings.get(node.text), seen);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(file).replaceAll(/['"]/g, '');
      const value = ts.isStringLiteralLike(node.initializer)
        ? node.initializer.text
        : node.initializer.getText(file);
      if (
        (/^(?:boxShadow|textShadow|backdropFilter|WebkitBackdropFilter)$/.test(name) &&
          value !== 'none') ||
        /(?:linear-gradient|radial-gradient|drop-shadow|blur)\s*\(/i.test(value)
      )
        errors.push(
          `${filename}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}: inline decorative effect`,
        );
    }
    ts.forEachChild(node, (child) => inspect(child, seen));
  };
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'style' && node.initializer) {
      inspect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return errors;
}

export function scan(root) {
  const errors = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css'))
        errors.push(...checkCss(readFileSync(full, 'utf8'), relative(root, full)));
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test'))
        errors.push(...checkInline(readFileSync(full, 'utf8'), relative(root, full)));
    }
  };
  walk(join(root, 'apps/web/src'));
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = scan(join(dirname(fileURLToPath(import.meta.url)), '..'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else process.stdout.write('Flat UI source checks passed\n');
}
