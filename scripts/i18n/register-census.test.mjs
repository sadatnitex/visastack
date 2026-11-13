import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Register } from './register.mjs';

// Two register rows share the English "Terms" with different Bengali, so the English alone is
// ambiguous; the census names the row that belongs to this file.
const REGISTER =
  'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n' +
  'SG-A,ORDINARY_UI,Terms,শর্তাবলি,PASS\n' +
  'SG-B,ORDINARY_UI,Terms,শর্ত,PASS\n';
const census = (rows) =>
  `file,line_start,english,semantic_group\n${rows.map((r) => r.join(',')).join('\n')}\n`;
const lookup = (censusCsv, line = 12) =>
  new Register({ registerCsv: REGISTER, censusCsv }).lookup({
    file: 'a.tsx',
    line,
    censusText: 'Terms',
    english: 'Terms',
  });

describe('census row for a file whose lines moved', () => {
  test('the census row at the exact line is used, as before', () => {
    const r = lookup(census([['a.tsx', '12', 'Terms', 'SG-B']]));
    assert.equal(r.group, 'SG-B');
    assert.equal(r.bn, 'শর্ত');
  });

  test('a moved line still finds the one census row for that file and English', () => {
    const r = lookup(census([['a.tsx', '11', 'Terms', 'SG-A']]));
    assert.equal(r.group, 'SG-A');
    assert.equal(r.bn, 'শর্তাবলি');
    assert.equal(r.reason, null);
  });

  test('two census groups for the same English in one file stay ambiguous', () => {
    const r = lookup(
      census([
        ['a.tsx', '11', 'Terms', 'SG-A'],
        ['a.tsx', '30', 'Terms', 'SG-B'],
      ]),
    );
    assert.equal(r.reason, 'register_ambiguous');
    assert.equal(r.bn, null);
  });

  test('the same English twice in one file with one group is still that group', () => {
    const r = lookup(
      census([
        ['a.tsx', '11', 'Terms', 'SG-A'],
        ['a.tsx', '40', 'Terms', 'SG-A'],
      ]),
    );
    assert.equal(r.group, 'SG-A');
  });

  test('a census row far from where the text is now is never borrowed', () => {
    const r = lookup(census([['a.tsx', '200', 'Terms', 'SG-A']]));
    assert.equal(r.reason, 'register_ambiguous');
    assert.equal(r.bn, null);
  });

  test('only the nearby rows count when the file has the English twice', () => {
    const r = lookup(
      census([
        ['a.tsx', '11', 'Terms', 'SG-A'],
        ['a.tsx', '300', 'Terms', 'SG-B'],
      ]),
    );
    assert.equal(r.group, 'SG-A');
  });

  test('a census row from another file is never used', () => {
    const r = lookup(census([['b.tsx', '11', 'Terms', 'SG-A']]));
    assert.equal(r.reason, 'register_ambiguous');
  });

  test('a census row another text still matches at its line is never lent to a new text', () => {
    const reg = new Register({
      registerCsv: REGISTER,
      censusCsv: census([['a.tsx', '10', 'Terms', 'SG-A']]),
    });
    const inPlace = { file: 'a.tsx', line: 10, censusText: 'Terms', english: 'Terms' };
    const added = { file: 'a.tsx', line: 30, censusText: 'Terms', english: 'Terms' };
    const claimed = reg.claimedBy([inPlace, added]);
    assert.equal(reg.lookup(inPlace, claimed).group, 'SG-A');
    const r = reg.lookup(added, claimed);
    assert.equal(r.reason, 'register_ambiguous');
    assert.equal(r.bn, null);
  });

  test('a moved text still finds its row when no text claims it', () => {
    const reg = new Register({
      registerCsv: REGISTER,
      censusCsv: census([['a.tsx', '10', 'Terms', 'SG-A']]),
    });
    const moved = { file: 'a.tsx', line: 30, censusText: 'Terms', english: 'Terms' };
    assert.equal(reg.lookup(moved, reg.claimedBy([moved])).group, 'SG-A');
  });
});
