import { PROFILE_PACKS } from '../domain';
import { CATALOGUE_DOCUMENTS } from './documents';
import { CATALOGUE_FIELDS } from './fields';
import {
  CATALOGUE_DOCUMENT_GROUPS,
  CATALOGUE_LAYERS,
  CATALOGUE_PURPOSE_FAMILIES,
  PROPOSED_PACKS,
} from './layers';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { CATALOGUE_PURPOSES } from './purposes';
import type { CatalogueField } from './types';

/**
 * The review report for sign-off, generated from the catalogue so it can never disagree with it.
 * A test compares it with docs/product/master-profile-enrichment/CATALOGUE-REPORT.md; change the
 * catalogue and the test fails until the report is regenerated (pnpm --filter @visastack/core
 * test -- -u), so a reviewer always reads what the code really holds.
 */

function cell(value: string): string {
  return value.replace(/\|/g, '/');
}

function count<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function scope(field: CatalogueField): string {
  const families = field.appliesTo === 'all' ? 'All purposes' : field.appliesTo.join(', ');
  return field.countries ? `${families}; ${field.countries.join(', ')}` : families;
}

export function renderCatalogueReport(): string {
  const out: string[] = [];
  const push = (line = '') => out.push(line);

  push('# Master Profile catalogue: review report');
  push();
  push(
    'Generated from the catalogue in `packages/core/src/catalogue`. Do not edit by hand: a test fails when this file and the catalogue disagree. Regenerate with `pnpm --filter @visastack/core test -- -u`.',
  );
  push();
  push(
    'Nothing in this report is live yet. The catalogue is data only. No screen, rule, sharing grant or AI prompt reads it until Phase 2, and the 81 fields that work today are unchanged.',
  );
  push();

  push('## Totals');
  push();
  push('| Item | Count |');
  push('|---|---|');
  push(`| Fields live today (frozen) | ${LEGACY_FIELD_SNAPSHOT.length} |`);
  push(`| Fields added by the catalogue | ${CATALOGUE_FIELDS.length} |`);
  push(
    `| Repeating records added | ${new Set(CATALOGUE_FIELDS.filter((f) => f.group && f.groupLabel).map((f) => f.group)).size} |`,
  );
  push(
    `| Live repeating records extended | ${new Set(CATALOGUE_FIELDS.filter((f) => f.group && !f.groupLabel).map((f) => f.group)).size} |`,
  );
  push(`| Document types | ${CATALOGUE_DOCUMENTS.length} |`);
  push(
    `| Document types recognised by the scanner today | ${count(CATALOGUE_DOCUMENTS, (d) => d.recognisedToday)} |`,
  );
  push(`| Purposes | ${CATALOGUE_PURPOSES.length} |`);
  push(
    `| Fields marked "proposed" (need sign-off) | ${count(CATALOGUE_FIELDS, (f) => f.origin === 'proposed')} |`,
  );
  push(
    `| Document types marked "proposed" (need sign-off) | ${count(CATALOGUE_DOCUMENTS, (d) => d.origin === 'proposed')} |`,
  );
  push();

  push('## Layers');
  push();
  push('| Layer | Live fields | New fields | What it holds |');
  push('|---|---|---|---|');
  for (const layer of CATALOGUE_LAYERS) {
    push(
      `| ${layer.label} | ${count(LEGACY_FIELD_SNAPSHOT, (f) => f.layer === layer.key)} | ${count(CATALOGUE_FIELDS, (f) => f.layer === layer.key)} | ${cell(layer.description)} |`,
    );
  }
  push();

  push('## Sharing categories (packs)');
  push();
  push(
    'A sharing category decides what a grant can include. The five live categories already exist. The proposed ones do not exist yet, which is the safe default: data placed in one cannot be reached by any grant until the category is added on purpose in Phase 2.',
  );
  push();
  push('| Category | Status | Live fields | New fields | Document types | Why it is separate |');
  push('|---|---|---|---|---|---|');
  for (const pack of PROFILE_PACKS) {
    push(
      `| ${pack} | Live | ${count(LEGACY_FIELD_SNAPSHOT, (f) => f.pack === pack)} | ${count(CATALOGUE_FIELDS, (f) => f.pack === pack)} | ${count(CATALOGUE_DOCUMENTS, (d) => d.pack === pack)} | Existing category |`,
    );
  }
  for (const pack of PROPOSED_PACKS) {
    push(
      `| ${pack.key} | Proposed | 0 | ${count(CATALOGUE_FIELDS, (f) => f.pack === pack.key)} | ${count(CATALOGUE_DOCUMENTS, (d) => d.pack === pack.key)} | ${cell(pack.rationale)} |`,
    );
  }
  push(
    `| (none) | No category | 0 | 0 | ${count(CATALOGUE_DOCUMENTS, (d) => d.pack === null)} | Behaves as unmapped types do today |`,
  );
  push();

  push('## Protection');
  push();
  push('| Level | Live fields | New fields |');
  push('|---|---|---|');
  for (const level of ['STANDARD', 'SENSITIVE', 'RESTRICTED'] as const) {
    push(
      `| ${level} | ${count(LEGACY_FIELD_SNAPSHOT, (f) => f.sensitivity === level)} | ${count(CATALOGUE_FIELDS, (f) => f.sensitivity === level)} |`,
    );
  }
  push();
  push(
    'Protection follows what a field holds: national identifiers, legal history, health detail, special categories and biometrics are RESTRICTED; other identifiers, personal dates and money amounts are SENSITIVE. A test refuses any field below the level its kind requires.',
  );
  push();

  push('## Purposes');
  push();
  push(
    'From general knowledge of how immigration systems work and the owner decisions of 2026-10-14. These are not verified rules: a purpose gets a readiness score only once a cited, approved rule pack exists for it.',
  );
  push();
  for (const family of CATALOGUE_PURPOSE_FAMILIES) {
    const items = CATALOGUE_PURPOSES.filter((p) => p.family === family.key);
    push(`### ${family.label} (${items.length})`);
    push();
    push('| Purpose | Handling | Evidence themes | Note |');
    push('|---|---|---|---|');
    for (const p of items) {
      push(
        `| ${cell(p.label)} | ${p.handling} | ${cell(p.evidenceThemes)} | ${cell(p.note ?? '')} |`,
      );
    }
    push();
  }

  push('## Document types');
  push();
  push(
    'Distinct documents stay distinct. Exact duplicates are merged and kept as aliases. Pack is the intended sharing category and is not live: today only Passport, Bank Statement and Employment Certificate have one.',
  );
  push();
  for (const group of CATALOGUE_DOCUMENT_GROUPS) {
    const items = CATALOGUE_DOCUMENTS.filter((d) => d.group === group.key);
    push(`### ${group.label} (${items.length})`);
    push();
    push('| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |');
    push('|---|---|---|---|---|---|---|');
    for (const d of items) {
      const needs = Object.entries(d.handling)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      push(
        `| ${d.key} | ${cell(d.label)} | ${d.pack ?? '(none)'} | ${d.validityMonths ?? ''} | ${needs} | ${cell(d.aliases.join(', '))} | ${d.origin} |`,
      );
    }
    push();
  }

  push('## Fields added');
  push();
  push(
    'Type is text or date. Records marked "extends" add fields to a record that is live today and keep its label and category.',
  );
  push();
  for (const layer of CATALOGUE_LAYERS) {
    const items = CATALOGUE_FIELDS.filter((f) => f.layer === layer.key);
    push(`### ${layer.label} (${items.length})`);
    push();
    push('| Key | Label | Type | Protection | Category | Block | Applies to | Origin |');
    push('|---|---|---|---|---|---|---|---|');
    for (const f of items) {
      const block = f.group
        ? f.groupLabel
          ? `Record: ${f.groupLabel}`
          : `Extends record: ${f.group}`
        : f.sectionLabel
          ? `Section: ${f.sectionLabel}`
          : '';
      push(
        `| ${f.key} | ${cell(f.label)} | ${f.type} | ${f.sensitivity} | ${f.pack} | ${cell(block)} | ${cell(scope(f))} | ${f.origin} |`,
      );
    }
    push();
  }

  push('## Left out on purpose');
  push();
  push(
    '- Raw biometric data (fingerprints, iris scans, face data): only the receipt of an appointment is stored.',
  );
  push('- Full bank account numbers: only the last four digits.');
  push(
    '- Web links to uploaded files (the other product keeps dozens): VisaStack links documents to facts through proof links instead.',
  );
  push(
    '- Yellow fever certificate number and date as separate fields: the Vaccination record already holds them.',
  );
  push(
    '- Gender identity: no clear travel use, and it is a special category. Add only if a route needs it.',
  );
  push('- Wording of any legal, security or health question: held for adviser review.');
  push();

  push('## Needs a decision before Phase 2');
  push();
  push('- Which proposed sharing categories to create, and what each may contain.');
  push(
    '- Whether the live refusal record (in the universal category today) moves to the declarations category.',
  );
  push('- Review of every document type pack before it becomes visible to grants.');
  push(
    '- Adviser sign-off for every item marked "proposed", every adviser-handled purpose, and the exact official names in the labour migration record.',
  );
  push();
  return `${out.join('\n')}\n`;
}
