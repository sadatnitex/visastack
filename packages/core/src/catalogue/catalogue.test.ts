import { describe, expect, it } from 'vitest';
import { PROFILE_PACKS } from '../domain';
import { CATALOGUE_DOCUMENTS } from './documents';
import { CATALOGUE_FIELDS } from './fields';
import {
  CATALOGUE_DOCUMENT_GROUPS,
  CATALOGUE_LAYERS,
  CATALOGUE_PURPOSE_FAMILIES,
  PROPOSED_PACKS,
} from './layers';
import { LEGACY_FIELD_SNAPSHOT, LEGACY_GROUP_KEYS } from './legacy';
import { isDocumentKey, isFieldKey, isPurposeKey, isTitleCaseLabel } from './naming';
import { CATALOGUE_PURPOSES } from './purposes';
import { ALL_FIELD_KEYS, resolveDocumentType } from './queries';
import { renderCatalogueReport } from './report';
import {
  COUNTRY_SCOPES,
  DOCUMENT_GROUP_KEYS,
  FIELD_KINDS,
  FIELD_SENSITIVITIES,
  LAYER_KEYS,
  PROPOSED_PACK_KEYS,
  PROTECTION_FLOOR,
  PROVENANCES,
  PURPOSE_FAMILY_KEYS,
  PURPOSE_HANDLINGS,
  sensitivityAtLeast,
} from './types';

const LIVE_PACKS: readonly string[] = PROFILE_PACKS;
const ALL_PACKS: readonly string[] = [...PROFILE_PACKS, ...PROPOSED_PACK_KEYS];
const legacyByKey = new Map(LEGACY_FIELD_SNAPSHOT.map((f) => [f.key, f]));
const legacyGroups = new Set(LEGACY_GROUP_KEYS);

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

describe('legacy snapshot (the 81 live fields)', () => {
  it('holds exactly 81 well-formed, unique fields', () => {
    expect(LEGACY_FIELD_SNAPSHOT).toHaveLength(81);
    expect(duplicates(LEGACY_FIELD_SNAPSHOT.map((f) => f.key))).toEqual([]);
    for (const f of LEGACY_FIELD_SNAPSHOT) {
      expect(isFieldKey(f.key), f.key).toBe(true);
      expect(LIVE_PACKS, f.key).toContain(f.pack);
      expect(FIELD_SENSITIVITIES, f.key).toContain(f.sensitivity);
      expect(LAYER_KEYS, f.key).toContain(f.layer);
    }
  });

  it('declares every live repeating record', () => {
    const fromFields = new Set(LEGACY_FIELD_SNAPSHOT.flatMap((f) => (f.group ? [f.group] : [])));
    expect([...fromFields].sort()).toEqual([...LEGACY_GROUP_KEYS].sort());
  });
});

describe('catalogue fields', () => {
  it('uses well-formed keys that never collide with a live field or each other', () => {
    for (const f of CATALOGUE_FIELDS) expect(isFieldKey(f.key), f.key).toBe(true);
    expect(duplicates(CATALOGUE_FIELDS.map((f) => f.key))).toEqual([]);
    for (const f of CATALOGUE_FIELDS) expect(legacyByKey.has(f.key), f.key).toBe(false);
    expect(ALL_FIELD_KEYS.size).toBe(LEGACY_FIELD_SNAPSHOT.length + CATALOGUE_FIELDS.length);
  });

  it('writes every label as a Title Case term', () => {
    for (const f of CATALOGUE_FIELDS) {
      expect(isTitleCaseLabel(f.label), `${f.key}: "${f.label}"`).toBe(true);
      if (f.groupLabel) expect(isTitleCaseLabel(f.groupLabel), f.groupLabel).toBe(true);
      if (f.sectionLabel) expect(isTitleCaseLabel(f.sectionLabel), f.sectionLabel).toBe(true);
    }
    for (const layer of CATALOGUE_LAYERS)
      expect(isTitleCaseLabel(layer.label), layer.label).toBe(true);
    for (const pack of PROPOSED_PACKS) expect(isTitleCaseLabel(pack.label), pack.label).toBe(true);
  });

  it('never lets protection fall below what the kind of data requires', () => {
    for (const f of CATALOGUE_FIELDS) {
      expect(FIELD_KINDS, f.key).toContain(f.kind);
      expect(sensitivityAtLeast(f.sensitivity, PROTECTION_FLOOR[f.kind]), f.key).toBe(true);
    }
  });

  it('protects identifiers: every number-like field is an identifier, with named exceptions', () => {
    const IDENTIFIER_KINDS = new Set(['identifier', 'national_identifier']);
    // Counters and codes that are not identifiers of a person or a record.
    const NOT_AN_IDENTIFIER = new Set([
      'vaccination_dose_number',
      'travel_duration_days',
      'application_record_certified_copies_count',
      'employer_phone',
      'ca_client_id',
      'us_school_code',
      'phone_history_number',
      'phone_history_country_code',
      'alternate_phone',
      'passport_chip_present',
      'name_on_national_id',
    ]);
    for (const f of CATALOGUE_FIELDS) {
      const looksLikeIdentifier = /(_number|_id|_ssn|_nin|_cpf|_curp)$/.test(f.key);
      if (!looksLikeIdentifier || NOT_AN_IDENTIFIER.has(f.key)) continue;
      expect(
        IDENTIFIER_KINDS.has(f.kind) || f.kind === 'health_admin' || f.kind === 'third_party',
        f.key,
      ).toBe(true);
    }
  });

  it('keeps every named national identifier RESTRICTED', () => {
    // A policy list, so a field cannot be quietly re-labelled to a weaker kind.
    const NAMED_NATIONAL_IDENTIFIERS = [
      'nid_number',
      'birth_registration_number',
      'tin_number',
      'national_id_number',
      'us_social_security_number',
      'us_alien_number',
      'au_tax_file_number',
      'au_medicare_number',
      'nz_ird_number',
      'nz_nhi_number',
      'ca_uci_number',
      'br_cpf_number',
      'mx_curp_number',
      'ng_nin_number',
      'ae_emirates_id_number',
      'gcc_iqama_number',
      'sponsor_identity_number',
    ];
    for (const key of NAMED_NATIONAL_IDENTIFIERS) {
      const field = CATALOGUE_FIELDS.find((f) => f.key === key);
      expect(field, `${key} is missing`).toBeDefined();
      expect(field?.sensitivity, key).toBe('RESTRICTED');
    }
  });

  it('keeps national identifiers RESTRICTED', () => {
    for (const f of CATALOGUE_FIELDS.filter((x) => x.kind === 'national_identifier')) {
      expect(f.sensitivity, f.key).toBe('RESTRICTED');
    }
  });

  it('keeps special categories out of broad sharing categories', () => {
    const BROAD = new Set(['universal', 'professional', 'business']);
    const HIGH_RISK = new Set(['legal_history', 'special_category', 'biometric', 'health_detail']);
    for (const f of CATALOGUE_FIELDS.filter((x) => HIGH_RISK.has(x.kind))) {
      expect(BROAD.has(f.pack), `${f.key} (${f.kind}) is in ${f.pack}`).toBe(false);
    }
  });

  it('uses only known packs, layers, families, countries and origins', () => {
    for (const f of CATALOGUE_FIELDS) {
      expect(ALL_PACKS, f.key).toContain(f.pack);
      expect(LAYER_KEYS, f.key).toContain(f.layer);
      expect(PROVENANCES, f.key).toContain(f.origin);
      expect(f.sourceRef.length, f.key).toBeGreaterThan(0);
      if (f.appliesTo !== 'all') {
        expect(f.appliesTo.length, f.key).toBeGreaterThan(0);
        for (const family of f.appliesTo) expect(PURPOSE_FAMILY_KEYS, f.key).toContain(family);
      }
      for (const c of f.countries ?? []) expect(COUNTRY_SCOPES, f.key).toContain(c);
    }
  });

  it('gives choice fields clean, unique options', () => {
    for (const f of CATALOGUE_FIELDS.filter((x) => x.options)) {
      const options = f.options ?? [];
      expect(options.length, f.key).toBeGreaterThan(1);
      expect(duplicates(options), f.key).toEqual([]);
      for (const o of options)
        expect(o.trim() === o && o.length > 0, `${f.key}: "${o}"`).toBe(true);
      expect(f.type, f.key).toBe('text');
    }
  });

  it('keeps every record consistent: one layer and one category, a label only when new', () => {
    const groups = new Map<string, typeof CATALOGUE_FIELDS>();
    for (const f of CATALOGUE_FIELDS) {
      if (!f.group) continue;
      groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
    }
    for (const [group, members] of groups) {
      expect(isFieldKey(group), group).toBe(true);
      const live = legacyGroups.has(group);
      const liveMembers = LEGACY_FIELD_SNAPSHOT.filter((l) => l.group === group);
      const packs = new Set(members.map((m) => m.pack));
      const layers = new Set(members.map((m) => m.layer));
      expect(packs.size, `${group} spans several categories`).toBe(1);
      expect(layers.size, `${group} spans several layers`).toBe(1);
      if (live) {
        // Extending a live record: it keeps its live label, category and layer.
        for (const m of members) expect(m.groupLabel, m.key).toBeUndefined();
        expect([...packs][0], group).toBe(liveMembers[0]?.pack);
        expect([...layers][0], group).toBe(liveMembers[0]?.layer);
      } else {
        expect(new Set(members.map((m) => m.groupLabel)).size, group).toBe(1);
        expect(members[0]?.groupLabel, group).toBeTruthy();
      }
    }
  });

  it('keeps labels unique within a record and a section', () => {
    const seen = new Map<string, string>();
    for (const f of CATALOGUE_FIELDS) {
      const block = f.group ? `g:${f.group}` : f.section ? `s:${f.section}` : '';
      if (!block) continue;
      const id = `${block}|${f.label}`;
      expect(seen.get(id), `${f.key} repeats the label of ${seen.get(id)}`).toBeUndefined();
      seen.set(id, f.key);
    }
  });

  it('keeps sections unique and never mixes layers or categories inside one', () => {
    const sections = new Map<string, typeof CATALOGUE_FIELDS>();
    for (const f of CATALOGUE_FIELDS) {
      if (!f.section) continue;
      sections.set(f.section, [...(sections.get(f.section) ?? []), f]);
    }
    for (const [section, members] of sections) {
      expect(new Set(members.map((m) => m.layer)).size, section).toBe(1);
      expect(new Set(members.map((m) => m.pack)).size, section).toBe(1);
    }
  });

  it('does not put a single field in both a record and a section', () => {
    for (const f of CATALOGUE_FIELDS) expect(Boolean(f.group && f.section), f.key).toBe(false);
  });

  it('scopes country packs: country identifiers always name their country', () => {
    for (const f of CATALOGUE_FIELDS.filter(
      (x) => x.pack === 'country_ids' && x.layer === 'country_packs',
    )) {
      if (f.key.startsWith('apec_')) continue;
      expect(f.countries?.length ?? 0, f.key).toBeGreaterThan(0);
    }
  });

  it('puts something in every layer', () => {
    for (const layer of LAYER_KEYS) {
      const inLayer =
        CATALOGUE_FIELDS.some((f) => f.layer === layer) ||
        LEGACY_FIELD_SNAPSHOT.some((f) => f.layer === layer);
      expect(inLayer, layer).toBe(true);
    }
  });
});

describe('proposed sharing categories', () => {
  it('are defined once, are not live categories, and are all used', () => {
    expect(PROPOSED_PACKS.map((p) => p.key).sort()).toEqual([...PROPOSED_PACK_KEYS].sort());
    for (const pack of PROPOSED_PACKS) {
      expect(LIVE_PACKS, pack.key).not.toContain(pack.key);
      expect(pack.rationale.length, pack.key).toBeGreaterThan(20);
      const used =
        CATALOGUE_FIELDS.some((f) => f.pack === pack.key) ||
        CATALOGUE_DOCUMENTS.some((d) => d.pack === pack.key);
      expect(used, `${pack.key} is never used`).toBe(true);
    }
  });
});

describe('document catalogue', () => {
  const keys = CATALOGUE_DOCUMENTS.map((d) => d.key);
  const aliasNames = CATALOGUE_DOCUMENTS.flatMap((d) => d.aliases);

  it('uses well-formed unique keys', () => {
    for (const d of CATALOGUE_DOCUMENTS) expect(isDocumentKey(d.key), d.key).toBe(true);
    expect(duplicates(keys)).toEqual([]);
  });

  it('never lets an alias shadow a key or repeat across entries', () => {
    const normalise = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const names = [...keys, ...aliasNames].map(normalise);
    expect(duplicates(names)).toEqual([]);
    for (const d of CATALOGUE_DOCUMENTS) {
      expect(resolveDocumentType(d.key)?.key, d.key).toBe(d.key);
      for (const a of d.aliases) expect(resolveDocumentType(a)?.key, a).toBe(d.key);
    }
    expect(resolveDocumentType('Pay Slip')?.key).toBe('SALARY_SLIP');
    expect(resolveDocumentType('no such document')).toBeUndefined();
  });

  it('writes every label in Title Case and uses known groups, packs and origins', () => {
    expect(CATALOGUE_DOCUMENT_GROUPS.map((g) => g.key).sort()).toEqual(
      [...DOCUMENT_GROUP_KEYS].sort(),
    );
    for (const g of CATALOGUE_DOCUMENT_GROUPS)
      expect(isTitleCaseLabel(g.label), g.label).toBe(true);
    for (const d of CATALOGUE_DOCUMENTS) {
      expect(isTitleCaseLabel(d.label), `${d.key}: "${d.label}"`).toBe(true);
      expect(DOCUMENT_GROUP_KEYS, d.key).toContain(d.group);
      if (d.pack !== null) expect(ALL_PACKS, d.key).toContain(d.pack);
      expect(PROVENANCES, d.key).toContain(d.origin);
      expect(d.sourceRef.length, d.key).toBeGreaterThan(0);
      if (d.validityMonths !== null) {
        expect(Number.isInteger(d.validityMonths) && d.validityMonths > 0, d.key).toBe(true);
      }
    }
  });

  it('only supports fields that really exist', () => {
    for (const d of CATALOGUE_DOCUMENTS) {
      expect(duplicates(d.supports), d.key).toEqual([]);
      for (const k of d.supports)
        expect(ALL_FIELD_KEYS.has(k), `${d.key} supports unknown ${k}`).toBe(true);
    }
  });

  it('keeps the three live types exactly as they work today', () => {
    const live = Object.fromEntries(
      CATALOGUE_DOCUMENTS.filter((d) => d.recognisedToday).map((d) => [d.key, d.pack]),
    );
    expect(live).toEqual({
      PASSPORT: 'universal',
      BANK_STATEMENT: 'universal',
      EMPLOYMENT_CERTIFICATE: 'professional',
    });
  });

  it('keeps legal and clearance records out of broad categories', () => {
    for (const key of [
      'POLICE_CLEARANCE',
      'CHARACTER_CERTIFICATE',
      'COURT_ORDER',
      'REFUSAL_LETTER',
    ]) {
      expect(resolveDocumentType(key)?.pack, key).toBe('declarations');
    }
  });

  it('leaves unclassifiable types without a category so they fail closed', () => {
    expect(resolveDocumentType('OTHER')?.pack).toBeNull();
  });
});

describe('purposes', () => {
  it('holds the 101 owner-approved purposes in 8 families', () => {
    expect(CATALOGUE_PURPOSES).toHaveLength(101);
    expect(CATALOGUE_PURPOSE_FAMILIES.map((f) => f.key).sort()).toEqual(
      [...PURPOSE_FAMILY_KEYS].sort(),
    );
    for (const family of PURPOSE_FAMILY_KEYS) {
      expect(CATALOGUE_PURPOSES.filter((p) => p.family === family).length, family).toBeGreaterThan(
        0,
      );
    }
  });

  it('uses well-formed unique keys and Title Case labels', () => {
    expect(duplicates(CATALOGUE_PURPOSES.map((p) => p.key))).toEqual([]);
    expect(duplicates(CATALOGUE_PURPOSES.map((p) => p.label))).toEqual([]);
    for (const p of CATALOGUE_PURPOSES) {
      expect(isPurposeKey(p.key), p.key).toBe(true);
      expect(isTitleCaseLabel(p.label), `${p.key}: "${p.label}"`).toBe(true);
      expect(PURPOSE_HANDLINGS, p.key).toContain(p.handling);
      expect(p.evidenceThemes.length, p.key).toBeGreaterThan(0);
    }
  });

  it('follows the owner decision: protection and investor routes are adviser only', () => {
    for (const p of CATALOGUE_PURPOSES.filter(
      (x) => x.family === 'protection' && !/official|organisation|military|embassy/.test(x.key),
    )) {
      expect(p.handling, p.key).toBe('adviser_only');
    }
    for (const key of [
      'investor_or_business_purchase',
      'permanent_residency_by_investment',
      'citizenship_by_investment',
    ]) {
      expect(CATALOGUE_PURPOSES.find((p) => p.key === key)?.handling, key).toBe('adviser_only');
    }
  });

  it('never claims verified rules', () => {
    for (const p of CATALOGUE_PURPOSES) {
      expect(`${p.evidenceThemes} ${p.note ?? ''}`.toLowerCase(), p.key).not.toMatch(
        /\bverified\b/,
      );
    }
  });
});

describe('review report', () => {
  it('matches the checked-in report, so the report can never disagree with the catalogue', async () => {
    await expect(renderCatalogueReport()).toMatchFileSnapshot(
      '../../../../docs/product/master-profile-enrichment/CATALOGUE-REPORT.md',
    );
  });
});
