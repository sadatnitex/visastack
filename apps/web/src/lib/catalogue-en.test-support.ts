import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The English values of every message catalogue in apps/web/src/i18n/*.ts, read with the
 * TypeScript parser (no import, so it works the same in any test environment). The wording
 * guards (`vocabulary.test.ts`, `title-case.test.ts`) use it so that moving a string out of a
 * page and into a catalogue never hides it from them.
 */
export const CATALOGUE_DIR = fileURLToPath(new URL('../i18n', import.meta.url));

export interface CatalogueEntry {
  readonly file: string;
  readonly key: string;
  readonly line: number;
  readonly text: string;
}

function stringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

export function catalogueFiles(): string[] {
  return readdirSync(CATALOGUE_DIR)
    .filter((name) => /\.ts$/.test(name) && !/\.test(-support)?\.ts$/.test(name))
    .map((name) => join(CATALOGUE_DIR, name));
}

/** Every `en` entry of every catalogue file. */
export function catalogueEnglish(): CatalogueEntry[] {
  return catalogueFiles().flatMap((file) => {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const found: CatalogueEntry[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'en' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const text = stringValue(property.initializer);
          if (text === null) continue;
          const key = ts.isStringLiteral(property.name)
            ? property.name.text
            : property.name.getText();
          const { line } = sf.getLineAndCharacterOfPosition(property.getStart());
          found.push({ file, key, line: line + 1, text });
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  });
}

/** key to English text, for guards that follow a `t('key')` call back to its wording. */
export function catalogueEnglishByKey(): ReadonlyMap<string, string> {
  return new Map(catalogueEnglish().map((entry) => [entry.key, entry.text]));
}
