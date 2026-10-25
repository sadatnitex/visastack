import { describe, expect, it } from 'vitest';
import { PROFILE_PACKS } from '../domain';
import { resolveDocumentType } from './document-lookup';
import { CATALOGUE_DOCUMENTS } from './documents';
import { CATALOGUE_FIELDS } from './fields';
import { CATALOGUE_DOCUMENT_GROUPS, CATALOGUE_LAYERS, PROPOSED_PACKS } from './layers';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { CATALOGUE_MODULES } from './modules';
import { MAX_KEY_LENGTH, isFieldKey, isTitleCaseLabel } from './naming';
import { CATALOGUE_PURPOSES } from './purposes';
import { MODULE_FIELDS, moduleOfLegacyField } from './queries';
import { LAYER_KEYS, OTHER_OPTION, PROPOSED_PACK_KEYS, PURPOSE_FAMILY_KEYS } from './types';

const ALL_PACKS: readonly string[] = [...PROFILE_PACKS, ...PROPOSED_PACK_KEYS];
const MODULES = CATALOGUE_MODULES.filter((m) => !m.internal);
const moduleByKey = new Map(CATALOGUE_MODULES.map((m) => [m.key, m]));

describe('modules (the opt-in sections)', () => {
  it('are well formed and uniquely named', () => {
    expect(new Set(CATALOGUE_MODULES.map((m) => m.key)).size).toBe(CATALOGUE_MODULES.length);
    for (const m of CATALOGUE_MODULES) {
      expect(isFieldKey(m.key), m.key).toBe(true);
      expect(isTitleCaseLabel(m.label), m.label).toBe(true);
      expect(m.description.length, m.key).toBeGreaterThan(15);
      expect(LAYER_KEYS, m.key).toContain(m.layer);
      expect(ALL_PACKS, m.key).toContain(m.pack);
      for (const family of m.suggestedFor ?? [])
        expect(PURPOSE_FAMILY_KEYS, m.key).toContain(family);
    }
    expect(CATALOGUE_MODULES.filter((m) => m.internal).map((m) => m.key)).toEqual(['other_items']);
  });

  it('place every field exactly once, with no dead or doubled blocks', () => {
    const claims = CATALOGUE_MODULES.flatMap((m) => m.blocks);
    expect(new Set(claims).size, 'a block is claimed twice').toBe(claims.length);
    for (const f of CATALOGUE_FIELDS) {
      expect(f.module, `${f.key} has no section`).not.toBe('');
      expect(moduleByKey.has(f.module), `${f.key} -> ${f.module}`).toBe(true);
    }
    const used = new Set(
      CATALOGUE_FIELDS.map((f) => (f.group ? `G:${f.group}` : `S:${f.section}`)),
    );
    for (const block of claims) expect(used.has(block), `${block} matches no fields`).toBe(true);
  });

  it('claim every live field and record exactly once', () => {
    for (const f of LEGACY_FIELD_SNAPSHOT) {
      expect(moduleOfLegacyField(f.key), `${f.key} belongs to no section`).toBeDefined();
    }
    const fields = CATALOGUE_MODULES.flatMap((m) => m.legacyFields ?? []);
    const groups = CATALOGUE_MODULES.flatMap((m) => m.legacyGroups ?? []);
    expect(new Set(fields).size, 'a live field is claimed twice').toBe(fields.length);
    expect(new Set(groups).size, 'a live record is claimed twice').toBe(groups.length);
    for (const key of fields) {
      expect(
        LEGACY_FIELD_SNAPSHOT.find((f) => f.key === key && !f.group),
        `${key} is not a live single field`,
      ).toBeDefined();
    }
    const liveGroups = new Set(LEGACY_FIELD_SNAPSHOT.flatMap((f) => (f.group ? [f.group] : [])));
    expect([...liveGroups].sort()).toEqual([...groups].sort());
  });

  it('keep one sharing category and one layer inside each section', () => {
    for (const m of MODULES) {
      const fields = MODULE_FIELDS.filter((f) => f.module === m.key);
      expect(fields.length, `${m.key} is empty`).toBeGreaterThan(0);
      for (const f of fields) {
        const live = LEGACY_FIELD_SNAPSHOT.find((l) => l.key === f.key);
        const added = CATALOGUE_FIELDS.find((c) => c.key === f.key);
        const pack = live?.pack ?? added?.pack;
        const layer = live?.layer ?? added?.layer;
        expect(pack, `${f.key} is in ${m.key}`).toBe(m.pack);
        expect(layer, `${f.key} is in ${m.key}`).toBe(m.layer);
      }
    }
  });

  it('open by default only what is live today and common to nearly everyone', () => {
    const open = MODULES.filter((m) => m.defaultOpen).map((m) => m.key);
    expect(open).toEqual([
      'identity_basics',
      'passport',
      'prior_visas',
      'refusals',
      'addresses',
      'travel_history',
      'employment',
      'education',
      'income_and_funding',
      'sponsor_host',
    ]);
    for (const m of MODULES.filter((x) => x.defaultOpen)) {
      expect(m.extends, m.key).toBeUndefined();
      for (const f of CATALOGUE_FIELDS.filter((c) => c.module === m.key)) {
        // Only fields that never count may sit in an open-by-default section: the box beside an
        // "Other" choice, or an optional fact about a live amount (whether it is before or after tax).
        expect(
          ['other_detail', 'amount_detail'],
          `${f.key} would change the default completion figure`,
        ).toContain(f.role);
      }
    }
  });

  it('keep extra detail for an open section as its own locked section', () => {
    for (const m of MODULES.filter((x) => x.extends)) {
      expect(m.defaultOpen, m.key).toBe(false);
      expect(moduleByKey.has(m.extends ?? ''), `${m.key} extends a missing section`).toBe(true);
      expect(m.extends, m.key).not.toBe(m.key);
    }
  });

  it('are all reachable: no section is both empty of counted fields and open by default', () => {
    for (const m of MODULES) {
      const counted = MODULE_FIELDS.filter((f) => f.module === m.key && !f.role);
      expect(counted.length, m.key).toBeGreaterThan(0);
    }
  });

  it('keeps every live record in a section that is open or can be opened', () => {
    for (const g of new Set(LEGACY_FIELD_SNAPSHOT.flatMap((f) => (f.group ? [f.group] : [])))) {
      expect(
        CATALOGUE_MODULES.some((m) => m.legacyGroups?.includes(g)),
        g,
      ).toBe(true);
    }
  });

  it('covers every layer with at least one section', () => {
    for (const layer of CATALOGUE_LAYERS) {
      expect(
        MODULES.some((m) => m.layer === layer.key),
        layer.key,
      ).toBe(true);
    }
  });
});

describe('"Other" everywhere', () => {
  const choices = CATALOGUE_FIELDS.filter((f) => f.options && !f.role);
  const isYesNo = (options: readonly string[]) => options.length === 2 && options.includes('Yes');

  it('ends every real choice with Other and gives it a text box', () => {
    for (const f of choices.filter((c) => !isYesNo(c.options ?? []))) {
      expect(f.options?.at(-1), f.key).toBe(OTHER_OPTION);
      expect(f.allowOther, f.key).toBe(true);
      const companion = CATALOGUE_FIELDS.find((c) => c.key === `${f.key}_other`);
      expect(companion, `${f.key} has no text box for Other`).toBeDefined();
      expect(companion?.role, f.key).toBe('other_detail');
      expect(companion?.module, f.key).toBe(f.module);
      expect(companion?.pack, f.key).toBe(f.pack);
      expect(companion?.group, f.key).toBe(f.group);
      expect(companion?.section, f.key).toBe(f.section);
      expect(companion?.key.length ?? 0, f.key).toBeLessThanOrEqual(MAX_KEY_LENGTH);
      expect(companion?.sensitivity, f.key).toBe(
        f.kind === 'general' || f.kind === 'third_party' ? 'STANDARD' : f.sensitivity,
      );
    }
  });

  it('does not add Other to a plain Yes or No', () => {
    for (const f of choices.filter((c) => isYesNo(c.options ?? []))) {
      expect(f.options, f.key).toEqual(['Yes', 'No']);
      expect(f.allowOther, f.key).toBeUndefined();
    }
  });

  it('gives the five live choices a text box beside Other', () => {
    for (const f of LEGACY_FIELD_SNAPSHOT.filter((x) => x.options)) {
      expect(f.otherDetailKey, f.key).toBe(`${f.key}_other`);
      const box = CATALOGUE_FIELDS.find((c) => c.key === f.otherDetailKey);
      expect(box?.role, f.key).toBe('other_detail');
      expect(box?.module, f.key).toBe(moduleOfLegacyField(f.key));
    }
  });

  it('gives every sharing category an Other Item record that never counts', () => {
    const packs = new Set(MODULES.map((m) => m.pack));
    for (const pack of packs) {
      const fields = CATALOGUE_FIELDS.filter((f) => f.group === `other_item_${pack}`);
      expect(fields.length, `no Other Item record for ${pack}`).toBe(5);
      for (const f of fields) {
        expect(f.role, f.key).toBe('other_item');
        expect(f.pack, f.key).toBe(pack);
        expect(f.module, f.key).toBe('other_items');
      }
      expect(fields.map((f) => f.key.replace(`other_item_${pack}_`, ''))).toEqual([
        'section',
        'title',
        'details',
        'date',
        'note',
      ]);
    }
    expect(PROPOSED_PACKS.length).toBeGreaterThan(0);
  });

  it('protects Other Item text like the category it sits in', () => {
    const strong = (pack: string) =>
      CATALOGUE_FIELDS.find((f) => f.key === `other_item_${pack}_details`)?.sensitivity;
    expect(strong('declarations')).toBe('RESTRICTED');
    expect(strong('medical')).toBe('RESTRICTED');
    expect(strong('bangladesh')).toBe('RESTRICTED');
    expect(strong('country_ids')).toBe('RESTRICTED');
    expect(strong('universal')).toBe('STANDARD');
  });

  it('keeps an Other option for documents and purposes', () => {
    for (const g of CATALOGUE_DOCUMENT_GROUPS) {
      const others = CATALOGUE_DOCUMENTS.filter((d) => d.group === g.key && /^OTHER/.test(d.key));
      expect(others.length, `${g.key} has no Other document type`).toBeGreaterThan(0);
      for (const d of others) expect(d.pack, d.key).toBeNull();
    }
    for (const family of PURPOSE_FAMILY_KEYS) {
      expect(
        CATALOGUE_PURPOSES.some((p) => p.key === `other_${family}`),
        family,
      ).toBe(true);
    }
  });
});

describe('Bangladesh tax acknowledgement slip', () => {
  it('has fields and a document type that point at each other', () => {
    const fields = ['tax_ack_slip_number', 'tax_ack_slip_date', 'tax_assessment_year'];
    for (const key of fields) {
      const f = CATALOGUE_FIELDS.find((c) => c.key === key);
      expect(f?.module, key).toBe('bangladesh_tax');
      expect(f?.pack, key).toBe('bangladesh');
    }
    expect(CATALOGUE_FIELDS.find((c) => c.key === 'tax_ack_slip_number')?.sensitivity).toBe(
      'SENSITIVE',
    );
    const doc = resolveDocumentType('Tax Acknowledgement Receipt');
    expect(doc?.key).toBe('TAX_ACKNOWLEDGEMENT_SLIP');
    expect(doc?.pack).toBe('bangladesh');
    expect(doc?.group).toBe('financial');
    for (const key of fields) expect(doc?.supports, key).toContain(key);
  });
});
