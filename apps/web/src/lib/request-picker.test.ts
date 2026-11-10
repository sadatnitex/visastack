import {
  CATALOGUE_DOCUMENTS,
  isKnownFieldKey,
  knownFieldOptions,
  resolveDocumentType,
} from '@visastack/core/catalogue';
import { REQUEST_SYNONYMS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { evidenceDocumentGroups, evidenceFieldGroups } from './master-profile';
import { buildRequestPicker, requestPickerIndex } from './request-picker';
import { pickerItemId } from './request-picker-types';
import { isTitleCase } from './title-case';

/**
 * The whole-catalogue walk behind the asking picker: every one of the ~960 documents and details
 * an agency can choose is one real thing, named in Title Case, in a group, findable, and told
 * apart from any other item that shares its name. A hand-written list could not stay this honest.
 */

const picker = buildRequestPicker();
const items = picker.groups.flatMap((group) =>
  group.items.map((item) => ({
    group,
    id: pickerItemId(group.kind, item),
    label: item[1],
    hint: item[2] ?? '',
    words: item[3] ?? '',
  })),
);

describe('the asking picker covers the whole catalogue', () => {
  it('lists documents first, then details', () => {
    const kinds = picker.groups.map((group) => group.kind);
    const firstField = kinds.indexOf('FIELD');
    expect(kinds.slice(0, firstField).every((kind) => kind === 'DOCUMENT')).toBe(true);
    expect(kinds.slice(firstField).every((kind) => kind === 'FIELD')).toBe(true);
    expect(firstField).toBeGreaterThan(0);
  });

  it('has exactly the details and documents the catalogue offers, each once', () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expected = new Set([
      ...evidenceDocumentGroups().flatMap((g) => g.choices.map((c) => `DOCUMENT:${c.key}`)),
      ...evidenceFieldGroups().flatMap((g) => g.choices.map((c) => `FIELD:${c.key}`)),
    ]);
    expect(new Set(ids)).toEqual(expected);
    // Every document type of the catalogue is askable (216 today) and every askable detail is listed.
    expect(items.filter((i) => i.group.kind === 'DOCUMENT')).toHaveLength(
      CATALOGUE_DOCUMENTS.length,
    );
    expect(items.filter((i) => i.group.kind === 'FIELD')).toHaveLength(knownFieldOptions().length);
    expect(items.length).toBeGreaterThan(900);
  });

  it('maps every item to exactly one real field key or document type (no free text, no orphans)', () => {
    for (const item of items) {
      const key = item.id.slice(item.id.indexOf(':') + 1);
      if (item.group.kind === 'FIELD') {
        expect(item.id.startsWith('FIELD:'), item.id).toBe(true);
        expect(isKnownFieldKey(key), `${item.id} is not a real detail`).toBe(true);
        expect(
          knownFieldOptions().some((o) => o.key === key),
          item.id,
        ).toBe(true);
      } else {
        expect(item.id.startsWith('DOCUMENT:'), item.id).toBe(true);
        expect(resolveDocumentType(key)?.key, `${item.id} is not a real document type`).toBe(key);
      }
    }
  });

  it('gives every item a plain, non-empty Title Case name and a group', () => {
    const problems: string[] = [];
    for (const item of items) {
      if (item.label.trim() === '') problems.push(`${item.id} has no name`);
      if (!isTitleCase(item.label)) problems.push(`"${item.label}" (${item.id}) is not Title Case`);
      if (item.group.label.trim() === '') problems.push(`${item.id} has no group`);
      if (/_/.test(item.label)) problems.push(`"${item.label}" (${item.id}) shows a key`);
    }
    expect(problems).toEqual([]);
  });

  it('tells apart any items that share a name: the name plus its context line is never repeated', () => {
    const byLabel = new Map<string, typeof items>();
    for (const item of items) {
      const key = item.label.trim().toLowerCase();
      byLabel.set(key, [...(byLabel.get(key) ?? []), item]);
    }
    const problems: string[] = [];
    for (const [label, same] of byLabel) {
      if (same.length < 2) {
        // Not shared: no context line is sent (it would only add weight).
        if (same[0]?.hint) problems.push(`${same[0].id} has a context line but its name is unique`);
        continue;
      }
      const seen = new Set<string>();
      for (const item of same) {
        if (item.hint.trim() === '')
          problems.push(`"${label}" (${item.id}) shares its name and has no context line`);
        const full = `${label}|${item.hint.toLowerCase()}`;
        if (seen.has(full)) problems.push(`"${label}" with "${item.hint}" repeats (${item.id})`);
        seen.add(full);
        expect(item.hint, item.id).not.toMatch(/_/);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every plain name points at a real item, and each shows in the list', () => {
    const ids = new Set(items.map((item) => item.id));
    for (const entry of REQUEST_SYNONYMS) {
      expect(ids.has(`${entry.kind}:${entry.key}`), `${entry.key} is not in the picker`).toBe(true);
    }
    const nid = items.find((item) => item.id === 'DOCUMENT:NID');
    expect(nid?.words.split('|')).toContain('NID');
    // The real Other types are found by what people try to type.
    const others = items.filter((item) => item.id.startsWith('DOCUMENT:OTHER'));
    expect(others.length).toBeGreaterThanOrEqual(14);
    for (const item of others) {
      expect(item.words.toLowerCase(), item.id).toContain('something else');
    }
  });

  it('stays light: no heavier than the two lists it replaces (58,624 bytes)', () => {
    expect(JSON.stringify(picker).length).toBeLessThan(58_624);
  });

  it('indexes every item by id for the case checklist', () => {
    const index = requestPickerIndex(picker);
    expect(index.size).toBe(items.length);
    expect(index.get('DOCUMENT:NID')?.label).toBe('National ID Card');
  });
});
