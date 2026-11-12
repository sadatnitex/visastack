/**
 * Refills Bengali in every surface catalogue from the register, with no source file analysis.
 *
 * The codemod fills a Bengali value only when it first converts a key. When the release rules or
 * the register change (a review queue is signed off, a hold is lifted, a draft is corrected), the
 * catalogues already on disk need the same lookup again. This is that path: a key with no Bengali
 * and exactly one register group gets the register's Bengali if the same checks pass as at
 * conversion (released queue, not held, automated checks PASS, placeholders match). Bengali that is
 * already in a catalogue is never changed. A second run changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { catalogRel, readCatalog, readSources, renderCatalog, sourcesRel } from './catalog.mjs';
import { Register } from './register.mjs';

/** Surfaces that have a catalogue and a sources map. */
export function listSurfaces(root) {
  const dir = path.join(root, 'apps/web/src/i18n');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sources.json'))
    .map((f) => f.slice(0, -'.sources.json'.length))
    .sort();
}

/**
 * With `groups`, only keys of those register groups are filled: a release of named groups (the
 * owner's sign-off of a set of rows) fills nothing else, even where a draft now exists.
 *
 * @param {{ root: string, register?: Register, surfaces?: string[], groups?: ReadonlySet<string>, dryRun?: boolean, format?: (root: string, rels: string[]) => void }} o
 * @returns {{ surface: string, filled: string[] }[]}
 */
export function refillBengali({ root, register, surfaces, groups, dryRun = false, format }) {
  const reg = register ?? Register.load(root);
  const out = [];
  const written = [];
  for (const surface of surfaces ?? listSurfaces(root)) {
    const catAbs = path.join(root, catalogRel(surface));
    const catalog = readCatalog(catAbs);
    const sources = readSources(path.join(root, sourcesRel(surface)));
    const bn = { ...catalog.bn };
    const filled = [];
    for (const key of Object.keys(catalog.en).sort()) {
      const group = sources[key];
      if (typeof group !== 'string' || group.includes('|')) continue;
      if (groups && !groups.has(group)) continue;
      const r = reg.resolveGroup(group, catalog.en[key]);
      if (bn[key] !== undefined) continue;
      if (!r.bn) continue;
      bn[key] = r.bn;
      filled.push(key);
    }
    out.push({ surface, filled });
    if (!filled.length || dryRun) continue;
    fs.writeFileSync(catAbs, renderCatalog(surface, catalog.en, bn));
    written.push(catalogRel(surface));
  }
  if (format && written.length) format(root, written);
  return out;
}
