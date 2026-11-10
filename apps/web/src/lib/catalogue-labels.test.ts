import { CATALOGUE_DOCUMENTS, CATALOGUE_FIELDS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { PROFILE_FIELDS } from './profile-fields';
import { isTitleCase } from './title-case';

/*
 * The request picker used to show these names in Title Case while the catalogue held them in other
 * cases ("Valid from / to"), so the same detail read two ways. The catalogue and the live field
 * list now hold the Title Case spelling themselves, and this keeps them there. Only display labels
 * are checked: stored answer values (for example "Before tax") are not labels and stay as saved.
 */
describe('catalogue and profile labels are Title Case at the source', () => {
  it('holds every catalogue detail, group and section name in the case the picker shows', () => {
    const problems: string[] = [];
    for (const field of CATALOGUE_FIELDS) {
      for (const [part, text] of [
        ['label', field.label],
        ['group', field.groupLabel],
        ['section', field.sectionLabel],
      ] as const) {
        if (text && !isTitleCase(text)) problems.push(`${field.key} ${part}: "${text}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('holds every catalogue document name in the case the picker shows', () => {
    const problems = CATALOGUE_DOCUMENTS.filter((d) => !isTitleCase(d.label)).map(
      (d) => `${d.key}: "${d.label}"`,
    );
    expect(problems).toEqual([]);
  });

  it('holds every live profile field and group name in the case the picker shows', () => {
    const problems: string[] = [];
    for (const field of PROFILE_FIELDS) {
      if (!isTitleCase(field.label)) problems.push(`${field.key} label: "${field.label}"`);
      if (field.groupLabel && !isTitleCase(field.groupLabel)) {
        problems.push(`${field.key} group: "${field.groupLabel}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});
